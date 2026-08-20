"""
Central instrument rules.

The symbol override is optional. Existing callers that only pass price
continue using the original dynamic fallback logic.
"""

from __future__ import annotations


_SYMBOL_OVERRIDES: dict[str, dict[str, float | str]] = {
    "DXY": {
        "pip_size": 0.01,
        "asset_class": "index",
    },
}


def _normalise_symbol(symbol: str | None) -> str:
    if not symbol:
        return ""

    return (
        symbol.upper()
        .replace("/", "")
        .replace("_", "")
        .strip()
    )


def pip_size(price: float, symbol: str | None = None) -> float:
    """
    Return the trading pip size.

    An explicit symbol rule has priority. If no symbol rule exists,
    the original price-based fallback is used.
    """
    symbol_key = _normalise_symbol(symbol)

    if symbol_key.startswith("DXY"):
        return 0.01

    # Original fallback logic. Keep unchanged.
    if price > 10_000:
        return 1.0       # Crypto
    if price > 500:
        return 0.1       # Gold
    if price > 5:
        return 0.01      # JPY-style pricing
    return 0.0001        # Standard FX


def asset_class(price: float, symbol: str | None = None) -> str:
    """
    Return the instrument class.

    DXY is explicitly classified as an index when its symbol is supplied.
    Existing callers without a symbol keep the original fallback behavior.
    """
    symbol_key = _normalise_symbol(symbol)

    if symbol_key.startswith("DXY"):
        return "index"

    # Original fallback logic. Keep unchanged.
    if price > 10_000:
        return "crypto"
    if price > 500:
        return "metal"
    if price > 50:
        return "jpy"
    return "fx"