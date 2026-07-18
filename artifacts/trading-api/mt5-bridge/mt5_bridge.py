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
API_BASE_URL = os.getenv("MT5_API_URL", "http://localhost:8001")

# Secret key (optional)
MT5_SECRET = os.getenv("MT5_BRIDGE_SECRET", "")

# Symbols (adjust based on your broker)
SYMBOLS = [
    {"mt5_name": "USDJPYm", "api_symbol": "USD/JPY"},
    {"mt5_name": "EURUSDm", "api_symbol": "EUR/USD"},
    {"mt5_name": "GBPUSDm", "api_symbol": "GBP/USD"},
    {"mt5_name": "AUDUSDm", "api_symbol": "AUD/USD"},
    {"mt5_name": "USDCHFm", "api_symbol": "USD/CHF"},
    {"mt5_name": "EURJPYm", "api_symbol": "EUR/JPY"},
    {"mt5_name": "GBPJPYm", "api_symbol": "GBP/JPY"},
    {"mt5_name": "USDCADm", "api_symbol": "USD/CAD"},
    {"mt5_name": "NZDUSDm", "api_symbol": "NZD/USD"},
    {"mt5_name": "AUDJPYm", "api_symbol": "AUD/JPY"},
    {"mt5_name": "CADJPYm", "api_symbol": "CAD/JPY"},
    {"mt5_name": "XAUUSDm", "api_symbol": "XAU/USD"},
    {"mt5_name": "BTCUSDm", "api_symbol": "BTC/USD"},
]

# Settings
CANDLE_COUNT = {
    "5m":  400,
    "15m": 400,
    "1h":  300,
    "4h":  300,
    "d1":  365,
    "w1":  300,
}
PUSH_INTERVAL = 5  # seconds

TIMEFRAME_MAP = {
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "d1":  mt5.TIMEFRAME_D1,
    "w1":  mt5.TIMEFRAME_W1,
}

PUSH_URL   = f"{API_BASE_URL}/trading-api/mt5/push"
STATUS_URL = f"{API_BASE_URL}/trading-api/mt5/status"

HEADERS = {
    "Content-Type": "application/json",
    "X-MT5-Secret": MT5_SECRET
}

# ================================
# HTTP SESSION (connection pooling)
# Re-uses TCP connections — avoids a new TLS handshake on every long-poll cycle.
# ================================
_session = requests.Session()
_session.headers.update(HEADERS)

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

    for attempt in range(2):
        try:
            resp = _session.post(PUSH_URL, json=payload, timeout=15)

            if resp.status_code == 200:
                data = resp.json()
                print(f"OK {tf_name}: {data.get('candles_received', 0)} candles")
                return True
            else:
                print(f"ERROR {tf_name}: HTTP {resp.status_code}")
                return False

        except requests.exceptions.Timeout:
            if attempt == 0:
                print(f"  [RETRY] {tf_name} timed out — retrying in 2s...")
                time.sleep(2)
            else:
                print(f"ERROR {tf_name}: timed out after retry")
                return False

        except requests.exceptions.RequestException as e:
            print(f"ERROR {tf_name}: {e}")
            return False

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


def _get_filling_mode(mt5_sym: str, order_type: str = "MARKET"):
    """
    MARKET orders prefer IOC (partial fills acceptable in fast markets).
    LIMIT/pending orders prefer FOK (must fill fully or not at all).
    """
    info = mt5.symbol_info(mt5_sym)
    if info:
        fm = info.filling_mode
        if order_type != "MARKET":
            # LIMIT orders: prefer FOK, fall back to IOC
            if fm & 1:
                return mt5.ORDER_FILLING_FOK
            if fm & 2:
                return mt5.ORDER_FILLING_IOC
        else:
            # MARKET orders: prefer IOC
            if fm & 2:
                return mt5.ORDER_FILLING_IOC
            if fm & 1:
                return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_IOC

RESULT_URL    = f"{API_BASE_URL}/trading-api/trade/result"
POSITIONS_URL = f"{API_BASE_URL}/trading-api/trade/positions/sync"

BREAKEVEN_URL = f"{API_BASE_URL}/trading-api/trade/breakeven-moved"
_breakeven_tracker: dict[int, dict] = {}
_pending_be:        dict[int, dict] = {}   # LIMIT framework orders waiting to fill

def _pip(price: float) -> float:
    if price > 10_000: return 1.0    # BTC
    if price > 500:    return 0.1    # Gold
    if price > 50:     return 0.01   # JPY pairs
    return 0.0001                    # Standard FX


def _report(order_id, ticket, status, message, fill_price=None):
    try:
        _session.post(RESULT_URL, json={
            "order_id":   order_id,
            "ticket":     ticket,
            "status":     status,
            "message":    message,
            "fill_price": fill_price,
        }, timeout=5)
    except Exception as e:
        print(f"  [TRADE] report error: {e}")


def _execute_order(order: dict):
    order_id = order["order_id"]

    # Discard MARKET orders that sat in the bridge's execution queue too long.
    # Uses _received_at — the bridge-local timestamp set the instant this batch
    # was received from the server. Both this check and time.time() use the same
    # PC clock, so server/PC clock skew and a corrupted PC clock are irrelevant.
    received_at = order.get("_received_at")
    if order.get("order_type") == "MARKET" and received_at is not None:
        age = time.time() - received_at
        if age > 10:
            print(f"  [TRADE] STALE market order discarded ({age:.1f}s since received): {order['symbol']}")
            _report(order_id, None, "CANCELLED", f"Market order stale ({age:.1f}s since received) — resubmit")
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
        "deviation":    10,
        "comment":      order.get("comment", "STRUCT.ai"),
        "type_time":    mt5.ORDER_TIME_GTC,
        "type_filling": _get_filling_mode(mt5_sym, order_type=o_type),
    }
    result = mt5.order_send(req)
    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        print(f"  [TRADE] FILLED: {direction} {lots} {order['symbol']} @ {result.price} ticket={result.order}")
        _report(order_id, result.order, "FILLED", "OK", fill_price=result.price)

        if order.get("comment", "") == "STRUCT.ai-Framework":
            if o_type == "MARKET":
                _breakeven_tracker[result.order] = {
                    "symbol": mt5_sym, "direction": direction,
                    "entry": result.price, "sl_orig": sl, "tp": tp, "moved": False,
                }
            else:
                # LIMIT — fill price unknown at placement; promote when position opens
                _pending_be[result.order] = {
                    "symbol": mt5_sym, "direction": direction,
                    "sl_orig": sl, "tp": tp,
                }
    else:
        msg = result.comment if result else str(mt5.last_error())
        print(f"  [TRADE] REJECTED: {order['symbol']} {msg}")
        _report(order_id, None, "REJECTED", msg)



def _check_breakeven_all():
    # Promote pending LIMIT framework orders that have now filled
    for ticket in list(_pending_be.keys()):
        pos_list = mt5.positions_get(ticket=ticket)
        if pos_list:
            # Position opened — actual fill price now available
            info = _pending_be.pop(ticket)
            _breakeven_tracker[ticket] = {
                "symbol":    info["symbol"],
                "direction": info["direction"],
                "entry":     pos_list[0].price_open,
                "sl_orig":   info["sl_orig"],
                "tp":        info["tp"],
                "moved":     False,
            }
        elif not mt5.orders_get(ticket=ticket):
            # Not a position AND not a pending order — cancelled or expired
            del _pending_be[ticket]

    for ticket, info in list(_breakeven_tracker.items()):
        if info["moved"]:
            if not mt5.positions_get(ticket=ticket):
                del _breakeven_tracker[ticket]
            continue
        if not mt5.positions_get(ticket=ticket):
            del _breakeven_tracker[ticket]
            continue
        entry  = info["entry"]
        sl_orig = info["sl_orig"]
        one_r  = abs(entry - sl_orig)
        pip    = _pip(entry)
        if one_r <= 0:
            continue
        # Use live tick instead of the last completed bar to avoid up-to-15-min delay
        tick_data = mt5.symbol_info_tick(info["symbol"])
        if not tick_data:
            continue
        close = tick_data.bid if info["direction"] == "BUY" else tick_data.ask
            if close < entry + 1.5 * one_r:
                continue
            new_sl = round(entry + pip, 5)
        else:
            if close > entry - 1.5 * one_r:
                continue
            new_sl = round(entry - pip, 5)
        pos_list = mt5.positions_get(ticket=ticket)
        if not pos_list:
           del _breakeven_tracker[ticket]
           continue
        pos = pos_list[0]
        result = mt5.order_send({
            "action": mt5.TRADE_ACTION_SLTP,
            "symbol": info["symbol"],
            "position": ticket,
            "sl": new_sl,
            "tp": pos.tp if pos.tp > 0 else info["tp"],
        })
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            info["moved"] = True
            print(f"  [BE] ✅ ticket={ticket} SL moved to {new_sl}")
            try:
                _session.post(BREAKEVEN_URL, json={"ticket": ticket}, timeout=5)
            except Exception:
                pass        


def _execute_close(order: dict):
    order_id  = order["order_id"]
    ticket    = order["ticket"]
    positions = mt5.positions_get() or []
    pos       = next((p for p in positions if p.ticket == ticket), None)
    if not pos:
        _report(order_id, ticket, "ERROR", f"Position {ticket} not found")
        return
    tick  = mt5.symbol_info_tick(pos.symbol)
    if not tick:
        _report(order_id, ticket, "ERROR", "No tick price for close — MT5 disconnected, retry")
        return
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
        _session.post(POSITIONS_URL, json={"positions": pos_list}, timeout=5)
    except Exception:
        pass


def check_pending_orders():
    try:
        resp = _session.get(ORDERS_URL, timeout=20)
        if resp.status_code != 200:
            return
        # Stamp the bridge-local receive time BEFORE executing anything.
        # This is the only clock used for the MARKET-order stale check —
        # the server's queued_at is ignored, so a corrupted PC clock or any
        # server/PC clock skew cannot cause false-stale discards.
        bridge_received_at = time.time()
        orders = resp.json().get("orders", [])
        for order in orders:
            order["_received_at"] = bridge_received_at
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
        tick_t = mt5.symbol_info_tick(SYMBOLS[0]["mt5_name"])
        broker_hms = datetime.datetime.fromtimestamp(tick_t.time, tz=datetime.timezone.utc).strftime("%H:%M:%S UTC") if tick_t else "??:??:?? UTC"
        print(f"\n[{broker_hms}] Pushing data...")

        if mt5.terminal_info() is None:
            print("MT5 connection lost, reconnecting...")
            if not connect_mt5():
                time.sleep(30)
                continue

        t0      = time.time()
        success = push_all()
        _check_breakeven_all()
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
        time.sleep(max(0.5, PUSH_INTERVAL - elapsed))   # always sleep ≥ 0.5s


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
