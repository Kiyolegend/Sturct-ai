from fastapi import APIRouter
from services.auto_trade_engine import (
    get_state, get_log,
    set_enabled, set_paper_mode,
    start_engine, stop_engine,
)

router = APIRouter()

@router.get("/auto-trade/status")
async def auto_trade_status():
    return get_state()

@router.post("/auto-trade/on")
async def auto_trade_on():
    set_enabled(True)
    start_engine()
    return {"enabled": True}

@router.post("/auto-trade/off")
async def auto_trade_off():
    set_enabled(False)
    stop_engine()
    return {"enabled": False}

@router.post("/auto-trade/mode")
async def auto_trade_mode(body: dict):
    paper = bool(body.get("paper", True))
    set_paper_mode(paper)
    return {"paper_mode": paper}

@router.get("/auto-trade/log")
async def auto_trade_log():
    return {"log": get_log()}