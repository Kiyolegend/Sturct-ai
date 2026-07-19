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