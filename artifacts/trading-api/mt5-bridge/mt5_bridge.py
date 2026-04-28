"""
STRUCT.ai - MT5 Bridge (Multi-Symbol)

Streams real-time OHLC candle data from MetaTrader 5 to your backend API.

Setup:
1. pip install MetaTrader5 requests
2. Open MetaTrader 5 and log in
3. Set environment variables if needed (MT5_BRIDGE_SECRET)
4. Run: python mt5_bridge.py

Notes:
- Symbol names depend on your broker (may include suffix like 'm')
- Default API runs on localhost
"""

import time
import datetime
import requests
import MetaTrader5 as mt5
import os

# ================================
# CONFIG
# ================================

# Backend API base URL
API_BASE_URL = "http://localhost:8001"

# Secret key (optional)
MT5_SECRET = os.getenv("MT5_BRIDGE_SECRET", "")

# Symbols (adjust based on your broker)
SYMBOLS = [
    {"mt5_name": "USDJPYm", "api_symbol": "USD/JPY"},
    {"mt5_name": "EURUSDm", "api_symbol": "EUR/USD"},
    {"mt5_name": "GBPUSDm", "api_symbol": "GBP/USD"},
    {"mt5_name": "EURJPYm", "api_symbol": "EUR/JPY"},
    {"mt5_name": "GBPJPYm", "api_symbol": "GBP/JPY"},
    {"mt5_name": "AUDUSDm", "api_symbol": "AUD/USD"},
    {"mt5_name": "USDCADm", "api_symbol": "USD/CAD"},
    {"mt5_name": "USDCHFm", "api_symbol": "USD/CHF"},
]

# Settings
CANDLE_COUNT = 500
PUSH_INTERVAL = 30  # seconds

TIMEFRAME_MAP = {
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
}

PUSH_URL = f"{API_BASE_URL}/trading-api/mt5/push"
STATUS_URL = f"{API_BASE_URL}/trading-api/mt5/status"

HEADERS = {
    "Content-Type": "application/json",
    "X-MT5-Secret": MT5_SECRET
}

# ================================
# MT5 CONNECTION
# ================================

def connect_mt5() -> bool:
    print("Connecting to MetaTrader 5...")

    if not mt5.initialize():
        print("ERROR: MT5 initialization failed:", mt5.last_error())
        print("Make sure MT5 is open and logged in.")
        return False

    account = mt5.account_info()
    if account:
        print(f"Connected: {account.server} | {account.name} | Balance: {account.balance} {account.currency}")
    else:
        print("Connected to MT5 (account info not available)")

    # Enable symbols
    for sym in SYMBOLS:
        name = sym["mt5_name"]
        if mt5.symbol_select(name, True):
            print(f"OK Symbol ready: {name}")
        else:
            print(f"WARNING: Could not select {name}")

    return True

# ================================
# DATA FETCHING
# ================================

def fetch_candles(mt5_symbol: str, tf_name: str, mt5_tf):
    rates = mt5.copy_rates_from_pos(mt5_symbol, mt5_tf, 0, CANDLE_COUNT)

    if rates is None or len(rates) == 0:
        print(f"WARNING: No data for {mt5_symbol} {tf_name}")
        return None

    return [
        {
            "time": int(r["time"]),
            "open": round(float(r["open"]), 5),
            "high": round(float(r["high"]), 5),
            "low": round(float(r["low"]), 5),
            "close": round(float(r["close"]), 5),
        }
        for r in rates
    ]

# ================================
# PUSH LOGIC
# ================================

def push_timeframe(api_symbol: str, tf_name: str, candles):
    payload = {
        "symbol": api_symbol,
        "interval": tf_name,
        "candles": candles
    }

    try:
        resp = requests.post(PUSH_URL, json=payload, headers=HEADERS, timeout=15)

        if resp.status_code == 200:
            data = resp.json()
            print(f"OK {tf_name}: {data.get('candles_received', 0)} candles")
            return True
        else:
            print(f"ERROR {tf_name}: HTTP {resp.status_code}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"ERROR {tf_name}: {e}")
        return False

# ================================
# MAIN PUSH FUNCTIONS
# ================================

def push_symbol(sym):
    mt5_name = sym["mt5_name"]
    api_symbol = sym["api_symbol"]

    success = 0

    for tf_name, mt5_tf in TIMEFRAME_MAP.items():
        candles = fetch_candles(mt5_name, tf_name, mt5_tf)

        if candles and push_timeframe(api_symbol, tf_name, candles):
            success += 1

    return success


def push_all():
    total = 0

    for sym in SYMBOLS:
        print(f"\n[{sym['mt5_name']}]")
        total += push_symbol(sym)

    return total

# ================================
# RUN LOOP
# ================================

def run():
    print("=" * 50)
    print("STRUCT.ai - MT5 Bridge")
    print("=" * 50)

    print(f"API: {API_BASE_URL}")
    print(f"Symbols: {', '.join(s['mt5_name'] for s in SYMBOLS)}")
    print(f"Interval: {PUSH_INTERVAL}s")
    print()

    if not connect_mt5():
        return

    print("\nStarting loop... Press Ctrl+C to stop")

    consecutive_errors = 0

    while True:
        now = datetime.datetime.now().strftime("%H:%M:%S")
        print(f"\n[{now}] Pushing data...")

        if mt5.terminal_info() is None:
            print("MT5 connection lost, reconnecting...")
            if not connect_mt5():
                time.sleep(30)
                continue

        success = push_all()
        expected = len(SYMBOLS) * len(TIMEFRAME_MAP)

        if success == 0:
            consecutive_errors += 1
            print(f"ERROR: 0/{expected} successful")

            if consecutive_errors >= 5:
                print("Check API connection or URL")

        else:
            consecutive_errors = 0
            print(f"Done: {success}/{expected} successful")

        time.sleep(PUSH_INTERVAL)


# ================================
# ENTRY POINT
# ================================

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nStopped.")
        mt5.shutdown()
        print("MT5 disconnected.")