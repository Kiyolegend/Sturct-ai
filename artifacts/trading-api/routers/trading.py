"""
Trade execution router — STRUCT.ai manual trading.

Dashboard sends orders here → bridge polls and executes on MT5 → result reported back.

Fixes applied (all other logic unchanged):
  FIX 1 — In-flight tracking: orders move to _in_flight on delivery to bridge and
           are removed only when the bridge posts a result. Prevents silent loss if
           the HTTP response fails after _pending_orders.clear(). The state stays
           visible at GET /trade/inflight for debugging.
  FIX 2 — SL/TP server-side validation for LIMIT orders (entry price is known).
           MARKET orders: validates SL != TP and both > 0.
  FIX 3 — Symbol allowlist: rejects unknown symbols immediately with a clear error.
  FIX 4 — Full UUID4 order IDs (no [:8] truncation).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from services.mt5_store import get_latest_timestamp as _broker_time
import asyncio
import time
import uuid

router = APIRouter()

_pending_orders: list[dict] = []
_in_flight:      dict[str, dict] = {}   # FIX 1: order_id → order, awaiting bridge result
_order_results:  list[dict] = []
_last_positions: list[dict] = []
_breakeven_moved: set[int] = set()
_order_event = asyncio.Event()

def queue_order(order: dict) -> str:
    """Called by auto_trade_engine to queue an order without HTTP overhead."""
    order_id = str(uuid.uuid4())
    _pending_orders.append({
        **order,
        "order_id":  order_id,
        "queued_at": _broker_time() or int(time.time()),
    })
    _order_event.set()
    print(f"[TRADE] AutoQueued: {order.get('direction')} {order.get('lots')} {order.get('symbol')} id={order_id}")
    return order_id

# FIX 3 — valid symbols (must match what the MT5 bridge knows how to map)
_VALID_SYMBOLS = {
    "USD/JPY", "EUR/USD", "GBP/USD",
    "AUD/USD", "USD/CHF", "EUR/JPY",
    "GBP/JPY", "USD/CAD", "NZD/USD",
    "AUD/JPY", "CAD/JPY",
}


class OrderRequest(BaseModel):
    symbol:     str
    direction:  str            # "BUY" or "SELL"
    order_type: str            # "MARKET" or "LIMIT"
    price:      Optional[float] = None
    sl:         float
    tp:         float
    lots:       float = 0.02
    comment:    str   = "STRUCT.ai"

class BreakevenMovedRequest(BaseModel):
    ticket: int    


class CloseRequest(BaseModel):
    ticket: int


class OrderResult(BaseModel):
    order_id:   str
    ticket:     Optional[int]   = None
    status:     str
    message:    str             = ""
    fill_price: Optional[float] = None


@router.post("/trade/open")
async def open_trade(order: OrderRequest):
    # FIX 3 — symbol allowlist (clear error before queuing anything)
    if order.symbol not in _VALID_SYMBOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown symbol '{order.symbol}'. Valid: {sorted(_VALID_SYMBOLS)}",
        )
    if order.direction not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="direction must be BUY or SELL")
    if order.order_type not in ("MARKET", "LIMIT"):
        raise HTTPException(status_code=400, detail="order_type must be MARKET or LIMIT")
    if order.order_type == "LIMIT" and order.price is None:
        raise HTTPException(status_code=400, detail="price required for LIMIT orders")
    if order.lots <= 0 or order.lots > 1.0:
        raise HTTPException(status_code=400, detail="lots must be 0.01–1.0")

    # FIX 2 — SL/TP validation
    if order.sl <= 0 or order.tp <= 0:
        raise HTTPException(status_code=400, detail="SL and TP must be positive prices")
    if order.sl == order.tp:
        raise HTTPException(status_code=400, detail="SL and TP cannot be the same price")
    # For LIMIT orders we know the entry — check direction is correct
    if order.order_type == "LIMIT" and order.price is not None:
        if order.direction == "BUY":
            if order.sl >= order.price:
                raise HTTPException(status_code=400, detail="BUY: SL must be below entry price")
            if order.tp <= order.price:
                raise HTTPException(status_code=400, detail="BUY: TP must be above entry price")
        else:  # SELL
            if order.sl <= order.price:
                raise HTTPException(status_code=400, detail="SELL: SL must be above entry price")
            if order.tp >= order.price:
                raise HTTPException(status_code=400, detail="SELL: TP must be below entry price")

    # FIX 4 — full UUID4 (no truncation)
    order_id = str(uuid.uuid4())
    _pending_orders.append({
        "order_id":   order_id,
        "symbol":     order.symbol,
        "direction":  order.direction,
        "order_type": order.order_type,
        "price":      order.price,
        "sl":         order.sl,
        "tp":         order.tp,
        "lots":       order.lots,
        "comment":    order.comment,
        "queued_at":  _broker_time() or int(time.time()),
    })
    _order_event.set()
    print(f"[TRADE] Queued: {order.direction} {order.lots} {order.symbol} id={order_id}")
    return {"status": "queued", "order_id": order_id}


@router.get("/trade/pending")
async def get_pending_orders():
    """Bridge long-polls this. Holds connection until an order arrives (max 15s)."""
    if not _pending_orders:
        try:
            await asyncio.wait_for(_order_event.wait(), timeout=15.0)
        except asyncio.TimeoutError:
            pass
    _order_event.clear()
    orders = list(_pending_orders)
    _pending_orders.clear()
    # FIX 1 — track in-flight so orders are not silently lost if the HTTP
    # response never reaches the bridge. Removed in POST /trade/result.
    for o in orders:
        _in_flight[o["order_id"]] = o
    return {"orders": orders}


@router.post("/trade/result")
async def post_order_result(result: OrderResult):
    # FIX 1 — confirm delivery: remove from in-flight on bridge result
    _in_flight.pop(result.order_id, None)
    _order_results.append(result.model_dump())
    print(f"[TRADE] Result {result.order_id}: {result.status} {result.message}")
    return {"received": True}


@router.get("/trade/results")
async def get_order_results():
    """Dashboard polls this for confirmations."""
    results = list(_order_results)
    _order_results.clear()
    return {"results": results}


@router.post("/trade/close")
async def close_trade(req: CloseRequest):
    if req.ticket <= 0:
        raise HTTPException(status_code=400, detail="ticket must be a positive integer")
    # FIX 4 — full UUID4 (no truncation)
    order_id = str(uuid.uuid4())
    _pending_orders.append({
        "order_id":   order_id,
        "order_type": "CLOSE",
        "ticket":     req.ticket,
        "queued_at":  _broker_time() or int(time.time()),
    })
    _order_event.set()
    return {"status": "queued", "order_id": order_id}


@router.get("/trade/positions")
async def get_positions():
    return {"positions": _last_positions}


@router.post("/trade/positions/sync")
async def sync_positions(data: dict):
    global _last_positions
    _last_positions = data.get("positions", [])
    return {"received": True}


@router.get("/trade/inflight")
async def get_inflight_orders():
    """
    Debug endpoint — orders delivered to the bridge but not yet confirmed via
    POST /trade/result. In normal operation this list empties within seconds.
    If an entry is stuck here for >30s, the bridge did not report back —
    check MT5 directly before placing another order on the same symbol.
    """
    return {"in_flight": list(_in_flight.values()), "count": len(_in_flight)}


@router.post("/trade/breakeven-moved")
async def post_breakeven_moved(req: BreakevenMovedRequest):
    _breakeven_moved.add(req.ticket)
    return {"received": True}

@router.get("/trade/breakeven-status")
async def get_breakeven_status():
    return {"tickets": list(_breakeven_moved)}