from fastapi import APIRouter
from datetime import datetime, timezone
import MetaTrader5 as mt5

router = APIRouter()

@router.get("/daily-pnl")
def get_daily_pnl():
    deals = mt5.history_deals_get(
        datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0),
        datetime.now(timezone.utc)
    )
    if not deals:
        return {"total_profit": 0.0, "trade_count": 0, "win_count": 0, "loss_count": 0}

    closed = [d for d in deals if d.entry == 1]  # entry=1 = closing deal
    total  = round(sum(d.profit for d in closed), 2)
    wins   = sum(1 for d in closed if d.profit > 0)
    losses = sum(1 for d in closed if d.profit < 0)
    return {
        "total_profit": total,
        "trade_count":  len(closed),
        "win_count":    wins,
        "loss_count":   losses,
    }