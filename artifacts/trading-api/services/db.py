"""
SQLite connection manager for STRUCT.ai historical candle storage.

DB path: artifacts/trading-api/data/market_data.db
Schema : ohlcv(symbol, timeframe, ts, open, high, low, close)
         PRIMARY KEY (symbol, timeframe, ts)

Call init_db() once at server startup (done in main.py).
Use get_conn() anywhere you need a connection — each thread gets its own.
"""

import os
import sqlite3
import threading

# DB sits in data/ next to services/
_HERE   = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(_HERE, "..", "data", "market_data.db"))

# Thread-local storage so each asyncio/uvicorn thread gets its own connection.
# SQLite connections must NOT be shared across threads.
_local = threading.local()


def init_db() -> None:
    """
    Create the ohlcv table and index if they don't exist.
    Safe to call every startup — CREATE IF NOT EXISTS is idempotent.
    """
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ohlcv (
                symbol    TEXT    NOT NULL,
                timeframe TEXT    NOT NULL,
                ts        INTEGER NOT NULL,
                open      REAL    NOT NULL,
                high      REAL    NOT NULL,
                low       REAL    NOT NULL,
                close     REAL    NOT NULL,
                PRIMARY KEY (symbol, timeframe, ts)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sym_tf_ts "
            "ON ohlcv(symbol, timeframe, ts)"
        )
        conn.commit()
    finally:
        conn.close()


def get_conn() -> sqlite3.Connection:
    """
    Return a thread-local SQLite connection, opening it on first call per thread.
    WAL mode gives much better read/write concurrency (multiple readers + 1 writer).
    """
    if not hasattr(_local, "conn") or _local.conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
    return _local.conn
