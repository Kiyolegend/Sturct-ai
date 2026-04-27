"""
STRUCT.ai â€” MT5 Bridge for Windows (Multi-Symbol)
====================================================
Run this on your Windows machine where MetaTrader 5 is installed.

SETUP (one-time):
  1. pip install MetaTrader5 requests
  2. Open MetaTrader 5 and log in to your account (live or demo).
  3. Edit CONFIG below: set REPLIT_URL and add/remove symbols as needed.
  4. Run:  python mt5_bridge.py

The script pushes OHLC candles for ALL configured symbols across 4 timeframes
to your STRUCT.ai server every 30 seconds.

STOP: Press Ctrl+C
"""

import time
import datetime
import requests
import MetaTrader5 as mt5

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# CONFIG â€” edit these values
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# Your Replit project URL (no trailing slash).
REPLIT_URL = "http://localhost:8001"

# Secret key â€” leave empty for local setup
MT5_SECRET = ""

# â”€â”€ Symbols to push â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# MetaQuotes demo uses plain names (USDJPY, EURUSD etc.) with no suffix.
# If your broker uses a suffix (e.g. USDJPYm) add it back here.
SYMBOLS = [
    {"mt5_name": "USDJPYm",  "api_symbol": "USD/JPY"},
    {"mt5_name": "EURUSDm",  "api_symbol": "EUR/USD"},
    {"mt5_name": "GBPUSDm",  "api_symbol": "GBP/USD"},
    {"mt5_name": "EURJPYm",  "api_symbol": "EUR/JPY"},
    {"mt5_name": "GBPJPYm",  "api_symbol": "GBP/JPY"},
    {"mt5_name": "AUDUSDm",  "api_symbol": "AUD/USD"},
    {"mt5_name": "USDCADm",  "api_symbol": "USD/CAD"},
    {"mt5_name": "USDCHFm",  "api_symbol": "USD/CHF"},
]

# How many candles to send per timeframe per symbol
CANDLE_COUNT = 500

# Push interval in seconds (30 is recommended)
PUSH_INTERVAL = 30

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

TIMEFRAME_MAP = {
    "5m":  mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "1h":  mt5.TIMEFRAME_H1,
    "4h":  mt5.TIMEFRAME_H4,
}

PUSH_URL   = f"{REPLIT_URL}/trading-api/mt5/push"
STATUS_URL = f"{REPLIT_URL}/trading-api/mt5/status"
HEADERS    = {"X-MT5-Secret": MT5_SECRET, "Content-Type": "application/json"}


def connect_mt5() -> bool:
    print("Connecting to MetaTrader 5...")
    if not mt5.initialize():
        print(f"  ERROR: mt5.initialize() failed â€” {mt5.last_error()}")
        print("  Make sure MetaTrader 5 is open and logged in.")
        return False

    account = mt5.account_info()
    if account:
        print(f"  Connected: {account.server} | {account.name} | Balance: {account.balance} {account.currency}")
    else:
        info = mt5.terminal_info()
        print(f"  MT5 terminal: {info.name if info else 'unknown'}")

    # Enable all configured symbols in Market Watch
    for sym in SYMBOLS:
        name = sym["mt5_name"]
        if mt5.symbol_select(name, True):
            print(f"  âœ“ Symbol ready: {name}")
        else:
            print(f"  âœ— WARNING: Could not select {name} â€” check Market Watch spelling")

    return True


def fetch_candles(mt5_symbol: str, tf_name: str, mt5_tf) -> list[dict] | None:
    rates = mt5.copy_rates_from_pos(mt5_symbol, mt5_tf, 0, CANDLE_COUNT)
    if rates is None or len(rates) == 0:
        print(f"    WARNING: No data for {mt5_symbol} {tf_name} â€” {mt5.last_error()}")
        return None
    return [
        {
            "time":  int(r["time"]),
            "open":  round(float(r["open"]),  5),
            "high":  round(float(r["high"]),  5),
            "low":   round(float(r["low"]),   5),
            "close": round(float(r["close"]), 5),
        }
        for r in rates
    ]


def push_timeframe(api_symbol: str, tf_name: str, candles: list[dict]) -> bool:
    payload = {"symbol": api_symbol, "interval": tf_name, "candles": candles}
    try:
        resp = requests.post(PUSH_URL, json=payload, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            print(f"    âœ“ {tf_name}: {data['candles_received']} candles")
            return True
        else:
            print(f"    âœ— {tf_name}: HTTP {resp.status_code} â€” {resp.text[:100]}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"    âœ— {tf_name}: {e}")
        return False


def push_symbol(sym: dict) -> int:
    """Push all timeframes for one symbol. Returns number of successful pushes."""
    mt5_name   = sym["mt5_name"]
    api_symbol = sym["api_symbol"]
    ok = 0
    for tf_name, mt5_tf in TIMEFRAME_MAP.items():
        candles = fetch_candles(mt5_name, tf_name, mt5_tf)
        if candles and push_timeframe(api_symbol, tf_name, candles):
            ok += 1
    return ok


def push_all() -> int:
    """Push all symbols. Returns total successful timeframe pushes."""
    total_ok = 0
    for sym in SYMBOLS:
        print(f"  [{sym['mt5_name']}]")
        total_ok += push_symbol(sym)
    return total_ok


def run():
    print("=" * 60)
    print("  STRUCT.ai â€” MT5 Bridge (Multi-Symbol)")
    print("=" * 60)
    print(f"  Target  : {REPLIT_URL}")
    print(f"  Symbols : {', '.join(s['mt5_name'] for s in SYMBOLS)}")
    print(f"  Interval: every {PUSH_INTERVAL}s | Candles per TF: {CANDLE_COUNT}")
    print()

    if not connect_mt5():
        return

    print()
    print(f"Starting push loop. Press Ctrl+C to stop.")
    print("-" * 60)

    consecutive_errors = 0
    while True:
        now = datetime.datetime.now().strftime("%H:%M:%S")
        print(f"\n[{now}] Pushing {len(SYMBOLS)} symbols Ã— 4 timeframes...")

        if mt5.terminal_info() is None:
            print("  MT5 connection lost â€” reconnecting...")
            if not connect_mt5():
                time.sleep(30)
                consecutive_errors += 1
                continue

        ok = push_all()
        total_expected = len(SYMBOLS) * len(TIMEFRAME_MAP)

        if ok == 0:
            consecutive_errors += 1
            print(f"  ERROR: 0/{total_expected} pushed.")
            if consecutive_errors >= 5:
                print("  Check REPLIT_URL and internet connection.")
        else:
            consecutive_errors = 0
            print(f"  Done: {ok}/{total_expected} timeframes pushed successfully.")

        time.sleep(PUSH_INTERVAL)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\n\nStopped.")
        mt5.shutdown()
        print("MT5 disconnected.")
