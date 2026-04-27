"""
MT5 in-memory data store.

The Windows bridge (mt5_bridge.py) pushes OHLC candles here via HTTP POST.
data_service.fetch_ohlc() checks this store first before falling back to Twelve Data.
"""

import time
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional

# Interval aliases the bridge uses
VALID_INTERVALS = {"5m", "15m", "1h", "4h"}

# How old (seconds) a push can be before we consider MT5 offline
MT5_STALE_THRESHOLD = 120  # 2 minutes


@dataclass
class MT5Frame:
    df: pd.DataFrame
    pushed_at: float = field(default_factory=time.time)


# symbol+interval → MT5Frame
_store: dict[str, MT5Frame] = {}

# When did the bridge last contact us (any push)?
_last_contact: float = 0.0


def store_candles(symbol: str, interval: str, df: pd.DataFrame) -> None:
    global _last_contact
    key = f"{symbol}_{interval}"
    _store[key] = MT5Frame(df=df.copy(), pushed_at=time.time())
    _last_contact = time.time()


def get_candles(symbol: str, interval: str) -> Optional[pd.DataFrame]:
    key = f"{symbol}_{interval}"
    frame = _store.get(key)
    if frame is None:
        return None
    age = time.time() - frame.pushed_at
    if age > MT5_STALE_THRESHOLD:
        return None  # treat as offline
    return frame.df.copy()


def is_online() -> bool:
    if _last_contact == 0.0:
        return False
    return (time.time() - _last_contact) < MT5_STALE_THRESHOLD


def status() -> dict:
    now = time.time()
    age = round(now - _last_contact, 1) if _last_contact > 0 else None
    frames = {k: round(now - v.pushed_at, 1) for k, v in _store.items()}
    return {
        "online": is_online(),
        "last_contact_secs_ago": age,
        "frames": frames,
    }
