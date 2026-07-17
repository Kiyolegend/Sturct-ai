"""
MT5 data store — in-memory.

The Windows bridge pushes OHLC candles via HTTP POST every 5 seconds.
Candles are held in memory only — no database, no file on disk.
Each symbol+timeframe keeps a rolling window sized so every analysis
engine (zigzag, BOS, CHoCH, S/R, zones, narrative) has enough bars.

When the API restarts the store is empty; the bridge repopulates it
on the next push cycle (10-30 seconds).

Public API is identical to the old SQLite version — no callers change.
"""

import time
import threading
import pandas as pd
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Interval labels the bridge sends (lowercase).
# Safety-normalised by _tf() before any use.
VALID_INTERVALS = {"5m", "15m", "1h", "4h", "d1"}

# Seconds without a bridge push before is_online() returns False.
# Does NOT affect data availability — get_candles() still returns stored rows.
MT5_STALE_THRESHOLD = 120  # 2 minutes

# Rolling window per timeframe — original pre-database values that worked.
_CANDLE_LIMIT: dict[str, int] = {
    "d1":  365,   # ~1 year of daily bars
    "4h":  300,   # ~50 days of 4-hour bars
    "1h":  300,   # ~12 days of hourly bars
    "15m": 400,   # ~4 days of 15-minute bars
    "5m":  400,   # ~33 hours of 5-minute bars
}
_DEFAULT_LIMIT = 400  # fallback for any unrecognised timeframe


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

# key   = "SYMBOL_tf"   e.g. "USD/JPY_5m"
# value = DataFrame with columns [time, open, high, low, close]
#         time is datetime64[ns] tz-naive, sorted oldest-first
_store: dict[str, pd.DataFrame] = {}
_last_contact: float = 0.0   # unix timestamp of last successful bridge push
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _tf(interval: str) -> str:
    """Normalise interval to lowercase: '5M' → '5m', 'D1' → 'd1'."""
    return interval.lower()


def _key(symbol: str, interval: str) -> str:
    """Store dict key: 'USD/JPY' + '5m' → 'USD/JPY_5m'."""
    return f"{symbol}_{_tf(interval)}"


def _to_unix(t) -> int:
    """
    Convert a time value from the DataFrame's time column to unix seconds.
    The bridge stores time as datetime64[ns] (tz-naive pd.Timestamp),
    so .timestamp() is the normal path. The other branches are safety nets.
    """
    if hasattr(t, "timestamp"):      # pd.Timestamp — normal path
        return int(t.timestamp())
    if hasattr(t, "item"):           # numpy datetime64 scalar
        return int(pd.Timestamp(t).timestamp())
    return int(t)                    # already an integer


# ---------------------------------------------------------------------------
# Public API — identical signatures to the old SQLite version
# ---------------------------------------------------------------------------

def store_candles(symbol: str, interval: str, df: pd.DataFrame) -> None:
    """
    Merge newly pushed candles into the in-memory store.
    Called by routers/mt5.py on every 5-second bridge push.

    Input df has columns [time, open, high, low, close] where time is
    datetime64[ns] tz-naive (set by the mt5 router before calling here).

    Deduplicates on 'time', merges with existing rows, keeps only the
    most recent _CANDLE_LIMIT rows so memory stays bounded.
    """
    global _last_contact

    tf      = _tf(interval)
    limit   = _CANDLE_LIMIT.get(tf, _DEFAULT_LIMIT)
    key     = _key(symbol, interval)

    incoming = (df.drop_duplicates(subset=["time"])
                  .sort_values("time")
                  .reset_index(drop=True))

    with _lock:
        existing = _store.get(key)
        if existing is not None and len(existing) > 0:
            combined = (
                pd.concat([existing, incoming], ignore_index=True)
                  .drop_duplicates(subset=["time"], keep="last")
                  .sort_values("time")
                  .reset_index(drop=True)
            )
        else:
            combined = incoming

        _store[key] = combined.tail(limit).reset_index(drop=True)
        _last_contact = time.time()


def get_candles(symbol: str, interval: str) -> Optional[pd.DataFrame]:
    """
    Return stored candles for symbol+interval, sorted oldest-first.
    Returns None if the bridge has never pushed data for this pair/timeframe.

    Called by services/data_service.py as mt5_get_candles().
    Returns a copy so callers cannot mutate the store.
    """
    key = _key(symbol, interval)
    with _lock:
        df = _store.get(key)
        if df is None or len(df) == 0:
            return None
        return df.copy()


def is_online() -> bool:
    """
    True if the bridge has pushed at least once within MT5_STALE_THRESHOLD
    seconds.  Reflects bridge liveness only — does not mean data is absent
    when False; get_candles() may still return rows.
    """
    with _lock:
        if _last_contact == 0.0:
            return False
        return (time.time() - _last_contact) < MT5_STALE_THRESHOLD


def status() -> dict:
    """
    Return bridge liveness + per-symbol-timeframe candle counts.
    Called by GET /mt5/status (routers/mt5.py as mt5_status()).

    Return shape is identical to the old SQLite version:
    {
        "online": bool,
        "last_contact_secs_ago": float | None,
        "frames": {
            "USD/JPY_5m": {"candles": int, "latest_secs_ago": float},
            ...
        }
    }
    """
    now = time.time()

    with _lock:
        age    = round(now - _last_contact, 1) if _last_contact > 0.0 else None
        online = (_last_contact > 0.0 and
                  (now - _last_contact) < MT5_STALE_THRESHOLD)

        frames: dict = {}
        for key, df in _store.items():
            if df is not None and len(df) > 0:
                latest_ts = _to_unix(df["time"].iloc[-1])
                frames[key] = {
                    "candles":         len(df),
                    "latest_secs_ago": round(now - latest_ts, 1),
                }

    return {
        "online":                online,
        "last_contact_secs_ago": age,
        "frames":                frames,
    }


def get_latest_timestamp() -> Optional[int]:
    """
    Return the most recent candle timestamp (unix seconds) across ALL stored
    symbol+timeframe combinations.

    Called by:
      • GET /mt5/server-time  →  routers/mt5.py line 97
      • routers/trading.py    →  imported as _broker_time (line 20)

    Returns None only if the store is completely empty (bridge never pushed).
    """
    latest: Optional[int] = None
    with _lock:
        for df in _store.values():
            if df is not None and len(df) > 0:
                ts = _to_unix(df["time"].iloc[-1])
                if latest is None or ts > latest:
                    latest = ts
    return latest