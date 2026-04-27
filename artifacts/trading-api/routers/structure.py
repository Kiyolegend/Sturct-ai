from fastapi import APIRouter, Query, HTTPException
import asyncio
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
    zones = detect_zones(swings, interval)
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
        zones = detect_zones(swings, interval)
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
    """
    Returns trading session boxes (Asian, London, New York) derived from
    the actual candle data.  Each box: {session, start_time, end_time, high, low}
    """
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
    Multi-timeframe bias: returns 1H and 4H trend direction.
    Uses the same structure engine — swings → labels → trend.
    outputsize=150 is sufficient to capture enough swings for reliable bias.
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
            return detect_trend(labels)

        t15m = _bias(df_15m)
        t1h = _bias(df_1h)
        t4h = _bias(df_4h)

        return {
            "symbol": symbol,
            "bias_15m": {
                "trend":      t15m["trend"],
                "confidence": t15m["confidence"],
            },
            "bias_1h": {
                "trend":      t1h["trend"],
                "confidence": t1h["confidence"],
            },
            "bias_4h": {
                "trend":      t4h["trend"],
                "confidence": t4h["confidence"],
            },
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

    Always uses the 1H timeframe — these are drawn as context lines on any chart.
    Returns the last 4 BOS events and last 2 CHOCH events (most recent = most relevant).
    """
    try:
        df = await fetch_ohlc(symbol=symbol, interval="1h", outputsize=outputsize)
        swings = detect_swings(df)
        structure_labels = classify_structure(swings)
        trend_data = detect_trend(structure_labels)
        bos_events = detect_bos(df, swings, structure_labels)
        choch_events = detect_choch(df, swings, structure_labels, trend_data["trend"])

        # Tag with type and trim to avoid chart clutter
        tagged_bos = [{"type": "BOS", **e} for e in bos_events[-4:]]
        tagged_choch = [{"type": "CHOCH", **e} for e in choch_events[-2:]]

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
    Multi-timeframe Support/Resistance levels.

    Fetches 15m, 1h, and 4h candles in parallel, detects swing clusters,
    and returns labelled S/R levels.

    - Resistance (swing HIGH clusters) → colour: yellow on chart
    - Support    (swing LOW clusters)  → colour: purple on chart

    Each level includes: price, kind, timeframe, touches.
    Higher-timeframe levels take priority when the same area appears on multiple TFs.
    """
    try:
        df_15m, df_1h, df_4h = await asyncio.gather(
            fetch_ohlc(symbol=symbol, interval="15m", outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="1h",  outputsize=outputsize),
            fetch_ohlc(symbol=symbol, interval="4h",  outputsize=outputsize),
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
