"""
MT5 Bridge router.

POST /trading-api/mt5/push   — Windows bridge pushes OHLC data here
GET  /trading-api/mt5/status — Dashboard checks if MT5 is online
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import pandas as pd
import os
import time

from services.mt5_store import store_candles, status as mt5_status, VALID_INTERVALS

router = APIRouter()

# Simple shared secret so only your bridge can push data.
# Set MT5_BRIDGE_SECRET in Replit secrets; bridge sends it as X-MT5-Secret header.
MT5_SECRET = os.environ.get("MT5_BRIDGE_SECRET", "")


class OHLCCandle(BaseModel):
    time: int        # Unix timestamp (seconds)
    open: float
    high: float
    low: float
    close: float


class MT5PushPayload(BaseModel):
    symbol: str      # e.g. "USD/JPY"
    interval: str    # "5m" | "15m" | "1h" | "4h"
    candles: list[OHLCCandle]


@router.post("/mt5/push")
async def mt5_push(
    payload: MT5PushPayload,
    x_mt5_secret: str = Header(default=""),
):
    # Validate secret (skip check if no secret is configured — dev mode)
    if MT5_SECRET and x_mt5_secret != MT5_SECRET:
        raise HTTPException(status_code=401, detail="Invalid MT5 bridge secret")

    if payload.interval not in VALID_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"interval must be one of {sorted(VALID_INTERVALS)}"
        )

    if len(payload.candles) < 10:
        raise HTTPException(status_code=400, detail="Need at least 10 candles")

    rows = [
        {
            "time": pd.Timestamp(c.time, unit="s", tz="UTC").tz_localize(None),
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
        }
        for c in payload.candles
    ]
    df = pd.DataFrame(rows)
    df = df.sort_values("time").reset_index(drop=True)

    store_candles(payload.symbol, payload.interval, df)

    return {
        "ok": True,
        "symbol": payload.symbol,
        "interval": payload.interval,
        "candles_received": len(df),
        "latest_candle": payload.candles[-1].time,
    }


@router.get("/mt5/status")
async def mt5_status_endpoint():
    return mt5_status()
