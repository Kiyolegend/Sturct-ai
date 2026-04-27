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

CLUSTER_THRESHOLD = 0.015  # ~1.5 pips for JPY pairs (1 pip = 0.01 for USDJPY)
ZONE_WIDTH = 0.008           # Half-width of zone around level


def detect_zones(swings: list[SwingPoint], timeframe: str = "1h") -> list[dict]:
    """
    Detect support/resistance zones from swing points.
    Returns zone rectangles suitable for chart rendering.
    """
    if not swings:
        return []

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
            if not used[j] and abs(levels[j] - levels[i]) <= CLUSTER_THRESHOLD:
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
        half_w = ZONE_WIDTH + (cluster["touches"] * 0.0001)
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
