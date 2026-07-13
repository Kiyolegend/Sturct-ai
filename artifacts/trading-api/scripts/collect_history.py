"""
STRUCT.ai Historical Data Collector
====================================
Run this ONCE on your Windows laptop (MT5 must be open and logged in).
Pulls full OHLCV history for all 11 STRUCT.ai pairs from your MT5 terminal
and writes them to data/market_data.db (SQLite).

After the initial run, use --refresh daily to top-up with new bars only.

Usage:
    python scripts/collect_history.py                  # full collection
    python scripts/collect_history.py --refresh        # top-up only (fast)

Lookback targets:
    D1  : 5 years
    4H  : 3 years   (resampled from 1H for accuracy)
    1H  : 2 years
    15M : 2 years
    5M  : 1 year

All 11 pairs:
    USD/JPY  EUR/USD  GBP/USD  EUR/JPY  GBP/JPY
    AUD/USD  USD/CAD  USD/CHF  NZD/USD  AUD/JPY  CAD/JPY

Estimated DB size after full collection: ~300-400 MB
Estimated time: 5-15 minutes depending on MT5 / broker speed
"""

import os
import sys
import sqlite3
import datetime
import argparse

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT    = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(ROOT, "data", "market_data.db")

# ── All 11 STRUCT.ai pairs — edit broker names if yours differ ─────────────────
# Format: "OUR_LABEL": "BROKER_SYMBOL"
# Common variants: USDJPYm  USDJPY  USDJPY+  USDJPY.s
MT5_SYMBOL_MAP = {
    "USD/JPY": "USDJPYm",
    "EUR/USD": "EURUSDm",
    "GBP/USD": "GBPUSDm",
    "EUR/JPY": "EURJPYm",
    "GBP/JPY": "GBPJPYm",
    "AUD/USD": "AUDUSDm",
    "USD/CAD": "USDCADm",
    "USD/CHF": "USDCHFm",
    "NZD/USD": "NZDUSDm",
    "AUD/JPY": "AUDJPYm",
    "CAD/JPY": "CADJPYm",
}

# ── Lookback targets ───────────────────────────────────────────────────────────
LOOKBACK_YEARS = {
    "d1":  5,
    "4h":  3,
    "1h":  2,
    "15m": 2,
    "5m":  1,
}

# Small overlap when refreshing to avoid tiny gaps at TF boundaries
REFRESH_OVERLAP = {
    "d1":  datetime.timedelta(days=5),
    "4h":  datetime.timedelta(days=2),
    "1h":  datetime.timedelta(days=1),
    "15m": datetime.timedelta(hours=6),
    "5m":  datetime.timedelta(hours=2),
}

# MT5 timeframe integer constants
MT5_TF = {
    "d1":  16408,   # TIMEFRAME_D1
    "1h":  16385,   # TIMEFRAME_H1
    "15m": 15,      # TIMEFRAME_M15
    "5m":  5,       # TIMEFRAME_M5
}

# MT5 hard limit per copy_rates_range request
_MT5_MAX_BARS = 99_000

# Approximate bars per day per timeframe (for chunking logic)
_BARS_PER_DAY = {
    "d1": 1, "4h": 6, "1h": 24, "15m": 96, "5m": 288,
}


# ── SQLite helpers ─────────────────────────────────────────────────────────────

def open_db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
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
        "CREATE INDEX IF NOT EXISTS idx_sym_tf_ts ON ohlcv(symbol, timeframe, ts)"
    )
    conn.execute("PRAGMA journal_mode=WAL")
    conn.commit()
    return conn


def store_rows(conn: sqlite3.Connection, rows: list, symbol: str, tf: str) -> int:
    if not rows:
        print(f"    [WARN] No rows to store for {symbol} {tf}")
        return 0
    tagged = [(symbol, tf, r[0], r[1], r[2], r[3], r[4]) for r in rows]
    conn.executemany(
        "INSERT OR REPLACE INTO ohlcv(symbol,timeframe,ts,open,high,low,close) "
        "VALUES(?,?,?,?,?,?,?)",
        tagged,
    )
    conn.commit()
    return len(tagged)


def get_latest_ts(conn: sqlite3.Connection,
                  symbol: str, tf: str) -> datetime.datetime | None:
    row = conn.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE symbol=? AND timeframe=?",
        (symbol, tf),
    ).fetchone()
    if row and row[0]:
        return datetime.datetime.fromtimestamp(int(row[0]), tz=datetime.timezone.utc)
    return None


def print_summary(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT symbol, timeframe, COUNT(*), MIN(ts), MAX(ts) "
        "FROM ohlcv GROUP BY symbol, timeframe ORDER BY symbol, timeframe"
    ).fetchall()
    print("\n" + "=" * 70)
    print("  DATABASE SUMMARY")
    print("=" * 70)
    print(f"  {'Symbol':<12} {'TF':<6} {'Bars':>8}  {'From':<12}  {'To':<12}")
    print("  " + "-" * 58)
    for sym, tf, count, min_ts, max_ts in rows:
        from_dt = datetime.datetime.fromtimestamp(min_ts, tz=datetime.timezone.utc).strftime("%Y-%m-%d")
        to_dt   = datetime.datetime.fromtimestamp(max_ts, tz=datetime.timezone.utc).strftime("%Y-%m-%d")
        print(f"  {sym:<12} {tf:<6} {count:>8,}  {from_dt:<12}  {to_dt:<12}")
    print("=" * 70)


# ── MT5 connection ─────────────────────────────────────────────────────────────

def mt5_connect(mt5) -> bool:
    if not mt5.initialize():
        err = mt5.last_error()
        print(f"\n  [ERROR] mt5.initialize() failed: {err}")
        print("  Is the MetaTrader5 terminal open and logged in?")
        return False
    info = mt5.terminal_info()
    if info:
        print(f"  MT5 connected — build={info.build}")
    return True


def resolve_symbol(mt5, broker_sym: str) -> str | None:
    """Verify the symbol exists in MT5, add to Market Watch if needed."""
    mt5.symbol_select(broker_sym, True)
    if mt5.symbol_info(broker_sym):
        return broker_sym

    # Try without trailing 'm' as fallback
    fallback = broker_sym.rstrip("m")
    if fallback != broker_sym:
        mt5.symbol_select(fallback, True)
        if mt5.symbol_info(fallback):
            print(f"    [AUTO] '{broker_sym}' not found — using '{fallback}'")
            return fallback

    # Try auto-detect: scan all broker symbols for best match
    all_syms = mt5.symbols_get()
    if all_syms:
        base = broker_sym.rstrip("m").upper()
        candidates = [s.name for s in all_syms if base in s.name.upper()]
        if candidates:
            best = min(candidates, key=len)
            mt5.symbol_select(best, True)
            print(f"    [AUTO] '{broker_sym}' not found — using '{best}' (auto-detected)")
            return best

    print(f"    [WARN] Symbol '{broker_sym}' not found in MT5.")
    print(f"           Edit MT5_SYMBOL_MAP in this script to match your broker.")
    return None


# ── MT5 data pulling ───────────────────────────────────────────────────────────

def rates_to_rows(rates) -> list:
    """Convert MT5 rates array to list of (ts, open, high, low, close) tuples."""
    return [
        (int(r["time"]),
         float(r["open"]),
         float(r["high"]),
         float(r["low"]),
         float(r["close"]))
        for r in rates
    ]


def pull_tf(mt5, broker_sym: str, tf_label: str, years: int,
            since: datetime.datetime | None = None) -> list:
    """
    Pull bars from MT5 for a single timeframe.
    Automatically chunks requests that would exceed MT5's ~100k bar limit.
    """
    tf_const = MT5_TF[tf_label]
    end   = datetime.datetime.now(datetime.timezone.utc)
    start = since if since else (end - datetime.timedelta(days=365 * years))
    label = f"since {start.strftime('%Y-%m-%d')}" if since else f"{years}yr"

    bars_per_day  = _BARS_PER_DAY[tf_label]
    total_days    = max((end - start).days + 1, 1)
    expected_bars = total_days * bars_per_day

    if expected_bars > _MT5_MAX_BARS:
        # Need to chunk — 5M over 1yr is the main case (~105k bars)
        chunk_days = _MT5_MAX_BARS // bars_per_day
        print(f"    pulling {label} of {tf_label} in chunks ({chunk_days}d each) ...")
        all_rows: list = []
        seen_ts: set   = set()
        cursor = start
        while cursor < end:
            chunk_end = min(cursor + datetime.timedelta(days=chunk_days), end)
            print(f"      {cursor.strftime('%Y-%m-%d')} → {chunk_end.strftime('%Y-%m-%d')} ...",
                  end=" ", flush=True)
            rates = mt5.copy_rates_range(broker_sym, tf_const, cursor, chunk_end)
            if rates is None or len(rates) == 0:
                print(f"0 bars  (MT5: {mt5.last_error()})")
            else:
                chunk_rows = rates_to_rows(rates)
                new_rows   = [r for r in chunk_rows if r[0] not in seen_ts]
                seen_ts.update(r[0] for r in new_rows)
                all_rows.extend(new_rows)
                print(f"{len(rates):,} bars")
            cursor = chunk_end
        print(f"    total: {len(all_rows):,} bars")
        return all_rows
    else:
        print(f"    pulling {label} of {tf_label} ...", end=" ", flush=True)
        rates = mt5.copy_rates_range(broker_sym, tf_const, start, end)
        if rates is None or len(rates) == 0:
            print(f"0 bars  (MT5: {mt5.last_error()})")
            return []
        print(f"{len(rates):,} bars")
        return rates_to_rows(rates)


def pull_4h(mt5, broker_sym: str, years: int,
            since: datetime.datetime | None = None) -> list:
    """
    Pull 1H from MT5 then resample to 4H.
    MT5's native H4 can have alignment issues; 1H→4H resample is more reliable.
    """
    import pandas as pd
    tf_const = MT5_TF["1h"]
    end   = datetime.datetime.now(datetime.timezone.utc)
    start = since if since else (end - datetime.timedelta(days=365 * years))
    label = f"since {start.strftime('%Y-%m-%d')}" if since else f"{years}yr"

    print(f"    pulling {label} of 1H from MT5 for 4H resample ...", end=" ", flush=True)
    rates = mt5.copy_rates_range(broker_sym, tf_const, start, end)
    if rates is None or len(rates) == 0:
        print(f"0 bars  (MT5: {mt5.last_error()})")
        return []
    print(f"{len(rates):,} 1H bars — resampling to 4H ...")

    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("time")
    df4 = df.resample("4h").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}
    ).dropna()
    print(f"    resampled: {len(df4):,} 4H bars")

    return [
        (int(ts.timestamp()), float(r["open"]), float(r["high"]),
         float(r["low"]), float(r["close"]))
        for ts, r in df4.iterrows()
    ]


# ── Build since_map for refresh mode ──────────────────────────────────────────

def build_since_map(conn: sqlite3.Connection) -> dict:
    """
    For each symbol+TF in the DB, compute the refresh start date:
    latest stored bar minus a small overlap to avoid gaps.
    Returns {symbol: {tf: datetime}}.
    """
    since_map: dict = {}
    all_tfs = ["d1", "4h", "1h", "15m", "5m"]
    for sym in MT5_SYMBOL_MAP:
        for tf in all_tfs:
            latest = get_latest_ts(conn, sym, tf)
            if latest is None:
                continue
            overlap = REFRESH_OVERLAP.get(tf, datetime.timedelta(days=1))
            since_map.setdefault(sym, {})[tf] = latest - overlap
    return since_map


# ── Main collection loop ───────────────────────────────────────────────────────

def collect(conn: sqlite3.Connection, mt5,
            since_map: dict | None = None) -> int:
    """
    Pull all 11 pairs × 5 timeframes and store to SQLite.
    since_map: if provided, only fetch bars newer than those dates (refresh mode).
    """
    mode  = "REFRESH" if since_map else "FULL"
    total = 0

    for our_sym, broker_sym_raw in MT5_SYMBOL_MAP.items():
        print(f"\n{'=' * 60}")
        print(f"  {our_sym}  (MT5: {broker_sym_raw})  [{mode}]")
        print("=" * 60)

        broker_sym = resolve_symbol(mt5, broker_sym_raw)
        if broker_sym is None:
            print(f"  Skipping {our_sym}.")
            continue

        sym_since = (since_map or {}).get(our_sym, {})

        # ── D1 ────────────────────────────────────────────────────────────────
        print(f"\n  [d1]")
        rows = pull_tf(mt5, broker_sym, "d1", LOOKBACK_YEARS["d1"],
                       since=sym_since.get("d1"))
        n = store_rows(conn, rows, our_sym, "d1")
        print(f"    stored {n:,} rows")
        total += n

        # ── 4H (via 1H resample) ──────────────────────────────────────────────
        print(f"\n  [4h]")
        rows = pull_4h(mt5, broker_sym, LOOKBACK_YEARS["4h"],
                       since=sym_since.get("4h"))
        n = store_rows(conn, rows, our_sym, "4h")
        print(f"    stored {n:,} rows")
        total += n

        # ── 1H ───────────────────────────────────────────────────────────────
        print(f"\n  [1h]")
        rows = pull_tf(mt5, broker_sym, "1h", LOOKBACK_YEARS["1h"],
                       since=sym_since.get("1h"))
        n = store_rows(conn, rows, our_sym, "1h")
        print(f"    stored {n:,} rows")
        total += n

        # ── 15M ──────────────────────────────────────────────────────────────
        print(f"\n  [15m]")
        rows = pull_tf(mt5, broker_sym, "15m", LOOKBACK_YEARS["15m"],
                       since=sym_since.get("15m"))
        n = store_rows(conn, rows, our_sym, "15m")
        print(f"    stored {n:,} rows")
        total += n

        # ── 5M ───────────────────────────────────────────────────────────────
        print(f"\n  [5m]")
        rows = pull_tf(mt5, broker_sym, "5m", LOOKBACK_YEARS["5m"],
                       since=sym_since.get("5m"))
        n = store_rows(conn, rows, our_sym, "5m")
        print(f"    stored {n:,} rows")
        total += n

    return total


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="STRUCT.ai MT5 Historical Data Collector"
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Only pull bars newer than what is already in the DB (fast daily top-up)",
    )
    args = parser.parse_args()

    # Force UTF-8 output on Windows so Unicode chars don't crash when piped
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    print("\n" + "=" * 60)
    print("  STRUCT.ai Historical Data Collector")
    print(f"  DB: {DB_PATH}")
    print("=" * 60)

    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("\n[ERROR] MetaTrader5 package not installed.")
        print("  Run:  pip install MetaTrader5")
        print("  Note: Windows only — must run on the same machine as MT5.")
        sys.exit(1)

    conn = open_db()

    if args.refresh:
        since_map = build_since_map(conn)
        if not since_map:
            print("\n  DB is empty — running full collection instead of refresh.")
            args.refresh = False

    if not mt5_connect(mt5):
        sys.exit(1)

    try:
        since_map = build_since_map(conn) if args.refresh else None

        if args.refresh and since_map:
            print("\n  Refresh mode — fetching only new bars since last stored bar.")
            print("  Current DB coverage:")
            for sym in sorted(since_map):
                for tf in ["d1", "4h", "1h", "15m", "5m"]:
                    if tf in since_map[sym]:
                        dt = since_map[sym][tf] + REFRESH_OVERLAP.get(tf, datetime.timedelta(days=1))
                        print(f"    {sym:<12} {tf:<6} latest ≈ {dt.strftime('%Y-%m-%d %H:%M')} UTC")
        else:
            print("\n  Full collection mode.")
            print(f"  Pairs: {len(MT5_SYMBOL_MAP)}")
            print(f"  Timeframes: d1 (5yr) · 4h (3yr) · 1h (2yr) · 15m (2yr) · 5m (1yr)")

        total = collect(conn, mt5, since_map=since_map if args.refresh else None)

    finally:
        mt5.shutdown()
        print("\n  MT5 connection closed.")

    print_summary(conn)
    conn.close()

    print(f"\n  Done. Total rows stored: {total:,}")
    print(f"  DB: {DB_PATH}")
    print("\n  Restart the STRUCT.ai trading-api server to load the new data.\n")


if __name__ == "__main__":
    main()
