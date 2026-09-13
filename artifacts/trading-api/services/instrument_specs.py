from __future__ import annotations

import math

from services.mt5_store import get_symbol_spec


def require_spec(symbol: str) -> dict:
    spec = get_symbol_spec(symbol)

    if not spec:
        raise RuntimeError(
            f"MT5 specification unavailable for {symbol}"
        )

    return spec


def display_pip_size(symbol: str) -> float:
    return float(require_spec(symbol)["display_pip_size"])


def price_step(symbol: str) -> float:
    spec = require_spec(symbol)

    return max(
        float(spec["point"]),
        float(spec["trade_tick_size"]),
    )


def price_digits(symbol: str) -> int:
    return int(require_spec(symbol)["digits"])


def normalize_price(symbol: str, price: float) -> float:
    spec = require_spec(symbol)

    step = price_step(symbol)
    digits = price_digits(symbol)

    return round(
        round(price / step) * step,
        digits,
    )


def normalize_volume(symbol: str, lots: float) -> float:
    spec = require_spec(symbol)

    minimum = float(spec["volume_min"])
    maximum = float(spec["volume_max"])
    step = float(spec["volume_step"])

    lots = max(minimum, min(lots, maximum))
    lots = math.floor(lots / step) * step

    decimals = max(
        0,
        len(str(step).split(".")[-1]),
    )

    return round(lots, decimals)


def loss_per_lot(
    symbol: str,
    entry: float,
    stop_loss: float,
) -> float:
    spec = require_spec(symbol)

    tick_size = float(spec["trade_tick_size"])
    tick_value = float(spec["trade_tick_value_loss"])

    if tick_size <= 0 or tick_value <= 0:
        raise RuntimeError(
            f"Invalid MT5 tick data for {symbol}"
        )

    tick_count = abs(entry - stop_loss) / tick_size

    return tick_count * tick_value