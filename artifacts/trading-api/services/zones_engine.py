"""
Support/Resistance Zones Engine.

Detects price zones (rectangular areas) where price has reacted multiple times.
Strategy:
  1. Collect all swing highs/lows across timeframes
  2. Cluster nearby levels (within CLUSTER_THRESHOLD pip range)
  3. Zones with 2+ touches are valid; strength scales with touch count & timeframe

Returns rectangular zones: {top, bottom, strength, touches, timeframe}
"""

from .zigzag_engine import SwingPoint

# Pip-based constants — applied at runtime using current price.
# Equivalent to the original hardcoded values for JPY pairs (pip = 0.01):
#   CLUSTER_PIPS * 0.01 = 0.015  (was CLUSTER_THRESHOLD = 0.015)
#   ZONE_WIDTH_PIPS * 0.01 = 0.008  (was ZONE_WIDTH = 0.008)
CLUSTER_PIPS    = 1.5   # pip-neutral cluster tolerance
ZONE_WIDTH_PIPS = 0.8   # pip-neutral half-width of zone around center


def _pip_size(price: float) -> float:
    """
    Infer pip size from current price.
    JPY pairs trade 100–200 → pip = 0.01
    All other pairs trade 0.5–2.0 → pip = 0.0001
    """
    return 0.01 if price > 50 else 0.0001


def detect_zones(swings: list[SwingPoint], timeframe: str = "1h", current_price: float | None = None) -> list[dict]:
    """
    Detect support/resistance zones from swing points.
    Returns zone rectangles suitable for chart rendering.

    current_price is used to determine pip size for the pair being analysed.
    If not provided, it is estimated from the median swing price (safe fallback).
    """
    if not swings:
        return []

    # Determine pip size — use current_price if given, otherwise estimate from swings
    if current_price is not None:
        pip = _pip_size(current_price)
    else:
        median_price = sorted(s["price"] for s in swings)[len(swings) // 2]
        pip = _pip_size(median_price)

    cluster_threshold = CLUSTER_PIPS    * pip
    zone_width        = ZONE_WIDTH_PIPS * pip

    # Timeframe strength weights
    tf_strength = {"4h": 3, "1h": 2, "15m": 1, "5m": 0}
    base_strength = tf_strength.get(timeframe, 1)

    # Pair prices with times, then sort by price so the seed-based clustering
    # always compares against the lowest price in the cluster (deterministic).
    pairs = sorted(zip([s["price"] for s in swings], [s["time"] for s in swings]),
                   key=lambda x: x[0])
    levels = [p[0] for p in pairs]
    times  = [p[1] for p in pairs]

    # Cluster nearby levels
    clusters: list[dict] = []

    used = [False] * len(levels)

    for i in range(len(levels)):
        if used[i]:
            continue

        cluster_prices = [levels[i]]
        cluster_times = [times[i]]

        for j in range(i + 1, len(levels)):
            if not used[j] and abs(levels[j] - levels[i]) <= cluster_threshold:
                cluster_prices.append(levels[j])
                cluster_times.append(times[j])
                used[j] = True

        used[i] = True

        if len(cluster_prices) >= 2:
            center = sum(cluster_prices) / len(cluster_prices)
            touches = len(cluster_prices)
            clusters.append({
                "center": center,
                "touches": touches,
                "first_time": min(cluster_times),
                "last_time": max(cluster_times),
            })

    zones = []
    for cluster in clusters:
        half_w = zone_width + (cluster["touches"] * pip * 0.01)
        strength = min(base_strength + cluster["touches"], 5)
        zones.append({
            "top": round(cluster["center"] + half_w, 5),
            "bottom": round(cluster["center"] - half_w, 5),
            "center": round(cluster["center"], 5),
            "touches": cluster["touches"],
            "strength": strength,
            "timeframe": timeframe,
            "start_time": cluster["first_time"],
            "end_time": cluster["last_time"],
        })

    # Sort by strength descending
    zones.sort(key=lambda z: z["strength"], reverse=True)
    return zones