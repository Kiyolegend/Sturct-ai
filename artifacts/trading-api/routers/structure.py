# === FILE START ===
from fastapi import APIRouter, Query, HTTPException
import asyncio
import time
from services.data_service import fetch_ohlc, candles_to_dict
from services.structure_cache import set_result as _cache_set
from services.structure_cache import get_result as _cache_get
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
    cached = _cache_get(symbol, interval)
    if cached:
        return cached
    df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
    swings = detect_swings(df, fractal_n=3 if interval in ("1h", "4h") else 5)
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
    _bos_hours = {"5m": 8, "15m": 48, "1h": 72, "4h": 336}.get(interval, 48)
    bos_events = detect_bos(df, swings, structure_labels, trend_data["trend"], lookback_hours=_bos_hours)
    _choch_hours = {"5m": 8, "15m": 24, "1h": 72, "4h": 336}.get(interval, 24)
    choch_events = detect_choch(df, swings, structure_labels, trend, lookback_hours=_choch_hours)
    trendlines = compute_trendlines(structure_labels)
    zigzag_lines = swings_to_zigzag_lines(swings)
    current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
    zones = detect_zones(swings, interval, current_price)
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
    _cache_set(symbol, interval, result)
    return result

@router.get("/structure")
async def get_structure(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        swings = detect_swings(df, fractal_n=3 if interval in ("1h", "4h") else 5)
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
        swings = detect_swings(df, fractal_n=3 if interval in ("1h", "4h") else 5)
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
        swings = detect_swings(df, fractal_n=3 if interval in ("1h", "4h") else 5)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        _bos_hours = {"5m": 8, "15m": 48, "1h": 72, "4h": 336}.get(interval, 48)
        bos_events = detect_bos(df, swings, structure_labels, trend_data["trend"], lookback_hours=_bos_hours)
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
        swings = detect_swings(df, fractal_n=3 if interval in ("1h", "4h") else 5)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        _choch_hours = {"5m": 8, "15m": 24, "1h": 72, "4h": 336}.get(interval, 24)
        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"], lookback_hours=_choch_hours)
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
        swings = detect_swings(df, fractal_n=3 if interval in ("1h", "4h") else 5)
        current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None
        zones = detect_zones(swings, interval, current_price)
        return {"symbol": symbol, "interval": interval, "zones": zones}
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

        def _bias(df, fractal_n: int = 5):
            swings = detect_swings(df, fractal_n=fractal_n)
            labels = classify_structure(swings)
            trend_data = detect_trend(labels)

            current_price = float(df["close"].iloc[-1]) if len(df) > 0 else None

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

            return {
                "trend":           trend_data["trend"],
                "confidence":      trend_data["confidence"],
                "current_price":   current_price,
                "last_high_price": last_high_price,
                "last_low_price":  last_low_price,
                "last_swing_time": last_swing_time,
            }

        t15m = _bias(df_15m, fractal_n=5)
        t1h  = _bias(df_1h,  fractal_n=3)
        t4h  = _bias(df_4h,  fractal_n=3)

        

        return {
            "symbol": symbol,
            "bias_15m": t15m,
            "bias_1h": t1h,
            "bias_4h": t4h,
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
    Only includes events from the last 48 hours (stale sweeps are excluded).
    """
    try:
        df = await fetch_ohlc(symbol=symbol, interval="1h", outputsize=outputsize)
        swings = detect_swings(df, fractal_n=3)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        _bos_hours = 72
        bos_events = detect_bos(df, swings, structure_labels, trend_data["trend"], lookback_hours=_bos_hours)


        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"], lookback_hours=72)

        now = int(df.iloc[-1]["time"].timestamp())
        max_age = 72 * 3600  # 48 hours in seconds

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
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# === FILE END ===
