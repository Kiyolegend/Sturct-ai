"""
Quick Scalp Router
──────────────────
Scans all active pairs for fast manual scalp opportunities.

Conditions (binary — no scoring system):
  1. Active session   — London 08-17 UTC or New York 13-22 UTC
  2. News clear       — no Tier 7+ event on this pair (Repo 3, fallback=clear)
  3. Clear trend      — 5M trend is bullish or bearish (not neutral)
  4. Momentum candle  — last completed 5M candle body >= 60% of range, in direction
  5. No adverse CHoCH — no reversal signal in the last 20 minutes

SL: last structural swing low/high + 2-pip buffer (min 12p, max 35p)
TP: 6 pips from entry -> net ~$0.50-$0.65 at 0.02 lots after spread cost
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter

from services.data_service import fetch_ohlc
from services.zigzag_engine import detect_swings
from services.structure_engine import classify_structure
from services.trend_engine import detect_trend
from services.choch_engine import detect_choch

router = APIRouter()

SYMBOLS = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"]
TP_PIPS = 6


def _pip(price: float) -> float:
    return 0.01 if price > 50 else 0.0001


def _dec(price: float) -> int:
    return 3 if price > 50 else 5


def _r(v: float, price: float) -> float:
    return round(v, _dec(price))


def _active_session(ts: float) -> tuple[bool, str]:
    now = datetime.fromtimestamp(ts, tz=timezone.utc)
    h = now.hour + now.minute / 60.0
    in_ldn = 8.0 <= h < 17.0
    in_ny = 13.0 <= h < 22.0
    if in_ldn and in_ny:
        return True, "LDN+NY overlap"
    if in_ldn:
        return True, "London session"
    if in_ny:
        return True, "NY session"
    return False, "Asian session — no scalp"


async def _news_clear(symbol: str) -> tuple[bool, str]:
    pair_key = symbol.replace("/", "")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(
                "http://localhost:5003/api/impact/symbol",
                params={"pair": pair_key},
            )
            data = r.json()
            if data.get("blocked") or data.get("is_blocked"):
                return False, data.get("reason", "News block active")
            return True, "News clear"
    except Exception:
        return True, "News service offline — clear"


def _momentum_ok(candles: list[dict], direction: str) -> tuple[bool, str]:
    if len(candles) < 3:
        return False, "Insufficient data"
    c = candles[-2]  # last COMPLETED candle — not the forming one
    cr = c["high"] - c["low"]
    if cr == 0:
        return False, "Zero-range candle"
    body = abs(c["close"] - c["open"])
    ratio = body / cr
    if ratio < 0.60:
        return False, f"Weak candle ({ratio:.0%} body)"
    bullish = c["close"] > c["open"]
    if direction == "bullish" and not bullish:
        return False, "Bearish candle in bullish trend"
    if direction == "bearish" and bullish:
        return False, "Bullish candle in bearish trend"
    return True, f"Momentum {ratio:.0%} body"


def _no_adverse_choch(choch_events: list[dict], direction: str, candles: list[dict]) -> tuple[bool, str]:
    if not candles or not choch_events:
        return True, "No CHoCH"
    latest_time = candles[-1]["time"]
    lookback = latest_time - (4 * 5 * 60)  # last 20 min of 5m candles
    recent_adverse = [
        e for e in choch_events
        if e.get("time", 0) >= lookback and e.get("direction") != direction
    ]
    if recent_adverse:
        last = recent_adverse[-1]
        return False, f"CHoCH {last['direction']} {last.get('label', '')} <=20m ago"
    return True, "No adverse CHoCH"


def _structural_sl(structure_labels: list[dict], direction: str, price: float) -> float:
    pip = _pip(price)
    buf = 2 * pip
    min_p = 12
    max_p = 35

    if direction == "bullish":
        lows = [s for s in structure_labels if s.get("label") in ("HL", "LL", "EQL") and s["price"] < price]
        if lows:
            swing = lows[-1]["price"]
            sl = swing - buf
            d = (price - sl) / pip
            if min_p <= d <= max_p:
                return _r(sl, price)
        return _r(price - 15 * pip, price)
    else:
        highs = [s for s in structure_labels if s.get("label") in ("LH", "HH", "EQH") and s["price"] > price]
        if highs:
            swing = highs[-1]["price"]
            sl = swing + buf
            d = (sl - price) / pip
            if min_p <= d <= max_p:
                return _r(sl, price)
        return _r(price + 15 * pip, price)


async def _scan_symbol(symbol: str, now_ts: float) -> dict:
    out: dict = {
        "symbol": symbol,
        "status": "red",
        "direction": None,
        "entry": None,
        "sl": None,
        "tp": None,
        "sl_pips": None,
        "tp_pips": TP_PIPS,
        "checks": {},
        "reason": "",
    }

    # 1. Session
    sess_ok, sess_msg = _active_session(now_ts)
    out["checks"]["session"] = {"ok": sess_ok, "msg": sess_msg}
    if not sess_ok:
        out["reason"] = sess_msg
        return out

    # 2. Fetch data
    try:
        df = await fetch_ohlc(symbol=symbol, interval="5m", outputsize=100)
    except ValueError as exc:
        out["reason"] = f"No MT5 data: {exc}"
        return out

    candles = [
        {
            "time": int(row["time"].timestamp()),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
        }
        for _, row in df.iterrows()
    ]
    price = candles[-1]["close"] if candles else 0.0
    if not price:
        out["reason"] = "Price is zero"
        return out

    # 3. Trend / Direction
    swings = detect_swings(df, fractal_n=5)
    structure_labels = classify_structure(swings)
    trend_data = detect_trend(structure_labels)
    direction = trend_data.get("trend", "neutral")

    if direction == "neutral":
        out["checks"]["trend"] = {"ok": False, "msg": "Neutral — no bias"}
        out["reason"] = "No clear trend direction"
        return out
    out["checks"]["trend"] = {"ok": True, "msg": f"{direction.capitalize()} (conf {trend_data.get('confidence', 0):.0f}%)"}

    # 4. Momentum candle
    mom_ok, mom_msg = _momentum_ok(candles, direction)
    out["checks"]["momentum"] = {"ok": mom_ok, "msg": mom_msg}

    # 5. CHoCH check
    choch_events = detect_choch(df, swings, structure_labels, direction)
    choch_ok, choch_msg = _no_adverse_choch(choch_events, direction, candles)
    out["checks"]["choch"] = {"ok": choch_ok, "msg": choch_msg}

    # 6. News
    news_ok, news_msg = await _news_clear(symbol)
    out["checks"]["news"] = {"ok": news_ok, "msg": news_msg}

    # Build SL / TP
    pip = _pip(price)
    sl = _structural_sl(structure_labels, direction, price)
    tp = _r(price + TP_PIPS * pip if direction == "bullish" else price - TP_PIPS * pip, price)
    sl_pips = round(abs(price - sl) / pip, 1)

    out.update({
        "direction": "BUY" if direction == "bullish" else "SELL",
        "entry": _r(price, price),
        "sl": sl,
        "tp": tp,
        "sl_pips": sl_pips,
        "tp_pips": TP_PIPS,
    })

    # Status
    if not news_ok:
        out["status"] = "red"
        out["reason"] = news_msg
    elif mom_ok and choch_ok:
        out["status"] = "green"
        out["reason"] = f"{direction.capitalize()} · {sess_msg} · {mom_msg}"
    elif mom_ok or choch_ok:
        out["status"] = "yellow"
        missing = []
        if not mom_ok:
            missing.append("momentum")
        if not choch_ok:
            missing.append("CHoCH clear")
        out["reason"] = f"Partial — {', '.join(missing)} not met"
    else:
        out["status"] = "red"
        out["reason"] = "No momentum + CHoCH warning"

    return out


@router.get("/quick-scalp/scan")
async def quick_scalp_scan():
    """Scan all pairs for quick manual scalp opportunities."""
    now_ts = time.time()
    results = await asyncio.gather(
        *[_scan_symbol(sym, now_ts) for sym in SYMBOLS],
        return_exceptions=True,
    )
    signals = []
    for sym, res in zip(SYMBOLS, results):
        if isinstance(res, Exception):
            signals.append({
                "symbol": sym, "status": "red", "direction": None,
                "entry": None, "sl": None, "tp": None,
                "sl_pips": None, "tp_pips": TP_PIPS,
                "checks": {}, "reason": str(res),
            })
        else:
            signals.append(res)

    return {"signals": signals, "timestamp": int(now_ts)}