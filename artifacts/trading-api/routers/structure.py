# === FILE START ===
from fastapi import APIRouter, Query, HTTPException
import asyncio
import time
from services.data_service import fetch_ohlc, candles_to_dict
import math


from services.zigzag_engine import detect_swings, swings_to_zigzag_lines, TF_FRACTAL_N

from services.structure_engine import classify_structure
from services.trend_engine import detect_trend
from services.bos_engine import detect_bos
from services.choch_engine import detect_choch
from services.trendline_engine import compute_trendlines
from services.zones_engine import detect_zones
from services.mtf_sr_engine import compute_mtf_sr_levels
from services.session_engine import compute_sessions
from services.candle_pattern_engine import detect_candle_patterns
from services.confluence_engine import find_confluence
from services.framework_checker import detect_order_blocks
from services.atr_utils import compute_atr14
from services.momentum_engine import compute_momentum
from services.fvg_engine import detect_fvgs
router = APIRouter()
# Health formula version — bump this when weights or components change
HEALTH_VERSION = 1
async def _get_full_analysis(symbol: str, interval: str, outputsize: int):
    
    
        
    df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
    tf_fractal_n = TF_FRACTAL_N.get(interval, 5)
    swings = detect_swings(df, fractal_n=tf_fractal_n, timeframe=interval)
    structure_labels = classify_structure(swings)
    trend_data = detect_trend(structure_labels)
    last_high_price = None
    last_low_price  = None
    for _item in reversed(structure_labels):
        _lbl = _item.get("label", "")
        if _lbl in ("HH", "LH", "EQH") and last_high_price is None:
            last_high_price = float(_item["price"])
        if _lbl in ("HL", "LL", "EQL") and last_low_price is None:
            last_low_price = float(_item["price"])
        if last_high_price is not None and last_low_price is not None:
            break
    trend_data["last_high_price"] = last_high_price
    trend_data["last_low_price"]  = last_low_price
    trend = trend_data["trend"]
    _bos_hours   = {"5m": 8, "15m": 48, "1h": 72, "4h": 336, "d1": 8760, "w1": 87600}.get(interval, 48)
    bos_events = detect_bos(df, swings, structure_labels, trend_data["trend"], lookback_hours=_bos_hours, fractal_n=tf_fractal_n)
    _choch_hours = {"5m": 8, "15m": 24, "1h": 72, "4h": 336, "d1": 4320, "w1": 43800}.get(interval, 24)
    choch_events = detect_choch(df, swings, structure_labels, trend, lookback_hours=_choch_hours, fractal_n=tf_fractal_n)
    current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
    latest_time   = int(df["time"].astype("datetime64[s]").astype("int64").iloc[-1]) if len(df) > 0 else None
    _bar_secs     = {"5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "d1": 86400, "w1": 604800}.get(interval, 900)
    trendlines    = compute_trendlines(structure_labels, current_price=current_price, latest_time=latest_time, bar_seconds=_bar_secs)
    zigzag_lines  = swings_to_zigzag_lines(swings)
    zones         = detect_zones(swings, interval, current_price, df=df)
    candles = candles_to_dict(df)
    result = {
        "current_price": current_price,
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
    
    return result

@router.get("/structure")
async def get_structure(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df, fractal_n=TF_FRACTAL_N.get(interval, 5), timeframe=interval)
        structure_labels = classify_structure(swings)
        zigzag_lines = swings_to_zigzag_lines(swings)
        return {
            "symbol": symbol,
            "interval": interval,
            "swings": swings,
            "zigzag_lines": zigzag_lines,
            "structure_labels": structure_labels,
        }
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e) )

@router.get("/trend")
async def get_trend(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df, fractal_n=TF_FRACTAL_N.get(interval, 5), timeframe=interval)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        return {"symbol": symbol, "interval": interval, **trend_data}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
        tf_fractal_n = TF_FRACTAL_N.get(interval, 5)
        swings = detect_swings(df, fractal_n=tf_fractal_n, timeframe=interval)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        _bos_hours = {"5m": 8, "15m": 48, "1h": 72, "4h": 336, "d1": 8760, "w1": 87600}.get(interval, 48)
        bos_events = detect_bos(df, swings, structure_labels, trend_data["trend"], lookback_hours=_bos_hours, fractal_n=tf_fractal_n)
        return {"symbol": symbol, "interval": interval, "bos": bos_events}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
        tf_fractal_n = TF_FRACTAL_N.get(interval, 5)
        swings = detect_swings(df, fractal_n=tf_fractal_n, timeframe=interval)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        _choch_hours = {"5m": 8, "15m": 24, "1h": 72, "4h": 336, "d1": 4320, "w1": 43800}.get(interval, 24)
        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"], lookback_hours=_choch_hours, fractal_n=tf_fractal_n)
        return {"symbol": symbol, "interval": interval, "choch": choch_events}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
        swings = detect_swings(df, fractal_n=TF_FRACTAL_N.get(interval, 5), timeframe=interval)
        current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
        zones = detect_zones(swings, interval, current_price, df=df)
        return {"symbol": symbol, "interval": interval, "zones": zones}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/zones-mtf")
async def get_zones_mtf(
    symbol: str = Query(default="USD/JPY"),
):
    """
    Multi-timeframe supply/demand zones.
    Returns W1, D1, 4H, and 1H zones so the dashboard can overlay
    higher-timeframe zones on any active chart timeframe.
    """
    try:
        df_w1, df_d1, df_4h, df_1h = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="w1", outputsize=300),
            fetch_ohlc(symbol=symbol, interval="d1", outputsize=365),
            fetch_ohlc(symbol=symbol, interval="4h", outputsize=400),
            fetch_ohlc(symbol=symbol, interval="1h", outputsize=400),
        )

        def _zones(df, interval: str) -> list:
            if len(df) == 0:
                return []
            swings = detect_swings(df, fractal_n=TF_FRACTAL_N.get(interval, 3), timeframe=interval)
            current_price = float(df["close"].iloc[-1])
            return detect_zones(swings, interval, current_price, df=df)

        return {
            "symbol": symbol,
            "zones_w1": _zones(df_w1, "w1"),
            "zones_d1": _zones(df_d1, "d1"),
            "zones_4h": _zones(df_4h, "4h"),
            "zones_1h": _zones(df_1h, "1h"),
        }
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _get_proximity(symbol: str, interval: str) -> float:
    """Return proximity_pips appropriate for the symbol's asset class."""
    _BTC = {"15m": 50,  "1h": 100, "4h": 200, "d1": 500,  "w1": 1000}
    _XAU = {"15m": 20,  "1h": 40,  "4h": 80,  "d1": 200,  "w1": 400}
    _FX  = {"15m": 6,   "1h": 10,  "4h": 15,  "d1": 20,   "w1": 30}
    sym = symbol.upper()
    if "BTC" in sym: return _BTC.get(interval, 50)
    if "XAU" in sym: return _XAU.get(interval, 20)
    return _FX.get(interval, 6)

@router.get("/patterns")
async def get_patterns(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df, fractal_n=TF_FRACTAL_N.get(interval, 5), timeframe=interval)
        current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
        zones = detect_zones(swings, interval, current_price, df=df)
        patterns = detect_candle_patterns(df, swings, zones, proximity_pips=_get_proximity(symbol, interval))
        return {"symbol": symbol, "interval": interval, "patterns": patterns}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pattern-summary")
async def get_pattern_summary(
    symbol: str = Query(default="USD/JPY"),
):
    try:
        df_15m, df_1h, df_4h, df_d1, df_w1 = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="1h", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="4h", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="d1", outputsize=365),
            fetch_ohlc(symbol=symbol, interval="w1", outputsize=300),
        )
        def _last_pattern(df, fractal_n: int, interval: str):
            swings = detect_swings(df, fractal_n=fractal_n, timeframe=interval)
            current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
            zones = detect_zones(swings, interval, current_price, df=df)
            patterns = detect_candle_patterns(df, swings, zones, proximity_pips=_get_proximity(symbol, interval))
            return patterns[0] if patterns else None
        return {
            "symbol": symbol,
            "pattern_15m": _last_pattern(df_15m, TF_FRACTAL_N.get("15m", 5), "15m"),
            "pattern_1h":  _last_pattern(df_1h,  TF_FRACTAL_N.get("1h",  5), "1h"),
            "pattern_4h":  _last_pattern(df_4h,  TF_FRACTAL_N.get("4h",  5), "4h"),
            "pattern_d1":  _last_pattern(df_d1,  TF_FRACTAL_N.get("d1",  5), "d1"),
            "pattern_w1":  _last_pattern(df_w1,  TF_FRACTAL_N.get("w1",  5), "w1"),
        }
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/mtf-bias")
async def get_mtf_bias(
    symbol: str = Query(default="USD/JPY"),
    debug: bool = Query(default=True),
):
    """
    Multi-timeframe bias: returns 15M, 1H and 4H trend direction.

    Also exposes current_price + last_high_price + last_low_price per timeframe
    so the frontend can show momentum warnings when price has moved beyond
    the most recent confirmed swing in the opposite direction of the bias.
    """
    try:
        df_15m, df_1h, df_4h, df_d1, df_w1 = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="1h", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="4h", outputsize=150),
            fetch_ohlc(symbol=symbol, interval="d1",  outputsize=365),
            fetch_ohlc(symbol=symbol, interval="w1",  outputsize=300),
        )

        def _bias(df, fractal_n: int = 5, timeframe: str = "1h", debug: bool = True):
            swings     = detect_swings(df, fractal_n=fractal_n, timeframe=timeframe)
            labels     = classify_structure(swings)
            trend_data = detect_trend(labels)
            trend      = trend_data["trend"]

            current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
            _bar_secs = {"15m": 900, "1h": 3600, "4h": 14400, "d1": 86400, "w1": 604800}.get(timeframe, 900)
            now_ts = (int(df["time"].astype("datetime64[s]").astype("int64").iloc[-1]) + _bar_secs) if len(df) > 0 else 0

            # ── Last confirmed swing prices + times ────────────────────
            last_high_price = None
            last_low_price  = None
            last_high_time  = None
            last_low_time   = None
            for item in reversed(labels):
                lbl = item["label"]
                if lbl in ("HH", "LH", "EQH") and last_high_price is None:
                    last_high_price = float(item["price"])
                    last_high_time  = item.get("time")
                if lbl in ("HL", "LL", "EQL") and last_low_price is None:
                    last_low_price = float(item["price"])
                    last_low_time  = item.get("time")
                if last_high_price is not None and last_low_price is not None:
                    break

            times = [t for t in (last_high_time, last_low_time) if t is not None]
            last_swing_time = max(times) if times else None

            # ── True ATR-14 (shared utility, correct gap-aware formula) ─
            atr_14 = compute_atr14(df)
            # ── Fibonacci anchor size guard ────────────────────────────
            # Reject swing pairs that are too small to be a meaningful
            # institutional move. Minimum = 1× ATR-14 for the timeframe.
            # If the pair fails, both go None → frontend shows no golden zone
            # (already handles None: "if (!hi || !lo || hi <= lo) return []")
            _MIN_FIB_ATR = 1.0
            if (last_high_price is not None and last_low_price is not None
                    and (last_high_price - last_low_price) < _MIN_FIB_ATR * atr_14):
                last_high_price = None
                last_low_price  = None
            # ── Momentum regime ────────────────────────────────────────
            momentum = compute_momentum(df, atr_14)   
            # ── BOS and CHoCH ──────────────────────────────────────────

            # ── BOS and CHoCH ───────────────────────────────────────────
            _bos_hours   = {"15m": 48, "1h": 72, "4h": 336, "d1": 8760,  "w1": 87600}.get(timeframe, 48)
            _choch_hours = {"15m": 24, "1h": 72, "4h": 336, "d1": 4320,  "w1": 43800}.get(timeframe, 24)

            # "neutral" trend arg so detect_bos returns ALL directions;
            # we then isolate opposing events ourselves for health scoring.
            all_bos   = detect_bos(df, swings, labels, "neutral",
                                   lookback_hours=_bos_hours, fractal_n=fractal_n)
            # detect_choch already returns only opposing events when given the current trend
            all_choch = detect_choch(df, swings, labels, trend,
                                     lookback_hours=_choch_hours, fractal_n=fractal_n)

            # Latest event opposing the current trend
            opp_bos   = [b for b in all_bos if b["direction"] != trend] if trend != "neutral" else all_bos
            latest_opp_bos   = opp_bos[-1]   if opp_bos   else None
            latest_opp_choch = all_choch[-1] if all_choch else None

            # ── Trend health: weighted score 0-100 ──────────────────────
            # Component 1 (40%): trend integrity — how clean are the swing labels?
            _integrity_map = {
                ("HH", "HL"): 100,   # textbook bullish
                ("LH", "LL"): 100,   # textbook bearish
                ("EQH", "HL"):  65,  # weakly bullish
                ("LH", "EQL"):  65,  # weakly bearish
            }
            integrity = _integrity_map.get(
                (trend_data.get("last_high_label"), trend_data.get("last_low_label")), 35
            )

            # Component 2 (25%): structural confidence (existing metric, unchanged)
            struct_score = trend_data["confidence"]

            # Component 3 (20%): freshness — bars since the last confirmed swing
            bars_since_swing = (
                round((now_ts - last_swing_time) / _bar_secs)
                if last_swing_time and now_ts else 20
            )
            freshness = max(0, round(100 * math.exp(-bars_since_swing / 15)))

            # Component 4 (15%): event alignment — opposing BOS / CHoCH recency
            _bars_opp_choch = (
                round((now_ts - latest_opp_choch["time"]) / _bar_secs)
                if latest_opp_choch and now_ts else None
            )
            _bars_opp_bos = (
                round((now_ts - latest_opp_bos["time"]) / _bar_secs)
                if latest_opp_bos and now_ts else None
            )

            if latest_opp_choch is not None and _bars_opp_choch is not None and _bars_opp_choch < 5:
                alignment = 10   # fresh opposing CHoCH — strong structural warning
            elif latest_opp_choch is not None:
                alignment = 50   # older opposing CHoCH — moderate
            elif latest_opp_bos is not None and _bars_opp_bos is not None and _bars_opp_bos < 5:
                alignment = 40   # fresh opposing BOS
            elif latest_opp_bos is not None:
                alignment = 75   # older opposing BOS — minor concern
            else:
                alignment = 100  # no opposing structural events

            trend_health = round(
                integrity    * 0.40 +
                struct_score * 0.25 +
                freshness    * 0.20 +
                alignment    * 0.15
            )

            # ── Helper: structured event object with age ────────────────
            def _event_obj(ev):
                if ev is None:
                    return None
                age_secs = (now_ts - ev["time"]) if now_ts and ev.get("time") else 0
                return {
                    "direction": ev["direction"],
                    "time":      ev["time"],
                    "price":     ev["price"],
                    "age_hours": round(age_secs / 3600, 1),
                    "age_bars":  round(age_secs / _bar_secs),
                }

            out = {
                # ── Existing fields (UNCHANGED — no consumer breaks) ───
                "trend":               trend_data["trend"],
                "confidence":          trend_data["confidence"],
                "current_price":       current_price,
                "last_high_price":     last_high_price,
                "last_low_price":      last_low_price,
                "last_swing_time":     last_swing_time,
                # ── New additive fields ────────────────────────────────
                "atr_14":              round(atr_14, 6),
                "momentum":            momentum,
                "trend_health":        trend_health,
                "trend_health_version": HEALTH_VERSION,
                "latest_bos":          _event_obj(latest_opp_bos),
                "latest_choch":        _event_obj(latest_opp_choch),
            }
            if debug:
                out["health_breakdown"] = {
                    "integrity":  integrity,
                    "confidence": struct_score,
                    "freshness":  freshness,
                    "alignment":  alignment,
                }
            return out

        t15m = _bias(df_15m, fractal_n=5, timeframe="15m", debug=debug)
        t1h  = _bias(df_1h,  fractal_n=3, timeframe="1h",  debug=debug)
        t4h  = _bias(df_4h,  fractal_n=3, timeframe="4h",  debug=debug)
        td1  = _bias(df_d1,  fractal_n=3, timeframe="d1",  debug=debug)
        tw1  = _bias(df_w1,  fractal_n=2, timeframe="w1",  debug=debug)

        

        return {
            "symbol": symbol,
            "bias_15m": t15m,
            "bias_1h": t1h,
            "bias_4h": t4h,
            "bias_d1": td1,
            "bias_w1": tw1,
        }
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
    Only includes events from the last 72 hours (stale sweeps are excluded).
    """
    try:
        df = await fetch_ohlc(symbol=symbol, interval="1h", outputsize=outputsize)
        swings = detect_swings(df, fractal_n=3, timeframe="1h")
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        _bos_hours = 72
        bos_events = detect_bos(df, swings, structure_labels, trend_data["trend"], lookback_hours=_bos_hours, fractal_n=3)


        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"], lookback_hours=72, fractal_n=3)

        now = int(df.iloc[-1]["time"].timestamp())
        max_age = 72 * 3600  # 72 hours in seconds

        tagged_bos = [{"type": "BOS", **e} for e in bos_events[-4:] if now - e["time"] <= max_age]
        tagged_choch = [{"type": "CHOCH", **e} for e in choch_events[-2:] if now - e["time"] <= max_age]

        # Deduplicate: if a level appears in both lists, CHOCH wins (it's more specific)
        choch_prices = {round(c["price"], 5) for c in tagged_choch}
        deduped_bos = [b for b in tagged_bos if round(b["price"], 5) not in choch_prices]

        return {
            "symbol": symbol,
            "timeframe": "1h",
            "levels": deduped_bos + tagged_choch,
}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sr-levels")
async def get_sr_levels(
    symbol: str = Query(default="USD/JPY"),
    outputsize: int = Query(default=300, ge=50, le=1000),
):
    """
    Multi-timeframe Support/Resistance levels (15m, 1h, 4h, d1, w1).
    """
    try:
        df_15m, df_1h, df_4h, df_d1, df_w1 = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="1h",  outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="4h",  outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="d1",  outputsize=365),
            fetch_ohlc(symbol=symbol, interval="w1",  outputsize=300),
        )
        df_map = {"15m": df_15m, "1h": df_1h, "4h": df_4h, "d1": df_d1, "w1": df_w1}
        levels = compute_mtf_sr_levels(df_map)
        return {
            "symbol": symbol,
            "count": len(levels),
            "levels": levels,
        }
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# === FILE END ===


@router.get("/confluence")
async def get_confluence(
    symbol:     str = Query(default="USD/JPY"),
    outputsize: int = Query(default=300, ge=50, le=1000),
):
    """
    Detect confluence points: S/R levels that fall inside S/D zones.
    Only returns aligned hits (resistance in supply, support in demand).
    """
    try:
        df_15m, df_1h, df_4h, df_d1, df_w1 = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="1h",  outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="4h",  outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="d1",  outputsize=365),
            fetch_ohlc(symbol=symbol, interval="w1",  outputsize=300),
        )
        df_map = {"15m": df_15m, "1h": df_1h, "4h": df_4h, "d1": df_d1, "w1": df_w1}

        # Current price from smallest available TF
        current_price = float(df_15m["close"].iloc[-1])

        # S/R levels across all timeframes
        sr_levels = compute_mtf_sr_levels(df_map)

        
        # Zones, OBs, and FVGs — single pass per timeframe.
        # BOS + CHoCH are computed here and passed as the structural gate
        # for OB detection. No new imports needed — all already at top of file.
        all_zones: list[dict] = []
        all_obs:   list[dict] = []
        all_fvgs:  list[dict] = []
        _bos_lookback   = {"15m": 48, "1h": 72, "4h": 336, "d1": 8760,  "w1": 87600}
        _choch_lookback = {"15m": 24, "1h": 72, "4h": 336, "d1": 4320,  "w1": 43800}
        for tf, df in [
            ("15m", df_15m), ("1h", df_1h), ("4h", df_4h),
            ("d1",  df_d1),  ("w1", df_w1),
        ]:
            fractal_n = TF_FRACTAL_N.get(tf, 5)
            swings    = detect_swings(df, fractal_n=fractal_n, timeframe=tf)
            all_zones.extend(detect_zones(swings, tf, current_price, df=df))
            try:
                labels = classify_structure(swings)
                trend  = detect_trend(labels).get("trend", "neutral")
                bos    = detect_bos(df, swings, labels, trend,
                                    lookback_hours=_bos_lookback.get(tf, 48),
                                    fractal_n=fractal_n)
                choch  = detect_choch(df, swings, labels, trend,
                                      lookback_hours=_choch_lookback.get(tf, 24),
                                      fractal_n=fractal_n)
                clist = [
                    {
                        "time":  int(r["time"].value // 10**9) if hasattr(r["time"], "value") else int(r["time"]),
                        "open":  float(r["open"]),  "high": float(r["high"]),
                        "low":   float(r["low"]),   "close": float(r["close"]),
                    }
                    for _, r in df.iterrows()
                ]
                all_obs.extend(detect_order_blocks(clist, current_price, tf,
                                                   structural_breaks=bos + choch))
                all_fvgs.extend(detect_fvgs(df, tf, current_price, structural_breaks=bos + choch))
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(
                    f"OB/FVG computation failed for {symbol} {tf}: {e}"
                )

        hits = find_confluence(sr_levels, all_zones, current_price, obs=all_obs, fvgs=all_fvgs)


        return {
            "symbol":     symbol,
            "count":      len(hits),
            "confluence": hits,
        }

    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))