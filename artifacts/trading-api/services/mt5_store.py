"""
MT5 data store — SQLite backend.

The Windows bridge (mt5_bridge.py) pushes OHLC candles via HTTP POST.
Live candles are written to SQLite (INSERT OR REPLACE) so they persist
across restarts and append seamlessly onto the historical data loaded
by scripts/collect_history.py.

Public API is IDENTICAL to the old in-memory version.
No callers (routers, engines, data_service) need any changes.

Key behaviour change from the old version:
  - get_candles() no longer returns None when the bridge is offline.
    Historical data is always valid. is_online() is the correct way
    to check bridge liveness — data availability is separate.
"""

import time
import threading
import pandas as pd
from typing import Optional

from services.db import get_conn

# ── Constants ──────────────────────────────────────────────────────────────────

# Interval labels the bridge sends (lowercase). Safety-normalised in _tf().
VALID_INTERVALS = {"5m", "15m", "1h", "4h", "d1"}

# How many seconds without a bridge push before is_online() returns False.
# Only affects liveness — does NOT affect data availability from SQLite.
MT5_STALE_THRESHOLD = 120  # 2 minutes

# Max rows returned by get_candles(). data_service.fetch_ohlc() further
# narrows to outputsize via .tail(), so engines always see their fixed window.
# 2000 is generous headroom for all timeframes without memory pressure.
_CANDLE_LIMIT = 2000

# ── Bridge liveness tracking (in-memory, resets on restart — fine) ─────────────
_last_contact: float = 0.0
_lock = threading.Lock()


# ── Internal helpers ───────────────────────────────────────────────────────────

def _tf(interval: str) -> str:
    """Normalise timeframe label to lowercase (d1, 4h, 1h, 15m, 5m)."""
    return interval.lower()


def _df_to_rows(symbol: str, tf: str, df: pd.DataFrame) -> list:
    """Convert a candle DataFrame to SQLite row tuples."""
    if pd.api.types.is_datetime64_any_dtype(df["time"]):
        timestamps = (df["time"].astype("int64") // 10 ** 9).tolist()
    else:
        # Already integers (unix seconds)
        timestamps = df["time"].astype("int64").tolist()

    return [
        (symbol, tf,
         int(timestamps[i]),
         float(df["open"].iloc[i]),
         float(df["high"].iloc[i]),
         float(df["low"].iloc[i]),
         float(df["close"].iloc[i]))
        for i in range(len(df))
    ]


# ── Public API — identical signatures to the old in-memory version ─────────────

def store_candles(symbol: str, interval: str, df: pd.DataFrame) -> None:
    """
    Write bridge-pushed candles to SQLite.
    Called by routers/mt5.py on every 5-second bridge push.
    INSERT OR REPLACE deduplicates by (symbol, timeframe, ts) automatically.
    """
    global _last_contact

    tf = _tf(interval)
    df = (df.drop_duplicates(subset=["time"])
            .sort_values("time")
            .reset_index(drop=True))

    rows = _df_to_rows(symbol, tf, df)
    if not rows:
        return

    conn = get_conn()
    conn.executemany(
        "INSERT OR REPLACE INTO ohlcv"
        "(symbol, timeframe, ts, open, high, low, close) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()

    with _lock:
        _last_contact = time.time()


def get_candles(symbol: str, interval: str) -> Optional[pd.DataFrame]:
    """
    Return the most recent _CANDLE_LIMIT candles for symbol+interval from SQLite,
    sorted oldest-first (as all downstream engines expect).

    Returns None only if absolutely no data exists for this symbol+timeframe
    (i.e. collect_history.py has not been run AND the bridge has never pushed
    this pair). Never returns None just because the bridge is currently offline.
    """
    tf = _tf(interval)
    conn = get_conn()

    rows = conn.execute(
        "SELECT ts, open, high, low, close FROM ohlcv "
        "WHERE symbol = ? AND timeframe = ? "
        "ORDER BY ts DESC LIMIT ?",
        (symbol, tf, _CANDLE_LIMIT),
    ).fetchall()

    if not rows:
        return None

    # Reverse: query returns newest-first, engines expect oldest-first
    rows = rows[::-1]

    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close"])
    # Convert unix int → datetime64 (no tz) — matches what engines expect
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True).dt.tz_localize(None)
    return df


def is_online() -> bool:
    """
    True if the bridge has pushed data within MT5_STALE_THRESHOLD seconds.
    Reflects bridge liveness only — does not indicate data availability.
    """
    with _lock:
        if _last_contact == 0.0:
            return False
        return (time.time() - _last_contact) < MT5_STALE_THRESHOLD


def status() -> dict:
    """
    Return bridge liveness + per-symbol-timeframe candle counts from SQLite.
    Used by GET /mt5/status.
    """
    conn = get_conn()
    now = time.time()

    with _lock:
        age = round(now - _last_contact, 1) if _last_contact > 0 else None

    rows = conn.execute(
        "SELECT symbol || '_' || timeframe AS key, MAX(ts), COUNT(*) "
        "FROM ohlcv GROUP BY symbol, timeframe"
    ).fetchall()

    frames = {}
    for key, latest_ts, count in rows:
        frames[key] = {
            "candles": count,
            "latest_secs_ago": round(now - latest_ts, 1) if latest_ts else None,
        }

    return {
        "online": is_online(),
        "last_contact_secs_ago": age,
        "frames": frames,
    }


def get_latest_timestamp() -> Optional[int]:
    """
    Return the most recent broker candle timestamp (unix seconds) across all
    stored frames. Used by GET /mt5/server-time and routers/trading.py.
    """
    conn = get_conn()
    row = conn.execute("SELECT MAX(ts) FROM ohlcv").fetchone()
    if row and row[0]:
        return int(row[0])
    return None
