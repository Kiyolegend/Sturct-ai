from fastapi import APIRouter, Query, HTTPException
from services.data_service import fetch_ohlc, candles_to_dict

router = APIRouter()


@router.get("/data")
async def get_data(
    symbol: str = Query(default="USD/JPY"),
    interval: str = Query(default="5m"),
    outputsize: int = Query(default=200, ge=10, le=5000),
):
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        candles = candles_to_dict(df)
        return {
            "symbol": symbol,
            "interval": interval,
            "count": len(candles),
            "candles": candles,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
