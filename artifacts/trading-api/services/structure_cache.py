"""
Shared in-memory structure cache.
Routes write here after computing. Quick Scalp reads from here.
TTL: 25 seconds.
"""
import time
from typing import Optional

CACHE_TTL = 4  # seconds

_cache: dict[str, dict] = {}


def set_result(symbol: str, interval: str, result: dict) -> None:
    key = f"{symbol}_{interval}"
    _cache[key] = {**result, "_cached_at": time.time()}


def get_result(symbol: str, interval: str) -> Optional[dict]:
    key = f"{symbol}_{interval}"
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.time() - entry["_cached_at"] > CACHE_TTL:
        return None
    return entry

def invalidate(symbol: str, interval: str) -> None:
    """Drop cache for this symbol+interval so next request recomputes fresh."""
    _cache.pop(f"{symbol}_{interval}", None)

def invalidate_all() -> None:
    """Bust the entire cache — call after a full history re-collect."""
    _cache.clear()