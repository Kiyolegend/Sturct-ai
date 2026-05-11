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