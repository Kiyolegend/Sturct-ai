"""
STRUCT.ai MT5 bridge replacement.

This bridge:
- Detects configured MT5 account profiles.
- Automatically selects one verified account when only one is found.
- Prompts for a selection when multiple verified accounts are found.
- Refuses to stream or trade if the account identity is wrong.
- Preserves candle streaming, order execution, close orders, position sync,
  and framework breakeven handling.
"""

import datetime
import os
import threading as _threading
import time

import MetaTrader5 as mt5
import requests


# ---------------------------------------------------------------------------
# Basic configuration
# ---------------------------------------------------------------------------

API_BASE_URL = os.getenv("MT5_API_URL", "http://localhost:8001")
MT5_SECRET = os.getenv("MT5_BRIDGE_SECRET", "")


# ---------------------------------------------------------------------------
# MT5 account profiles
#
# Fill these values before using the file:
# - terminal_path
# - expected_login
# - expected_server
# - symbol_suffix
#
# Never put an MT5 password in this file.
# ---------------------------------------------------------------------------

BASE_SYMBOLS = [
    {"base": "USDJPY", "api_symbol": "USD/JPY"},
    {"base": "EURUSD", "api_symbol": "EUR/USD"},
    {"base": "GBPUSD", "api_symbol": "GBP/USD"},
    {"base": "AUDUSD", "api_symbol": "AUD/USD"},
    {"base": "USDCHF", "api_symbol": "USD/CHF"},
    {"base": "EURJPY", "api_symbol": "EUR/JPY"},
    {"base": "GBPJPY", "api_symbol": "GBP/JPY"},
    {"base": "USDCAD", "api_symbol": "USD/CAD"},
    {"base": "NZDUSD", "api_symbol": "NZD/USD"},
    {"base": "AUDJPY", "api_symbol": "AUD/JPY"},
    {"base": "CADJPY", "api_symbol": "CAD/JPY"},
    {"base": "XAUUSD", "api_symbol": "XAU/USD"},
    {"base": "BTCUSD", "api_symbol": "BTC/USD"},
    {"base": "DXY",    "api_symbol": "DXY"},
]

MT5_PROFILES = {
    "personal": {
        "label": "Personal Account",
        "terminal_path": r"C:\Users\azaan\AppData\Roaming\MetaTrader 5\terminal64.exe",
        "expected_login": 172374568,
        "expected_server": "Exness-MT5Real2",
        "symbol_suffix": "m",
    },
    "secondaccount": {
        "label": "Second Account",
        "terminal_path": r"C:\Program Files\MetaTrader 5\terminal64.exe",
        "expected_login": 174422977,
        "expected_server": "Exness-MT5Real",
        "symbol_suffix": "m",
    },
    "thirdaccount": {
    "label": "Third Account",
    "terminal_path": r"C:\Users\azaan\Desktop\MT5.3\terminal64.exe",
    "expected_login": 256913956,
    "expected_server": "Exness-MT5Real35",
    "symbol_suffix": "m",
    },
    "fourthaccount": {
        "label": "Fourth Account",
        "terminal_path": r"C:\Users\azaan\Desktop\MT5 .4\terminal64.exe",
        "expected_login": 250815725,
        "expected_server": "Exness-MT5Real32",
        "symbol_suffix": "m",
    },
}

ACTIVE_PROFILE_NAME: str | None = None
ACTIVE_PROFILE: dict | None = None
SYMBOLS: list[dict] = []


CANDLE_COUNT = {
    "5m": 400,
    "15m": 400,
    "1h": 300,
    "4h": 300,
    "d1": 365,
    "w1": 300,
}

PUSH_INTERVAL = 5

TIMEFRAME_MAP = {
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "d1": mt5.TIMEFRAME_D1,
    "w1": mt5.TIMEFRAME_W1,
}


# ---------------------------------------------------------------------------
# Backend URLs and HTTP session
# ---------------------------------------------------------------------------

PUSH_URL = f"{API_BASE_URL}/trading-api/mt5/push"
STATUS_URL = f"{API_BASE_URL}/trading-api/mt5/status"
ORDERS_URL = f"{API_BASE_URL}/trading-api/trade/pending"
RESULT_URL = f"{API_BASE_URL}/trading-api/trade/result"
POSITIONS_URL = f"{API_BASE_URL}/trading-api/trade/positions/sync"
BREAKEVEN_URL = f"{API_BASE_URL}/trading-api/trade/breakeven-moved"

HEADERS = {
    "Content-Type": "application/json",
    "X-MT5-Secret": MT5_SECRET,
}

_session = requests.Session()
_session.headers.update(HEADERS)


# ---------------------------------------------------------------------------
# Profile selection and account verification
# ---------------------------------------------------------------------------

def _safe_mt5_shutdown() -> None:
    try:
        mt5.shutdown()
    except Exception as exc:
        print(f"WARNING: MT5 shutdown warning: {exc}")


def _build_symbols(profile: dict) -> list[dict]:
    suffix = str(profile.get("symbol_suffix", ""))
    return [
        {
            "mt5_name": f"{item['base']}{suffix}",
            "api_symbol": item["api_symbol"],
        }
        for item in BASE_SYMBOLS
    ]


def _profile_is_configured(profile_name: str, profile: dict) -> bool:
    terminal_path = str(profile.get("terminal_path", "")).strip()
    expected_login = int(profile.get("expected_login", 0) or 0)
    expected_server = str(profile.get("expected_server", "")).strip()

    if not terminal_path or not os.path.isfile(terminal_path):
        print(f"[{profile_name}] terminal64.exe not found:")
        print(f"             {terminal_path}")
        return False

    if expected_login <= 0:
        print(f"[{profile_name}] expected_login is not configured")
        return False

    if not expected_server:
        print(f"[{profile_name}] expected_server is empty")
        return False

    if "PUT-" in expected_server.upper():
        print(f"[{profile_name}] expected_server is still a placeholder")
        return False

    return True


def _account_matches_profile(account, profile: dict) -> bool:
    if account is None:
        return False

    expected_login = int(profile["expected_login"])
    expected_server = str(profile["expected_server"]).strip()

    actual_login = int(account.login)
    actual_server = str(account.server).strip()

    return (
        actual_login == expected_login
        and actual_server.casefold() == expected_server.casefold()
    )


def scan_mt5_profiles() -> list[str]:
    """
    Check each configured terminal path and return profiles whose detected
    login and server match the configured identity.
    """
    found_profiles: list[str] = []

    print()
    print("Scanning configured MT5 accounts...")

    for profile_name, profile in MT5_PROFILES.items():
        if not _profile_is_configured(profile_name, profile):
            continue

        _safe_mt5_shutdown()

        connected = mt5.initialize(
            path=profile["terminal_path"],
            timeout=10000,
        )

        if not connected:
            print(
                f"[{profile_name}] terminal unavailable: "
                f"{mt5.last_error()}"
            )
            continue

        account = mt5.account_info()

        if account is None:
            print(f"[{profile_name}] account information unavailable")
            _safe_mt5_shutdown()
            continue

        actual_login = int(account.login)
        actual_server = str(account.server).strip()

        if _account_matches_profile(account, profile):
            print(
                f"[{profile_name}] verified: "
                f"{actual_server} / login {actual_login}"
            )
            found_profiles.append(profile_name)
        else:
            print(
                f"[{profile_name}] identity mismatch: "
                f"{actual_server} / login {actual_login}"
            )

        _safe_mt5_shutdown()

    return found_profiles


def choose_mt5_profile() -> bool:
    """
    Select one verified profile automatically or ask when multiple profiles
    match. The bridge does not start its order thread until this succeeds.
    """
    global ACTIVE_PROFILE_NAME, ACTIVE_PROFILE, SYMBOLS

    found_profiles = scan_mt5_profiles()

    if not found_profiles:
        print()
        print("No configured MT5 account was verified.")
        print("Open and log in to the desired MT5 terminal.")
        print("Then start the bridge again.")
        return False

    if len(found_profiles) == 1:
        selected_name = found_profiles[0]
        print(
            f"\nOnly one verified MT5 account found: "
            f"{selected_name}"
        )
    else:
        print("\nMultiple verified MT5 accounts found.")

        for index, profile_name in enumerate(found_profiles, start=1):
            label = MT5_PROFILES[profile_name]["label"]
            print(f"[{index}] {label}")

        while True:
            choice = input("Select the MT5 account to use: ").strip()

            if choice.isdigit():
                selected_index = int(choice) - 1

                if 0 <= selected_index < len(found_profiles):
                    selected_name = found_profiles[selected_index]
                    break

            print("Invalid choice. Enter one of the numbers above.")

    ACTIVE_PROFILE_NAME = selected_name
    ACTIVE_PROFILE = MT5_PROFILES[selected_name]
    SYMBOLS = _build_symbols(ACTIVE_PROFILE)

    print(
        f"\nSelected MT5 profile: "
        f"{ACTIVE_PROFILE['label']}"
    )

    return connect_mt5()


def active_account_matches() -> bool:
    """
    Re-check the account while the bridge is running. This blocks data and
    order activity if somebody logs another account into the terminal.
    """
    if ACTIVE_PROFILE is None:
        return False

    try:
        account = mt5.account_info()
    except Exception:
        return False

    return _account_matches_profile(account, ACTIVE_PROFILE)


def connect_mt5() -> bool:
    """
    Connect to the selected terminal path and verify its account identity.
    """
    if ACTIVE_PROFILE is None:
        print("ERROR: No MT5 profile selected.")
        return False

    terminal_path = ACTIVE_PROFILE["terminal_path"]

    print()
    print(f"Connecting to {ACTIVE_PROFILE['label']}...")
    print(f"Terminal: {terminal_path}")

    _safe_mt5_shutdown()

    if not mt5.initialize(
        path=terminal_path,
        timeout=60000,
    ):
        print(
            "ERROR: MT5 initialization failed:",
            mt5.last_error(),
        )
        return False

    account = mt5.account_info()

    if account is None:
        print("ERROR: MT5 account information unavailable.")
        _safe_mt5_shutdown()
        return False

    actual_login = int(account.login)
    actual_server = str(account.server).strip()

    print(f"Detected server: {actual_server}")
    print(f"Detected login: {actual_login}")

    if not _account_matches_profile(account, ACTIVE_PROFILE):
        print()
        print("ERROR: WRONG MT5 ACCOUNT")
        print(f"Expected login:  {ACTIVE_PROFILE['expected_login']}")
        print(f"Detected login:  {actual_login}")
        print(f"Expected server: {ACTIVE_PROFILE['expected_server']}")
        print(f"Detected server: {actual_server}")
        print()
        print("No market data will be sent.")
        print("No trades will be executed.")
        _safe_mt5_shutdown()
        return False

    print()
    print("MT5 ACCOUNT VERIFIED")
    print(f"Profile: {ACTIVE_PROFILE['label']}")
    print(f"Server:  {actual_server}")
    print(f"Login:   {actual_login}")

    for sym in SYMBOLS:
        name = sym["mt5_name"]

        if mt5.symbol_select(name, True):
            print(f"OK Symbol ready: {name}")
        else:
            print(f"WARNING: Could not select {name}")

    return True


# ---------------------------------------------------------------------------
# Candle data
# ---------------------------------------------------------------------------

def fetch_candles(
    mt5_symbol: str,
    tf_name: str,
    mt5_tf,
):
    rates = mt5.copy_rates_from_pos(
        mt5_symbol,
        mt5_tf,
        0,
        CANDLE_COUNT[tf_name],
    )

    if rates is None or len(rates) == 0:
        print(f"WARNING: No data for {mt5_symbol} {tf_name}")
        return None

    return [
        {
            "time": int(row["time"]),
            "open": round(float(row["open"]), 5),
            "high": round(float(row["high"]), 5),
            "low": round(float(row["low"]), 5),
            "close": round(float(row["close"]), 5),
        }
        for row in rates
    ]


def push_timeframe(
    api_symbol: str,
    tf_name: str,
    candles,
) -> bool:
    payload = {
        "symbol": api_symbol,
        "interval": tf_name,
        "candles": candles,
    }

    for attempt in range(2):
        try:
            response = _session.post(
                PUSH_URL,
                json=payload,
                timeout=15,
            )

            if response.status_code == 200:
                data = response.json()
                print(
                    f"OK {tf_name}: "
                    f"{data.get('candles_received', 0)} candles"
                )
                return True

            print(
                f"ERROR {tf_name}: "
                f"HTTP {response.status_code}"
            )
            return False

        except requests.exceptions.Timeout:
            if attempt == 0:
                print(
                    f"[RETRY] {tf_name} timed out. "
                    "Retrying in 2 seconds..."
                )
                time.sleep(2)
            else:
                print(
                    f"ERROR {tf_name}: "
                    "timed out after retry"
                )

        except requests.exceptions.RequestException as exc:
            print(f"ERROR {tf_name}: {exc}")
            return False

    return False


def push_symbol(sym: dict) -> int:
    mt5_name = sym["mt5_name"]
    api_symbol = sym["api_symbol"]
    success = 0

    for tf_name, mt5_tf in TIMEFRAME_MAP.items():
        candles = fetch_candles(
            mt5_name,
            tf_name,
            mt5_tf,
        )

        if candles and push_timeframe(
            api_symbol,
            tf_name,
            candles,
        ):
            success += 1

    return success


def push_all() -> int:
    results = [0] * len(SYMBOLS)

    def push_one(index: int, sym: dict) -> None:
        print(f"\n[{sym['mt5_name']}]")
        results[index] = push_symbol(sym)

    threads = [
        _threading.Thread(
            target=push_one,
            args=(index, sym),
        )
        for index, sym in enumerate(SYMBOLS)
    ]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    return sum(results)


def _api_to_mt5(api_symbol: str) -> str | None:
    for sym in SYMBOLS:
        if sym["api_symbol"] == api_symbol:
            return sym["mt5_name"]

    return None


# ---------------------------------------------------------------------------
# Trading
# ---------------------------------------------------------------------------

def _get_filling_mode(
    mt5_sym: str,
    order_type: str = "MARKET",
):
    info = mt5.symbol_info(mt5_sym)

    if info:
        filling_mode = info.filling_mode

        if order_type != "MARKET":
            if filling_mode & 1:
                return mt5.ORDER_FILLING_FOK

            if filling_mode & 2:
                return mt5.ORDER_FILLING_IOC
        else:
            if filling_mode & 2:
                return mt5.ORDER_FILLING_IOC

            if filling_mode & 1:
                return mt5.ORDER_FILLING_FOK

    return mt5.ORDER_FILLING_IOC


_breakeven_tracker: dict[int, dict] = {}
_pending_be: dict[int, dict] = {}


def _pip(price: float, symbol: str | None = None) -> float:
    """
    Return the trading pip size.

    DXY and broker-suffixed variants such as DXYm use:
        0.001 = 1 MT5 point
        0.010 = 1 trading pip
    """
    symbol_key = (
        str(symbol or "")
        .upper()
        .replace("/", "")
        .replace("_", "")
        .strip()
    )

    if symbol_key.startswith("DXY"):
        return 0.01

    # Original fallback logic. Keep unchanged.
    if price > 10_000:
        return 1.0
    if price > 500:
        return 0.1
    if price > 50:
        return 0.01
    return 0.0001

def _report(
    order_id,
    ticket,
    status,
    message,
    fill_price=None,
) -> None:
    try:
        _session.post(
            RESULT_URL,
            json={
                "order_id": order_id,
                "ticket": ticket,
                "status": status,
                "message": message,
                "fill_price": fill_price,
            },
            timeout=5,
        )
    except Exception as exc:
        print(f"[TRADE] report error: {exc}")


def _execute_order(order: dict) -> None:
    order_id = order["order_id"]

    received_at = order.get("_received_at")

    if (
        order.get("order_type") == "MARKET"
        and received_at is not None
    ):
        age = time.time() - received_at

        if age > 10:
            symbol = order.get("symbol", "unknown")

            print(
                f"[TRADE] STALE market order discarded "
                f"({age:.1f}s): {symbol}"
            )

            _report(
                order_id,
                None,
                "CANCELLED",
                (
                    f"Market order stale "
                    f"({age:.1f}s since received) — resubmit"
                ),
            )
            return

    mt5_sym = _api_to_mt5(order["symbol"])

    if not mt5_sym:
        _report(
            order_id,
            None,
            "ERROR",
            f"Unknown symbol: {order['symbol']}",
        )
        return

    tick = mt5.symbol_info_tick(mt5_sym)

    if not tick:
        _report(
            order_id,
            None,
            "ERROR",
            "No tick price",
        )
        return

    direction = order["direction"]
    order_type = order["order_type"]
    stop_loss = order["sl"]
    take_profit = order["tp"]
    lots = order["lots"]

    if direction == "BUY":
        price = (
            tick.ask
            if order_type == "MARKET"
            else order["price"]
        )

        mt5_type = (
            mt5.ORDER_TYPE_BUY
            if order_type == "MARKET"
            else mt5.ORDER_TYPE_BUY_LIMIT
        )
    else:
        price = (
            tick.bid
            if order_type == "MARKET"
            else order["price"]
        )

        mt5_type = (
            mt5.ORDER_TYPE_SELL
            if order_type == "MARKET"
            else mt5.ORDER_TYPE_SELL_LIMIT
        )

    request = {
        "action": (
            mt5.TRADE_ACTION_DEAL
            if order_type == "MARKET"
            else mt5.TRADE_ACTION_PENDING
        ),
        "symbol": mt5_sym,
        "volume": lots,
        "type": mt5_type,
        "price": price,
        "sl": stop_loss,
        "tp": take_profit,
        "deviation": 10,
        "comment": order.get("comment", "STRUCT.ai"),
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _get_filling_mode(
            mt5_sym,
            order_type=order_type,
        ),
    }

    result = mt5.order_send(request)

    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        print(
            f"[TRADE] FILLED: "
            f"{direction} {lots} {order['symbol']} "
            f"@ {result.price} ticket={result.order}"
        )

        _report(
            order_id,
            result.order,
            "FILLED",
            "OK",
            fill_price=result.price,
        )

        if order.get("comment", "") == "STRUCT.ai-Framework":
            if order_type == "MARKET":
                _breakeven_tracker[result.order] = {
                    "symbol": mt5_sym,
                    "direction": direction,
                    "entry": result.price,
                    "sl_orig": stop_loss,
                    "tp": take_profit,
                    "moved": False,
                }
            else:
                _pending_be[result.order] = {
                    "symbol": mt5_sym,
                    "direction": direction,
                    "sl_orig": stop_loss,
                    "tp": take_profit,
                }
    else:
        message = (
            result.comment
            if result
            else str(mt5.last_error())
        )

        print(
            f"[TRADE] REJECTED: "
            f"{order['symbol']} {message}"
        )

        _report(
            order_id,
            None,
            "REJECTED",
            message,
        )


def _check_breakeven_all() -> None:
    for ticket in list(_pending_be.keys()):
        position_list = mt5.positions_get(ticket=ticket)

        if position_list:
            info = _pending_be.pop(ticket)

            _breakeven_tracker[ticket] = {
                "symbol": info["symbol"],
                "direction": info["direction"],
                "entry": position_list[0].price_open,
                "sl_orig": info["sl_orig"],
                "tp": info["tp"],
                "moved": False,
            }
        elif not mt5.orders_get(ticket=ticket):
            del _pending_be[ticket]

    for ticket, info in list(_breakeven_tracker.items()):
        if info["moved"]:
            if not mt5.positions_get(ticket=ticket):
                del _breakeven_tracker[ticket]
            continue

        if not mt5.positions_get(ticket=ticket):
            del _breakeven_tracker[ticket]
            continue

        entry = info["entry"]
        original_stop_loss = info["sl_orig"]
        one_r = abs(entry - original_stop_loss)
        pip = _pip(entry, info["symbol"])

        if one_r <= 0:
            continue

        tick_data = mt5.symbol_info_tick(info["symbol"])

        if not tick_data:
            continue

        close = (
            tick_data.bid
            if info["direction"] == "BUY"
            else tick_data.ask
        )

        if info["direction"] == "BUY":
            if close < entry + 1.5 * one_r:
                continue

            new_stop_loss = round(entry + pip, 5)
        else:
            if close > entry - 1.5 * one_r:
                continue

            new_stop_loss = round(entry - pip, 5)

        position_list = mt5.positions_get(ticket=ticket)

        if not position_list:
            del _breakeven_tracker[ticket]
            continue

        position = position_list[0]

        result = mt5.order_send(
            {
                "action": mt5.TRADE_ACTION_SLTP,
                "symbol": info["symbol"],
                "position": ticket,
                "sl": new_stop_loss,
                "tp": (
                    position.tp
                    if position.tp > 0
                    else info["tp"]
                ),
            }
        )

        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            info["moved"] = True

            print(
                f"[BE] ticket={ticket} "
                f"SL moved to {new_stop_loss}"
            )

            try:
                _session.post(
                    BREAKEVEN_URL,
                    json={"ticket": ticket},
                    timeout=5,
                )
            except Exception:
                pass


def _execute_close(order: dict) -> None:
    order_id = order["order_id"]
    ticket = order["ticket"]

    positions = mt5.positions_get() or []

    position = next(
        (
            item
            for item in positions
            if item.ticket == ticket
        ),
        None,
    )

    if not position:
        _report(
            order_id,
            ticket,
            "ERROR",
            f"Position {ticket} not found",
        )
        return

    tick = mt5.symbol_info_tick(position.symbol)

    if not tick:
        _report(
            order_id,
            ticket,
            "ERROR",
            "No tick price for close — MT5 disconnected, retry",
        )
        return

    price = (
        tick.bid
        if position.type == 0
        else tick.ask
    )

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "volume": position.volume,
        "type": (
            mt5.ORDER_TYPE_SELL
            if position.type == 0
            else mt5.ORDER_TYPE_BUY
        ),
        "position": ticket,
        "price": price,
        "comment": "STRUCT.ai close",
        "type_filling": _get_filling_mode(position.symbol),
    }

    result = mt5.order_send(request)

    if result and result.retcode == mt5.TRADE_RETCODE_DONE:
        print(
            f"[TRADE] CLOSED ticket={ticket} "
            f"@ {result.price}"
        )

        _report(
            order_id,
            ticket,
            "FILLED",
            "Closed",
            fill_price=result.price,
        )
    else:
        message = (
            result.comment
            if result
            else str(mt5.last_error())
        )

        _report(
            order_id,
            ticket,
            "ERROR",
            f"Close failed: {message}",
        )


def _sync_positions() -> None:
    positions = mt5.positions_get() or []

    position_list = [
        {
            "ticket": position.ticket,
            "symbol": position.symbol,
            "type": (
                "BUY"
                if position.type == 0
                else "SELL"
            ),
            "volume": position.volume,
            "price_open": position.price_open,
            "price_current": position.price_current,
            "sl": position.sl,
            "tp": position.tp,
            "profit": round(position.profit, 2),
        }
        for position in positions
    ]

    try:
        _session.post(
            POSITIONS_URL,
            json={"positions": position_list},
            timeout=5,
        )
    except Exception:
        pass


def check_pending_orders() -> None:
    try:
        response = _session.get(
            ORDERS_URL,
            timeout=20,
        )

        if response.status_code != 200:
            return

        bridge_received_at = time.time()
        orders = response.json().get("orders", [])

        for order in orders:
            order["_received_at"] = bridge_received_at

            if order.get("order_type") == "CLOSE":
                _execute_close(order)
            else:
                _execute_order(order)

        if orders:
            _sync_positions()

    except Exception as exc:
        print(f"[TRADE] poll error: {exc}")


# ---------------------------------------------------------------------------
# Background order polling
# ---------------------------------------------------------------------------

def _order_poll_loop() -> None:
    print("[TRADE] Order poll thread started")

    while True:
        try:
            if not active_account_matches():
                print(
                    "[TRADE] Account verification failed; "
                    "orders are paused"
                )
                time.sleep(2)
                continue

            check_pending_orders()

        except Exception as exc:
            print(f"[TRADE] order poll error: {exc}")
            time.sleep(1)


# ---------------------------------------------------------------------------
# Main bridge loop
# ---------------------------------------------------------------------------

def run() -> None:
    print("=" * 50)
    print("STRUCT.ai - MT5 Bridge")
    print("=" * 50)
    print(f"API: {API_BASE_URL}")
    print(f"Profiles: {', '.join(MT5_PROFILES.keys())}")
    print(f"Interval: {PUSH_INTERVAL}s")
    print()

    if not choose_mt5_profile():
        return

    print()
    print("Starting loop... Press Ctrl+C to stop")

    order_thread = _threading.Thread(
        target=_order_poll_loop,
        daemon=True,
    )
    order_thread.start()

    consecutive_errors = 0

    while True:
        if not SYMBOLS:
            print("ERROR: No symbols configured.")
            time.sleep(30)
            continue

        if (
            mt5.terminal_info() is None
            or not active_account_matches()
        ):
            print(
                "MT5 connection/account changed. "
                "Reconnecting..."
            )

            _safe_mt5_shutdown()

            if not connect_mt5():
                time.sleep(30)
                continue

        tick = mt5.symbol_info_tick(
            SYMBOLS[0]["mt5_name"]
        )

        if tick:
            broker_hms = datetime.datetime.fromtimestamp(
                tick.time,
                tz=datetime.timezone.utc,
            ).strftime("%H:%M:%S UTC")
        else:
            broker_hms = "??:??:?? UTC"

        print(f"\n[{broker_hms}] Pushing data...")

        started_at = time.time()
        success = push_all()

        _check_breakeven_all()

        expected = len(SYMBOLS) * len(TIMEFRAME_MAP)

        if success == 0:
            consecutive_errors += 1
            print(f"ERROR: 0/{expected} successful")

            if consecutive_errors >= 5:
                print(
                    "Check the API connection, "
                    "API URL, or bridge secret."
                )
        else:
            consecutive_errors = 0
            print(f"Done: {success}/{expected} successful")

        _sync_positions()

        elapsed = time.time() - started_at
        time.sleep(
            max(
                0.5,
                PUSH_INTERVAL - elapsed,
            )
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        run()

    except KeyboardInterrupt:
        print()
        print("Stopped.")
        _safe_mt5_shutdown()
        print("MT5 disconnected.")

    except Exception as exc:
        print()
        print(f"FATAL BRIDGE ERROR: {exc}")
        _safe_mt5_shutdown()
        raise