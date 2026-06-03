"""
Trade execution router — STRUCT.ai manual trading.

Dashboard sends orders here → bridge polls and executes on MT5 → result reported back.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio
import time
import uuid

router = APIRouter()

_pending_orders: list[dict] = []
_order_results:  list[dict] = []
_last_positions: list[dict] = []
_order_event = asyncio.Event()


class OrderRequest(BaseModel):
    symbol:     str
    direction:  str            # "BUY" or "SELL"
    order_type: str            # "MARKET" or "LIMIT"
    price:      Optional[float] = None
    sl:         float
    tp:         float
    lots:       float = 0.02
    comment:    str   = "STRUCT.ai"


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
    if order.direction not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="direction must be BUY or SELL")
    if order.order_type not in ("MARKET", "LIMIT"):
        raise HTTPException(status_code=400, detail="order_type must be MARKET or LIMIT")
    if order.order_type == "LIMIT" and order.price is None:
        raise HTTPException(status_code=400, detail="price required for LIMIT orders")
    if order.lots <= 0 or order.lots > 1.0:
        raise HTTPException(status_code=400, detail="lots must be 0.01–1.0")

    order_id = str(uuid.uuid4())[:8]
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
        "queued_at":  time.time(),
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
    return {"orders": orders}


@router.post("/trade/result")
async def post_order_result(result: OrderResult):
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
    order_id = str(uuid.uuid4())[:8]
    _pending_orders.append({
        "order_id":   order_id,
        "order_type": "CLOSE",
        "ticket":     req.ticket,
        "queued_at":  time.time(),
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