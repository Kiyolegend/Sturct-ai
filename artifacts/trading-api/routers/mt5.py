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
import asyncio
from ws_manager import broadcast



from services.mt5_store import store_candles, status as mt5_status, get_latest_timestamp, VALID_INTERVALS
_bg_tasks: set = set()

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

class SymbolSpec(BaseModel):
    symbol: str
    mt5_symbol: str
    point: float
    digits: int
    display_pip_size: float
    trade_tick_size: float
    trade_tick_value: float
    trade_tick_value_profit: float
    trade_tick_value_loss: float
    trade_contract_size: float
    volume_min: float
    volume_max: float
    volume_step: float
    trade_stops_level: int
    trade_freeze_level: int
    currency_profit: str
    currency_margin: str


class MT5SpecsPayload(BaseModel):
    specs: list[SymbolSpec]


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
    
    _task = asyncio.create_task(broadcast({"type": "candle", "symbol": payload.symbol, "interval": payload.interval}))
    _bg_tasks.add(_task)
    _task.add_done_callback(_bg_tasks.discard)

    return {
        "ok": True,
        "symbol": payload.symbol,
        "interval": payload.interval,
        "candles_received": len(df),
        "latest_candle": payload.candles[-1].time,
    }
@router.post("/mt5/specs")
async def mt5_specs(
    payload: MT5SpecsPayload,
    x_mt5_secret: str = Header(default=""),
):
    if MT5_SECRET and x_mt5_secret != MT5_SECRET:
        raise HTTPException(
            status_code=401,
            detail="Invalid MT5 bridge secret",
        )

    from services.mt5_store import store_symbol_specs

    store_symbol_specs([
        spec.model_dump()
        for spec in payload.specs
    ])

    return {
        "ok": True,
        "specs_received": len(payload.specs),
    }

@router.get("/instrument-spec")
async def instrument_spec(symbol: str):
    from services.mt5_store import get_symbol_spec

    spec = get_symbol_spec(symbol)

    if not spec:
        raise HTTPException(
            status_code=503,
            detail=f"MT5 specification unavailable for {symbol}",
        )

    return spec

@router.get("/mt5/status")
async def mt5_status_endpoint():
    return mt5_status()



@router.get("/mt5/server-time")
async def mt5_server_time():
    """Returns last broker candle timestamp. Frontend uses this instead of Date.now()."""
    ts = get_latest_timestamp()
    return {"broker_time": ts if ts is not None else int(time.time())}
