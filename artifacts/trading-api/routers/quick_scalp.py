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
from services.bos_engine import detect_bos

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


# ── Entry Mode E: Recent 5M BOS confirmation ──────────────────────────────────
def _mode_e(bos_events: list[dict], direction: str,
            latest_time: float) -> tuple[bool, str]:
    """
    Checks for a recent Break of Structure on 5M in the trend direction.
    Must be within the last 10 minutes (2 candles).
    This is the strongest momentum confirmation — structure actually broke.
    """
    if not bos_events:
        return False, "No BOS events"
    lookback = latest_time - (2 * 5 * 60)   # 10 minutes
    recent = [
        e for e in bos_events
        if e.get("time", 0) >= lookback and e.get("direction") == direction
    ]
    if not recent:
        return False, "No recent BOS in direction"
    latest_bos = recent[-1]
    return True, f"5M BOS {direction} @ {latest_bos.get('price', '?')}"


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
        bos_raw          = detect_bos(df, swings, structure_labels, trend_data.get("trend", "neutral"))
        r5m = {"structure_labels": structure_labels, "trend": trend_data,
               "choch": choch_events, "bos": bos_raw, "candles": candles_raw,
               "price": float(df["close"].iloc[-1]) if len(df) > 0 else 0.0}
        _cache_set(symbol, "5m", r5m)

        # Read MTF bias from cache — fall back to computing if cache empty
    r15m = _cache_get(symbol, "15m")
    if r15m is None:
        try:
            df15 = await fetch_ohlc(symbol=symbol, interval="15m", outputsize=100)
            sw15 = detect_swings(df15, fractal_n=5)
            r15m = {"trend": detect_trend(classify_structure(sw15))}
            _cache_set(symbol, "15m", r15m)
        except Exception:
            r15m = {}

    r1h = _cache_get(symbol, "1h")
    if r1h is None:
        try:
            df1h = await fetch_ohlc(symbol=symbol, interval="1h", outputsize=100)
            sw1h = detect_swings(df1h, fractal_n=3)
            r1h = {"trend": detect_trend(classify_structure(sw1h))}
            _cache_set(symbol, "1h", r1h)
        except Exception:
            r1h = {}

    r4h = _cache_get(symbol, "4h")
    if r4h is None:
        try:
            df4h = await fetch_ohlc(symbol=symbol, interval="4h", outputsize=80)
            sw4h = detect_swings(df4h, fractal_n=3)
            r4h = {"trend": detect_trend(classify_structure(sw4h))}
            _cache_set(symbol, "4h", r4h)
        except Exception:
            r4h = {}

    mtf_bias = {
        "bias_15m": r15m.get("trend") or {},
        "bias_1h":  r1h.get("trend")  or {},
        "bias_4h":  r4h.get("trend")  or {},
    }

    candles          = r5m.get("candles", [])
    structure_labels = r5m.get("structure_labels", [])
    trend_data       = r5m.get("trend", {})
    choch_events     = r5m.get("choch", [])
    bos_events       = r5m.get("bos", [])
    price            = r5m.get("price") or (candles[-1]["close"] if candles else 0.0)

    if not price:
        out["reason"] = "Price is zero"
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

    
    pip          = _pip(price)

    # 4. Entry modes — all evaluated, any one = GREEN
    a_ok, a_msg = _mode_a(candles, direction, choch_events)
    b_ok, b_msg = _mode_b(structure_labels, candles, direction, price)
    c_ok, c_msg = _mode_c(mtf_bias, candles, direction)
    d_ok, d_msg = _mode_d(mtf_bias, direction)
    e_ok, e_msg = _mode_e(bos_events, direction, candles[-1]["time"] if candles else 0)

    out["checks"]["mode_a"] = {"ok": a_ok, "msg": a_msg}
    out["checks"]["mode_b"] = {"ok": b_ok, "msg": b_msg}
    out["checks"]["mode_c"] = {"ok": c_ok, "msg": c_msg}
    out["checks"]["mode_d"] = {"ok": d_ok, "msg": d_msg}
    out["checks"]["mode_e"] = {"ok": e_ok, "msg": e_msg}

        
        # Modes A and E are momentum triggers — either one = GREEN (with context from B/C/D)
    # B/C/D alone = YELLOW
    momentum_ok   = a_ok or e_ok
    momentum_mode = ("A" if a_ok else "E") if momentum_ok else None
    momentum_msg  = (a_msg if a_ok else e_msg) if momentum_ok else None

    if momentum_ok:
        active_mode, active_msg, signal_ready = momentum_mode, momentum_msg, True
    elif b_ok or c_ok or d_ok:
        active_mode  = "B" if b_ok else ("C" if c_ok else "D")
        active_msg   = b_msg if b_ok else (c_msg if c_ok else d_msg)
        signal_ready = False
    else:
        active_mode, active_msg, signal_ready = None, None, False

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
    if active_mode and signal_ready and sl_pips <= tp_pips * MAX_SL_RATIO:
        out["status"] = "green"
        out["reason"] = (
            f"{direction.capitalize()} · Mode {active_mode}: {active_msg} · {sess_msg}"
        )
    elif active_mode:
        out["status"] = "yellow"
        out["reason"] = (
            f"{direction.capitalize()} · Mode {active_mode}: {active_msg} — awaiting momentum candle"
            if not signal_ready
            else f"{direction.capitalize()} · Mode {active_mode} — SL {sl_pips:.0f}p too wide vs TP {tp_pips}p"
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