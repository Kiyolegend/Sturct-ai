"""
pip_utils.py — single source of truth for asset-class pip sizes.

Import pip_size from here instead of duplicating the logic in every engine.
"""


def pip_size(price: float) -> float:
    """Return the pip (tick) size for an instrument given its current price."""
    if price > 10_000: return 1.0    # Crypto  (BTC ~65 000)
    if price > 500:    return 0.1    # Gold    (XAU ~2 350)
    if price > 50:     return 0.01   # JPY pairs (USD/JPY ~150)
    return 0.0001                    # Standard FX (EUR/USD ~1.08)


def asset_class(price: float) -> str:
    """
    Single source of truth for instrument classification by price level.
    Returns one of: "crypto", "metal", "jpy", "fx"
    Use this everywhere instead of repeating the same if/elif thresholds.
    """
    if price > 10_000: return "crypto"   # BTC, ETH etc
    if price > 500:    return "metal"    # Gold, Silver etc
    if price > 50:     return "jpy"      # JPY pairs (USD/JPY ~150)
    return "fx"                          # Standard FX (EUR/USD ~1.08)