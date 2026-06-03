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
import threading as _threading


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
    {"mt5_name": "AUDUSDm", "api_symbol": "AUD/USD"},
    {"mt5_name": "USDCHFm", "api_symbol": "USD/CHF"},
]

# Settings
CANDLE_COUNT = {
    "5m":  300,
    "15m": 300,
    "1h":  300,
    "4h":  300,
}
PUSH_INTERVAL = 5  # seconds

TIMEFRAME_MAP = {
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
}

PUSH_URL   = f"{API_BASE_URL}/trading-api/mt5/push"
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
    rates = mt5.copy_rates_from_pos(mt5_symbol, mt5_tf, 0, CANDLE_COUNT[tf_name])

    if rates is None or len(rates) == 0:
        print(f"WARNING: No data for {mt5_symbol} {tf_name}")
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

# ================================
# PUSH LOGIC
# ================================

def push_timeframe(api_symbol: str, tf_name: str, candles):
    payload = {
        "symbol":   api_symbol,
        "interval": tf_name,
        "candles":  candles
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
    mt5_name   = sym["mt5_name"]
    api_symbol = sym["api_symbol"]

    success = 0

    for tf_name, mt5_tf in TIMEFRAME_MAP.items():
        candles = fetch_candles(mt5_name, tf_name, mt5_tf)

        if candles and push_timeframe(api_symbol, tf_name, candles):
            success += 1

    return success


def push_all():
    results = [0] * len(SYMBOLS)

    def _push_one(i, sym):
        print(f"\n[{sym['mt5_name']}]")
        results[i] = push_symbol(sym)

    threads = [_threading.Thread(target=_push_one, args=(i, sym))
               for i, sym in enumerate(SYMBOLS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    return sum(results)

# ================================
# SYMBOL LOOKUP
# ================================

def _api_to_mt5(api_symbol: str) -> str | None:
    for sym in SYMBOLS:
        if sym["api_symbol"] == api_symbol:
            return sym["mt5_name"]
    return None

# ================================
# ORDER EXECUTION
# ================================

ORDERS_URL    = f"{API_BASE_URL}/trading-api/trade/pending"


def _get_filling_mode(mt5_sym: str):
    info = mt5.symbol_info(mt5_sym)
    if info:
        fm = info.filling_mode
        if fm & 2:
            return mt5.ORDER_FILLING_IOC
        if fm & 1:
            return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_IOC

RESULT_URL    = f"{API_BASE_URL}/trading-api/trade/result"
POSITIONS_URL = f"{API_BASE_URL}/trading-api/trade/positions/sync"


def _report(order_id, ticket, status, message, fill_price=None):
    try:
        requests.post(RESULT_URL, json={
            "order_id":   order_id,
            "ticket":     ticket,
            "status":     status,
            "message":    message,
            "fill_price": fill_price,
        }, headers=HEADERS, timeout=5)
    except Exception as e:
        print(f"  [TRADE] report error: {e}")


def _execute_order(order: dict):
    order_id = order["order_id"]

    # Discard MARKET orders that sat in queue too long — price may have moved
    age = time.time() - order.get("queued_at", 0)
    if order.get("order_type") == "MARKET" and age > 10:
        print(f"  [TRADE] STALE market order discarded ({age:.1f}s old): {order['symbol']}")
        _report(order_id, None, "CANCELLED", f"Market order stale ({age:.1f}s) — resubmit")
        return

    mt5_sym  = _api_to_mt5(order["symbol"])
    
    if not mt5_sym:
        _report(order_id, None, "ERROR", f"Unknown symbol: {order['symbol']}")
        return

    tick = mt5.symbol_info_tick(mt5_sym)
    if not tick:
        _report(order_id, None, "ERROR", "No tick price")
        return

    direction = order["direction"]
    o_type    = order["order_type"]
    sl        = order["sl"]
    tp        = order["tp"]
    lots      = order["lots"]

    if direction == "BUY":
        price    = tick.ask if o_type == "MARKET" else order["price"]
        mt5_type = mt5.ORDER_TYPE_BUY if o_type == "MARKET" else mt5.ORDER_TYPE_BUY_LIMIT
    else:
        price    = tick.bid if o_type == "MARKET" else order["price"]
        mt5_type = mt5.ORDER_TYPE_SELL if o_type == "MARKET" else mt5.ORDER_TYPE_SELL_LIMIT

    req = {
        "action":       mt5.TRADE_ACTION_DEAL if o_type == "MARKET" else mt5.TRADE_ACTION_PENDING,
        "symbol":       mt5_sym,
        "volume":       lots,
        "type":         mt5_type,
        "price":        price,
        "sl":           sl,
        "tp":           tp,
        "deviation":    5,
        "comment":      order.get("comment", "STRUCT.ai"),
        "type_time":    mt5.ORDER_TIME_GTC,
        "type_filling": _get_filling_mode(mt5_sym),
    }
    result = mt5.order_send(req)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        print(f"  [TRADE] FILLED: {direction} {lots} {order['symbol']} @ {result.price} ticket={result.order}")
        _report(order_id, result.order, "FILLED", "OK", fill_price=result.price)
    else:
        msg = result.comment if result else str(mt5.last_error())
        print(f"  [TRADE] REJECTED: {order['symbol']} {msg}")
        _report(order_id, None, "REJECTED", msg)


def _execute_close(order: dict):
    order_id  = order["order_id"]
    ticket    = order["ticket"]
    positions = mt5.positions_get() or []
    pos       = next((p for p in positions if p.ticket == ticket), None)
    if not pos:
        _report(order_id, ticket, "ERROR", f"Position {ticket} not found")
        return
    tick  = mt5.symbol_info_tick(pos.symbol)
    price = tick.bid if pos.type == 0 else tick.ask
    req   = {
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       pos.symbol,
        "volume":       pos.volume,
        "type":         mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY,
        "position":     ticket,
        "price":        price,
        "comment":      "STRUCT.ai close",
        "type_filling": _get_filling_mode(pos.symbol),
    }
    result = mt5.order_send(req)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        print(f"  [TRADE] CLOSED ticket={ticket} @ {result.price}")
        _report(order_id, ticket, "FILLED", "Closed", fill_price=result.price)
    else:
        msg = result.comment if result else str(mt5.last_error())
        _report(order_id, ticket, "ERROR", f"Close failed: {msg}")


def _sync_positions():
    positions = mt5.positions_get() or []
    pos_list  = [{
        "ticket":        p.ticket,
        "symbol":        p.symbol,
        "type":          "BUY" if p.type == 0 else "SELL",
        "volume":        p.volume,
        "price_open":    p.price_open,
        "price_current": p.price_current,
        "sl":            p.sl,
        "tp":            p.tp,
        "profit":        round(p.profit, 2),
    } for p in positions]
    try:
        requests.post(POSITIONS_URL, json={"positions": pos_list},
                      headers=HEADERS, timeout=5)
    except Exception:
        pass


def check_pending_orders():
    try:
        resp = requests.get(ORDERS_URL, headers=HEADERS, timeout=20)
        if resp.status_code != 200:
            return
        orders = resp.json().get("orders", [])
        for order in orders:
            if order.get("order_type") == "CLOSE":
                _execute_close(order)
            else:
                _execute_order(order)
        if orders:
            _sync_positions()
    except Exception as e:
        print(f"  [TRADE] poll error: {e}")

# ================================
# ORDER POLL THREAD
# ================================

def _order_poll_loop():
    """Runs in a background thread. Long-polls for orders independently of the push cycle."""
    print("[TRADE] Order poll thread started")
    while True:
        try:
            check_pending_orders()
        except Exception as e:
            print(f"  [TRADE] order poll error: {e}")
            time.sleep(1)

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

    # Start dedicated order-poll thread (long-polls server, independent of push cycle)
    order_thread = _threading.Thread(target=_order_poll_loop, daemon=True)
    order_thread.start()

    consecutive_errors = 0

    while True:
        now = datetime.datetime.now().strftime("%H:%M:%S")
        print(f"\n[{now}] Pushing data...")

        if mt5.terminal_info() is None:
            print("MT5 connection lost, reconnecting...")
            if not connect_mt5():
                time.sleep(30)
                continue

        t0      = time.time()
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

        _sync_positions()

        elapsed = time.time() - t0
        time.sleep(max(0, PUSH_INTERVAL - elapsed))


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