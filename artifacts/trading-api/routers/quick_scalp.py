"""
Quick Scalp Router — v2
──────────────────────────────────────────────────────────────────────────────
Hard guards (instant red if ANY fails):
  1. Active session   — London/NY (DST-aware). Asian 00-09 UTC for USD/JPY only.
  2. News clear       — no high-impact event on this pair (Repo 3, fallback=clear)
  3. Clear trend      — 5M trend is bullish or bearish (fractal_n=3, not neutral)

Entry modes — GREEN if ANY ONE passes:
  A. Momentum candle   — last completed 5M candle body ≥ 45% range, in direction
                         + no adverse CHoCH in last 10 min
  B. Fibonacci pullback — price within 5 pips of 38.2/50/61.8% fib of last swing
                          + current 5M candle bouncing back in direction
  C. HTF pullback       — H1 bias matches direction + last 2 candles retracing
                          + current candle bouncing back in direction
  D. Narrative          — H4 + H1 + 15M all agree on direction (full alignment)

SL: last structural swing + 2-pip buffer (min 10p, max 35p, fallback 15p)
TP: 8 pips for EUR/USD, GBP/USD, AUD/USD, USD/CHF  |  6 pips for USD/JPY
"""
from __future__ import annotations

import asyncio
import httpx
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


from fastapi import APIRouter

from services.data_service import fetch_ohlc
from services.zigzag_engine import detect_swings
from services.structure_engine import classify_structure
from services.trend_engine import detect_trend
from services.choch_engine import detect_choch
from services.mt5_store import get_latest_timestamp
from services.structure_cache import get_result as _cache_get, set_result as _cache_set

router = APIRouter()

SYMBOLS       = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"]
TP_PIPS_JPY   = 6
TP_PIPS_OTHER = 8



def _pip(price: float) -> float:
    return 0.01 if price > 50 else 0.0001


def _dec(price: float) -> int:
    return 3 if price > 50 else 5


def _r(v: float, price: float) -> float:
    return round(v, _dec(price))


def _tp_pips(symbol: str) -> int:
    return TP_PIPS_JPY if "JPY" in symbol else TP_PIPS_OTHER


# ── Hard guard 1: Session ──────────────────────────────────────────────────────
def _active_session(ts: float, symbol: str) -> tuple[bool, str]:
    now = datetime.fromtimestamp(ts, tz=timezone.utc)
    h   = now.hour + now.minute / 60.0

    # Asian session — USD/JPY only
    if 0.0 <= h < 9.0 and symbol == "USD/JPY":
        return True, "Asian session (USD/JPY)"

    # London: 08:00-17:00 local (DST-aware)
    lo_off  = int(now.astimezone(ZoneInfo("Europe/London")).utcoffset().total_seconds() // 3600)
    in_ldn  = (8 - lo_off) <= h < (17 - lo_off)

    # New York: 08:00-17:00 local (DST-aware)
    ny_off  = int(now.astimezone(ZoneInfo("America/New_York")).utcoffset().total_seconds() // 3600)
    in_ny   = (8 - ny_off) <= h < (17 - ny_off)

    if in_ldn and in_ny:
        return True, "LDN+NY overlap"
    if in_ldn:
        return True, "London session"
    if in_ny:
        return True, "NY session"
    return False, "Off-session — no scalp"


# ── Hard guard 2: News ─────────────────────────────────────────────────────────
async def _news_clear(symbol: str) -> tuple[bool, str]:
    pair_key = symbol.replace("/", "")
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r    = await client.get(
                "http://localhost:5003/api/impact/symbol",
                params={"pair": pair_key},
            )
            data = r.json()
            if data.get("blocked") or data.get("is_blocked"):
                return False, data.get("reason", "News block active")
            return True, "News clear"
    except Exception:
        return True, "News service offline — clear"





# ── Entry Mode A: Momentum candle ──────────────────────────────────────────────
def _mode_a(candles: list[dict], direction: str,
            choch_events: list[dict]) -> tuple[bool, str]:
    if len(candles) < 3:
        return False, "Insufficient data"
    c  = candles[-2]          # last COMPLETED candle
    cr = c["high"] - c["low"]
    if cr == 0:
        return False, "Zero-range candle"
    body  = abs(c["close"] - c["open"])
    ratio = body / cr
    if ratio < 0.45:
        return False, f"Weak candle ({ratio:.0%} body)"
    bullish_candle = c["close"] > c["open"]
    if direction == "bullish" and not bullish_candle:
        return False, "Bearish candle in bullish trend"
    if direction == "bearish" and bullish_candle:
        return False, "Bullish candle in bearish trend"
    # No adverse CHoCH in last 10 min (2 candles)
    latest_time = candles[-1]["time"]
    lookback    = latest_time - (2 * 5 * 60)
    adverse     = [
        e for e in choch_events
        if e.get("time", 0) >= lookback and e.get("direction") != direction
    ]
    if adverse:
        last = adverse[-1]
        return False, f"CHoCH {last['direction']} <=10m ago"
    return True, f"Momentum {ratio:.0%} body"


# ── Entry Mode B: Fibonacci pullback ───────────────────────────────────────────
def _mode_b(structure_labels: list[dict], candles: list[dict],
            direction: str, price: float) -> tuple[bool, str]:
    pip = _pip(price)
    highs = [s for s in structure_labels if s.get("label") in ("HH", "LH", "EQH")]
    lows  = [s for s in structure_labels if s.get("label") in ("HL", "LL", "EQL")]
    if not highs or not lows:
        return False, "No swing data for fib"
    swing_hi = highs[-1]["price"]
    swing_lo = lows[-1]["price"]
    if swing_hi <= swing_lo:
        return False, "Invalid swing for fib"
    rng = swing_hi - swing_lo
    tolerance = 5 * pip

    if direction == "bullish":
        # Price pulling back DOWN from swing_hi — look for bounce at retracement
        levels = {
            "38.2%": swing_hi - 0.382 * rng,
            "50.0%": swing_hi - 0.500 * rng,
            "61.8%": swing_hi - 0.618 * rng,
        }
        hit = next((lbl for lbl, lvl in levels.items() if abs(price - lvl) <= tolerance), None)
        if not hit:
            return False, "Price not at fib level"
        cur = candles[-1]
        if cur["close"] <= cur["open"]:
            return False, f"At fib {hit} — waiting for bullish bounce"
        return True, f"Fib {hit} pullback bounce ↑"

    else:  # bearish
        # Price pulling back UP from swing_lo — look for rejection at retracement
        levels = {
            "38.2%": swing_lo + 0.382 * rng,
            "50.0%": swing_lo + 0.500 * rng,
            "61.8%": swing_lo + 0.618 * rng,
        }
        hit = next((lbl for lbl, lvl in levels.items() if abs(price - lvl) <= tolerance), None)
        if not hit:
            return False, "Price not at fib level"
        cur = candles[-1]
        if cur["close"] >= cur["open"]:
            return False, f"At fib {hit} — waiting for bearish bounce"
        return True, f"Fib {hit} pullback bounce ↓"


# ── Entry Mode C: HTF pullback + bounce ────────────────────────────────────────
def _mode_c(mtf_bias: dict, candles: list[dict], direction: str) -> tuple[bool, str]:
    if len(candles) < 4:
        return False, "Insufficient candles"
    bias_1h = (mtf_bias.get("bias_1h") or {}).get("trend", "neutral")
    if bias_1h != direction:
        return False, f"H1 bias {bias_1h} ≠ {direction}"
    # Last 2 completed candles must be retracing against direction
    c1, c2 = candles[-3], candles[-2]
    if direction == "bullish":
        retracing = (c1["close"] < c1["open"]) or (c2["close"] < c2["open"])
    else:
        retracing = (c1["close"] > c1["open"]) or (c2["close"] > c2["open"])
    if not retracing:
        return False, "H1 bullish but no 5M pullback"
    # Current candle must be bouncing back in direction
    cur = candles[-1]
    if direction == "bullish" and cur["close"] <= cur["open"]:
        return False, "Pullback present — waiting for bounce candle"
    if direction == "bearish" and cur["close"] >= cur["open"]:
        return False, "Pullback present — waiting for bounce candle"
    return True, f"H1 {direction} pullback + 5M bounce"


# ── Entry Mode D: Full HTF narrative alignment ─────────────────────────────────
def _mode_d(mtf_bias: dict, direction: str) -> tuple[bool, str]:
    bias_4h  = (mtf_bias.get("bias_4h")  or {}).get("trend", "neutral")
    bias_1h  = (mtf_bias.get("bias_1h")  or {}).get("trend", "neutral")
    bias_15m = (mtf_bias.get("bias_15m") or {}).get("trend", "neutral")
    aligned  = sum(1 for b in [bias_4h, bias_1h, bias_15m] if b == direction)
    if aligned >= 3:
        return True, f"Narrative: 4H+1H+15M all {direction}"
    if aligned >= 2:
        return True, f"Narrative: 2/3 HTF {direction} ({bias_4h}/{bias_1h}/{bias_15m})"
    return False, f"HTF not aligned ({bias_4h}/{bias_1h}/{bias_15m})"


# ── SL calculator ─────────────────────────────────────────────────────────────
def _structural_sl(structure_labels: list[dict], direction: str, price: float) -> float:
    pip   = _pip(price)
    buf   = 2 * pip
    min_p = 10
    max_p = 35
    if direction == "bullish":
        lows = [s for s in structure_labels if s.get("label") in ("HL", "LL", "EQL") and s["price"] < price]
        if lows:
            swing = lows[-1]["price"]
            sl    = swing - buf
            d     = (price - sl) / pip
            if min_p <= d <= max_p:
                return _r(sl, price)
        return _r(price - 15 * pip, price)
    else:
        highs = [s for s in structure_labels if s.get("label") in ("LH", "HH", "EQH") and s["price"] > price]
        if highs:
            swing = highs[-1]["price"]
            sl    = swing + buf
            d     = (sl - price) / pip
            if min_p <= d <= max_p:
                return _r(sl, price)
        return _r(price + 15 * pip, price)


# ── Per-symbol scan ────────────────────────────────────────────────────────────
async def _scan_symbol(symbol: str, now_ts: float) -> dict:
    tp_pips = _tp_pips(symbol)
    out: dict = {
        "symbol":    symbol,
        "status":    "red",
        "direction": None,
        "entry":     None,
        "sl":        None,
        "tp":        None,
        "sl_pips":   None,
        "tp_pips":   tp_pips,
        "mode":      None,
        "checks":    {},
        "reason":    "",
    }

    # 1. Session
    sess_ok, sess_msg = _active_session(now_ts, symbol)
    out["checks"]["session"] = {"ok": sess_ok, "msg": sess_msg}
    if not sess_ok:
        out["reason"] = sess_msg
        return out

        # 2. News check (async) + cache reads (instant)
    news_ok, news_msg = await _news_clear(symbol)

    out["checks"]["news"] = {"ok": news_ok, "msg": news_msg}
    if not news_ok:
        out["reason"] = news_msg
        return out

    # Read 5M structure from cache (written by /structure or /analysis route)
    r5m = _cache_get(symbol, "5m")
    if r5m is None:
        # Cache miss — compute once and store
        try:
            df = await fetch_ohlc(symbol=symbol, interval="5m", outputsize=100)
        except Exception as e:
            out["reason"] = f"No MT5 data: {e}"
            return out
        swings           = detect_swings(df, fractal_n=5)
        structure_labels = classify_structure(swings)
        trend_data       = detect_trend(structure_labels)
        choch_events     = detect_choch(df, swings, structure_labels, trend_data.get("trend", "neutral"))
        candles_raw      = [
            {"time": int(row["time"].timestamp()), "open": float(row["open"]),
             "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"])}
            for _, row in df.iterrows()
        ]
        r5m = {"structure_labels": structure_labels, "trend": trend_data,
               "choch": choch_events, "candles": candles_raw,
               "price": float(df["close"].iloc[-1]) if len(df) > 0 else 0.0}
        _cache_set(symbol, "5m", r5m)

    # Read MTF bias from cache — NO HTTP call to self anymore
    r15m = _cache_get(symbol, "15m") or {}
    r1h  = _cache_get(symbol, "1h")  or {}
    r4h  = _cache_get(symbol, "4h")  or {}
    mtf_bias = {
        "bias_15m": r15m.get("trend") or {},
        "bias_1h":  r1h.get("trend")  or {},
        "bias_4h":  r4h.get("trend")  or {},
    }

    candles          = r5m.get("candles", [])
    structure_labels = r5m.get("structure_labels", [])
    trend_data       = r5m.get("trend", {})
    choch_events     = r5m.get("choch", [])
    price            = r5m.get("price") or (candles[-1]["close"] if candles else 0.0)

    if not price:
        out["reason"] = "Price is zero"
        return out
    out["checks"]["news"] = {"ok": news_ok, "msg": news_msg}
    if not news_ok:
        out["reason"] = news_msg
        return out

    direction = trend_data.get("trend", "neutral")

    if direction == "neutral":
        out["checks"]["trend"] = {"ok": False, "msg": "Neutral — no bias"}
        out["reason"] = "No clear trend direction"
        return out
    out["checks"]["trend"] = {
        "ok":  True,
        "msg": f"{direction.capitalize()} (conf {trend_data.get('confidence', 0):.0f}%)",
    }

    choch_events = detect_choch(df, swings, structure_labels, direction)
    pip          = _pip(price)

    # 4. Entry modes — all evaluated, any one = GREEN
    a_ok, a_msg = _mode_a(candles, direction, choch_events)
    b_ok, b_msg = _mode_b(structure_labels, candles, direction, price)
    c_ok, c_msg = _mode_c(mtf_bias, candles, direction)
    d_ok, d_msg = _mode_d(mtf_bias, direction)

    out["checks"]["mode_a"] = {"ok": a_ok, "msg": a_msg}
    out["checks"]["mode_b"] = {"ok": b_ok, "msg": b_msg}
    out["checks"]["mode_c"] = {"ok": c_ok, "msg": c_msg}
    out["checks"]["mode_d"] = {"ok": d_ok, "msg": d_msg}

    if a_ok:
        active_mode, active_msg = "A", a_msg
    elif b_ok:
        active_mode, active_msg = "B", b_msg
    elif c_ok:
        active_mode, active_msg = "C", c_msg
    elif d_ok:
        active_mode, active_msg = "D", d_msg
    else:
        active_mode, active_msg = None, None

    # 5. SL / TP
    sl      = _structural_sl(structure_labels, direction, price)
    tp      = _r(price + tp_pips * pip if direction == "bullish" else price - tp_pips * pip, price)
    sl_pips = round(abs(price - sl) / pip, 1)

    out.update({
        "direction": "BUY" if direction == "bullish" else "SELL",
        "entry":     _r(price, price),
        "sl":        sl,
        "tp":        tp,
        "sl_pips":   sl_pips,
        "tp_pips":   tp_pips,
        "mode":      active_mode,
    })

        # R:R gate — SL must not exceed 2× TP
    MAX_SL_RATIO = 2.0
    if active_mode and sl_pips > tp_pips * MAX_SL_RATIO:
        out["status"] = "yellow"
        out["reason"] = (
            f"{direction.capitalize()} · Mode {active_mode} setup valid "
            f"but SL {sl_pips:.0f}p too wide vs TP {tp_pips}p — waiting for tighter entry"
        )
    elif active_mode:
        out["status"] = "green"
        out["reason"] = (
            f"{direction.capitalize()} · Mode {active_mode}: {active_msg} · {sess_msg}"
        )
    else:
        out["status"] = "yellow"
        out["reason"] = f"Trend {direction} clear — no entry trigger yet"

    return out


# ── Endpoint ──────────────────────────────────────────────────────────────────
@router.get("/quick-scalp/scan")
async def quick_scalp_scan():
    """Scan all pairs for quick manual scalp opportunities."""
    broker_ts = get_latest_timestamp()
    if broker_ts is None:
        return {
            "signals":   [],
            "timestamp": 0,
            "error":     "MT5 offline — broker time unavailable",
        }
    now_ts = float(broker_ts)

    results = await asyncio.gather(
        *[_scan_symbol(sym, now_ts) for sym in SYMBOLS],
        return_exceptions=True,
    )
    signals = []
    for sym, res in zip(SYMBOLS, results):
        if isinstance(res, Exception):
            signals.append({
                "symbol":    sym,
                "status":    "red",
                "direction": None,
                "entry":     None,
                "sl":        None,
                "tp":        None,
                "sl_pips":   None,
                "tp_pips":   _tp_pips(sym),
                "mode":      None,
                "checks":    {},
                "reason":    str(res),
            })
        else:
            signals.append(res)

    return {"signals": signals, "timestamp": int(now_ts)}