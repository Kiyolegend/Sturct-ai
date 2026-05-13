# === FILE START ===
from fastapi import APIRouter, Query, HTTPException
import asyncio
import time
from services.data_service import fetch_ohlc, candles_to_dict
from services.zigzag_engine import detect_swings, swings_to_zigzag_lines
from services.structure_engine import classify_structure
from services.trend_engine import detect_trend
from services.bos_engine import detect_bos
from services.choch_engine import detect_choch
from services.trendline_engine import compute_trendlines
from services.zones_engine import detect_zones
from services.mtf_sr_engine import compute_mtf_sr_levels
from services.session_engine import compute_sessions

router = APIRouter()

async def _get_full_analysis(symbol: str, interval: str, outputsize: int):
    df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
    swings = detect_swings(df)
    structure_labels = classify_structure(swings)
    trend_data = detect_trend(structure_labels)
    trend = trend_data["trend"]
    bos_events = detect_bos(df, swings, structure_labels)
    choch_events = detect_choch(df, swings, structure_labels, trend)
    trendlines = compute_trendlines(structure_labels)
    zigzag_lines = swings_to_zigzag_lines(swings)
    current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
    zones = detect_zones(swings, interval, current_price)
    candles = candles_to_dict(df)
    return {
        "candles": candles,
        "swings": swings,
        "zigzag_lines": zigzag_lines,
        "structure_labels": structure_labels,
        "trend": trend_data,
        "bos": bos_events,
        "choch": choch_events,
        "trendlines": trendlines,
        "zones": zones,
    }

@router.get("/structure")
async def get_structure(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df)
        structure_labels = classify_structure(swings)
        zigzag_lines = swings_to_zigzag_lines(swings)
        return {
            "symbol": symbol,
            "interval": interval,
            "swings": swings,
            "zigzag_lines": zigzag_lines,
            "structure_labels": structure_labels,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/trend")
async def get_trend(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        return {"symbol": symbol, "interval": interval, **trend_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/bos")
async def get_bos(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df)
        structure_labels = classify_structure(swings)
        bos_events = detect_bos(df, swings, structure_labels)
        return {"symbol": symbol, "interval": interval, "bos": bos_events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/choch")
async def get_choch(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"])
        return {"symbol": symbol, "interval": interval, "choch": choch_events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/zones")
async def get_zones(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df)
        current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
        zones = detect_zones(swings, interval, current_price)
        return {"symbol": symbol, "interval": interval, "zones": zones}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/analysis")
async def get_full_analysis(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    """Full analysis endpoint — returns everything in one call for efficiency."""
    try:
        result = await _get_full_analysis(symbol, interval, outputsize)
        return {"symbol": symbol, "interval": interval, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions")
async def get_sessions(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=500, ge=100, le=1000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        sessions = compute_sessions(df, max_per_session=5)
        return {"symbol": symbol, "interval": interval, "sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/mtf-bias")
async def get_mtf_bias(
    symbol: str = Query(default="USD/JPY"),
):
    """
    Multi-timeframe bias: returns 15M, 1H and 4H trend direction.

    Also exposes current_price + last_high_price + last_low_price per timeframe
    so the frontend can show momentum warnings when price has moved beyond
    the most recent confirmed swing in the opposite direction of the bias.
    """
    try:
        df_15m, df_1h, df_4h = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="1h", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="4h", outputsize=150),
        )

        def _bias(df):
            swings = detect_swings(df)
            labels = classify_structure(swings)
            trend_data = detect_trend(labels)

            current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None

            last_high_price = None
            last_low_price = None
            for item in reversed(labels):
                lbl = item["label"]
                if lbl in ("HH", "LH") and last_high_price is None:
                    last_high_price = float(item["price"])
                if lbl in ("HL", "LL") and last_low_price is None:
                    last_low_price = float(item["price"])
                if last_high_price is not None and last_low_price is not None:
                    break

            return {
                "trend": trend_data["trend"],
                "confidence": trend_data["confidence"],
                "current_price": current_price,
                "last_high_price": last_high_price,
                "last_low_price": last_low_price,
            }

        t15m = _bias(df_15m)
        t1h = _bias(df_1h)
        t4h = _bias(df_4h)

        return {
            "symbol": symbol,
            "bias_15m": t15m,
            "bias_1h": t1h,
            "bias_4h": t4h,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/bos-choch")
async def get_bos_choch(
    symbol: str = Query(default="USD/JPY"),
    outputsize: int = Query(default=300, ge=50, le=1000),
):
    """
    1H Break of Structure + Change of Character levels.
    Returns the last 4 BOS events and last 2 CHOCH events.
    Only includes events from the last 48 hours (stale sweeps are excluded).
    """
    try:
        df = await fetch_ohlc(symbol=symbol, interval="1h", outputsize=outputsize)
        swings = detect_swings(df)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        bos_events = detect_bos(df, swings, structure_labels)
        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"])

        now = int(time.time())
        max_age = 48 * 3600  # 48 hours in seconds

        tagged_bos = [{"type": "BOS", **e} for e in bos_events[-4:] if now - e["time"] <= max_age]
        tagged_choch = [{"type": "CHOCH", **e} for e in choch_events[-2:] if now - e["time"] <= max_age]

        return {
            "symbol": symbol,
            "timeframe": "1h",
            "levels": tagged_bos + tagged_choch,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sr-levels")
async def get_sr_levels(
    symbol: str = Query(default="USD/JPY"),
    outputsize: int = Query(default=300, ge=50, le=1000),
):
    """
    Multi-timeframe Support/Resistance levels (15m, 1h, 4h).
    """
    try:
        df_15m, df_1h, df_4h = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="1h", outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="4h", outputsize=outputsize),
        )
        df_map = {"15m": df_15m, "1h": df_1h, "4h": df_4h}
        levels = compute_mtf_sr_levels(df_map)
        return {
            "symbol": symbol,
            "count": len(levels),
            "levels": levels,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# === FILE END ===
# ── Per-pair alert computation ────────────────────────────────────────────────

ALERT_SYMBOLS = [
    "USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY",
    "GBP/JPY", "AUD/USD", "USD/CAD", "USD/CHF",
]


def _pip_size(price: float) -> float:
    return 0.01 if price > 10 else 0.0001


def _detect_obs_py(candles: list, current_price: float) -> list:
    n = len(candles)
    if n < 10:
        return []
    pip       = _pip_size(current_price)
    min_size  = 5 * pip
    proximity = min(0.015, (60 * pip) / current_price)
    results   = []
    for i in range(1, n - 3):
        c        = candles[i]
        lookback = candles[max(0, i - 10):i]
        avg_range = (
            sum(x["high"] - x["low"] for x in lookback) / len(lookback)
            if lookback else 0
        )
        if c["close"] < c["open"]:
            sl = candles[i + 1: min(i + 6, n)]
            if not sl:
                continue
            if max(x["close"] for x in sl) > c["high"] and c["high"] - c["low"] >= min_size:
                brk = max(sl, key=lambda x: x["high"] - x["low"])
                if avg_range > 0 and (brk["high"] - brk["low"]) >= 1.5 * avg_range:
                    dist = abs((c["high"] + c["low"]) / 2 - current_price) / current_price
                    if dist <= proximity:
                        mitigated = any(f["close"] < c["low"] - 2 * pip for f in candles[i + 1:])
                        if not mitigated:
                            results.append({"type": "bullish", "top": c["high"], "bottom": c["low"], "dist": dist, "time": c["time"]})
        if c["close"] > c["open"]:
            sl = candles[i + 1: min(i + 6, n)]
            if not sl:
                continue
            if min(x["close"] for x in sl) < c["low"] and c["high"] - c["low"] >= min_size:
                brk = max(sl, key=lambda x: x["high"] - x["low"])
                if avg_range > 0 and (brk["high"] - brk["low"]) >= 1.5 * avg_range:
                    dist = abs((c["high"] + c["low"]) / 2 - current_price) / current_price
                    if dist <= proximity:
                        mitigated = any(f["close"] > c["high"] + 2 * pip for f in candles[i + 1:])
                        if not mitigated:
                            results.append({"type": "bearish", "top": c["high"], "bottom": c["low"], "dist": dist, "time": c["time"]})
    bull = sorted([o for o in results if o["type"] == "bullish" and (o["top"] + o["bottom"]) / 2 <= current_price], key=lambda x: x["dist"])[:1]
    bear = sorted([o for o in results if o["type"] == "bearish" and (o["top"] + o["bottom"]) / 2 >= current_price], key=lambda x: x["dist"])[:1]
    return bull + bear


def _detect_fvgs_py(candles: list, current_price: float) -> list:
    n = len(candles)
    if n < 3:
        return []
    pip       = _pip_size(current_price)
    min_gap   = 3 * pip
    proximity = 0.01
    results   = []
    for i in range(1, n - 1):
        prev = candles[i - 1]
        nxt  = candles[i + 1]
        if nxt["low"] > prev["high"] and nxt["low"] - prev["high"] >= min_gap:
            center = (nxt["low"] + prev["high"]) / 2
            dist   = abs(center - current_price) / current_price
            if dist <= proximity:
                mitigated = any(c["low"] <= prev["high"] for c in candles[i + 1:])
                if not mitigated:
                    results.append({"type": "bullish", "top": nxt["low"], "bottom": prev["high"], "dist": dist})
        if prev["low"] > nxt["high"] and prev["low"] - nxt["high"] >= min_gap:
            center = (prev["low"] + nxt["high"]) / 2
            dist   = abs(center - current_price) / current_price
            if dist <= proximity:
                mitigated = any(c["high"] >= prev["low"] for c in candles[i + 1:])
                if not mitigated:
                    results.append({"type": "bearish", "top": prev["low"], "bottom": nxt["high"], "dist": dist})
    bull = sorted([f for f in results if f["type"] == "bullish" and (f["top"] + f["bottom"]) / 2 <= current_price], key=lambda x: x["dist"])[:1]
    bear = sorted([f for f in results if f["type"] == "bearish" and (f["top"] + f["bottom"]) / 2 >= current_price], key=lambda x: x["dist"])[:1]
    return bull + bear


async def _compute_pair_alerts(symbol: str) -> dict:
    try:
        df_5m, df_15m, df_1h, df_4h = await asyncio.gather(
            fetch_ohlc(symbol, "5m",  200),
            fetch_ohlc(symbol, "15m", 150),
            fetch_ohlc(symbol, "1h",  150),
            fetch_ohlc(symbol, "4h",  150),
        )
    except Exception:
        return {"s1": "no-signal", "s2": "no-signal", "s3": "no-signal"}

    now = int(time.time())

    def _trend(df):
        swings = detect_swings(df)
        labels = classify_structure(swings)
        return detect_trend(labels)["trend"], swings, labels

    bias_4h, swings_4h, labels_4h    = _trend(df_4h)
    bias_1h, swings_1h, labels_1h    = _trend(df_1h)
    bias_15m, swings_15m, labels_15m = _trend(df_15m)
    bias_5m, swings_5m,  labels_5m  = _trend(df_5m)

    # ── S1: MTF Pullback ──────────────────────────────────────────────────────
    # Grey ONLY when 4H and 1H are both neutral — alignment literally impossible
    if bias_4h == "neutral" and bias_1h == "neutral":
        s1_state = "no-signal"
    elif bias_4h != "neutral" and bias_1h != "neutral" and bias_4h == bias_1h:
        # Aligned — check for active conditions
        dir_str = bias_4h
        bos_5m  = detect_bos(df_5m, swings_5m, labels_5m)
        recent_bos = [b for b in bos_5m if b["direction"] == dir_str and now - b["time"] <= 3600]
        target_label   = "HL" if dir_str == "bullish" else "LH"
        pullback_labels = [l for l in labels_15m if l["label"] == target_label and now - l["time"] <= 8 * 3600]
        if recent_bos and pullback_labels:
            s1_state = "active"
        else:
            s1_state = "waiting"
    else:
        # 4H or 1H partially aligned / one neutral — setup could still form
        s1_state = "waiting"

    # ── S2: Liquidity Sweep Reversal ──────────────────────────────────────────
    # Grey ONLY when 4H + 1H both strongly trending same direction — reversal impossible
    strongly_trending = bias_4h != "neutral" and bias_1h != "neutral" and bias_4h == bias_1h
    if strongly_trending:
        s2_state = "no-signal"
    else:
        # Market is mixed or neutral — S2 can develop, show at least amber
        choch_1h = detect_choch(df_1h, swings_1h, labels_1h, bias_1h)
        bos_1h   = detect_bos(df_1h, swings_1h, labels_1h)
        recent_sweep = (
            [c for c in choch_1h if now - c["time"] <= 3 * 3600] +
            [b for b in bos_1h   if now - b["time"] <= 3 * 3600]
        )
        if recent_sweep:
            sweep_dir = recent_sweep[0]["direction"]
            if bias_4h == "neutral" or bias_4h == sweep_dir:
                choch_5m  = detect_choch(df_5m, swings_5m, labels_5m, bias_5m)
                bos_5m_ev = detect_bos(df_5m, swings_5m, labels_5m)
                recent_rev = (
                    [c for c in choch_5m  if c["direction"] == sweep_dir and now - c["time"] <= 1200] +
                    [b for b in bos_5m_ev if b["direction"] == sweep_dir and now - b["time"] <= 1200]
                )
                s2_state = "active" if recent_rev else "waiting"
            else:
                s2_state = "waiting"  # sweep conflicts with 4H but still possible
        else:
            s2_state = "waiting"  # no recent sweep yet but market not strongly trending

    # ── S3: OB / FVG Reaction ─────────────────────────────────────────────────
    # Grey ONLY when 4H neutral — no directional context for an OB trade
    if bias_4h == "neutral":
        s3_state = "no-signal"
    else:
        dir_str         = bias_4h
        cp              = float(df_1h.iloc[-1]["close"])
        candles_1h_list = candles_to_dict(df_1h)
        candles_5m_list = candles_to_dict(df_5m)
        obs_1h          = _detect_obs_py(candles_1h_list, cp)
        ob              = next((o for o in obs_1h if o["type"] == dir_str), None)
        if ob:
            fvgs_5m    = _detect_fvgs_py(candles_5m_list, cp)
            fvg        = next((f for f in fvgs_5m if f["type"] == dir_str), None)
            inside_ob  = ob["bottom"] <= cp <= ob["top"]
            near_ob    = abs((ob["top"] + ob["bottom"]) / 2 - cp) / cp <= 0.003
            bos_5m_s3  = detect_bos(df_5m, swings_5m, labels_5m)
            confirm_5m = [b for b in bos_5m_s3 if b["direction"] == dir_str and now - b["time"] <= 3600]
            if (inside_ob or near_ob) and confirm_5m:
                s3_state = "active"
            else:
                s3_state = "waiting"  # OB exists, price not there yet
        else:
            # No OB near price — but 4H has bias, so flag as waiting
            # (OB might form or exist just outside proximity window)
            s3_state = "no-signal"

    return {"s1": s1_state, "s2": s2_state, "s3": s3_state}
@router.get("/alerts")
async def get_alerts():
    try:
        results = await asyncio.gather(
            *[_compute_pair_alerts(sym) for sym in ALERT_SYMBOLS],
            return_exceptions=True,
        )
        alerts = {}
        for sym, result in zip(ALERT_SYMBOLS, results):
            if isinstance(result, Exception):
                alerts[sym] = {"s1": "no-signal", "s2": "no-signal", "s3": "no-signal"}
            else:
                alerts[sym] = result
        return {"alerts": alerts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))