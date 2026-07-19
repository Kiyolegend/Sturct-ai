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
# Per-asset-class pip multipliers — FX baseline stays the same.
# Gold and BTC need much larger multipliers because their pip ($0.10 / $1.00)
# is tiny relative to their actual price swings.
def _cluster_pips(price: float, timeframe: str = "1h") -> float:
    tf_scale = {"5m": 1.0, "15m": 1.5, "1h": 3.0, "4h": 8.0, "d1": 20.0, "w1": 50.0}
    scale = tf_scale.get(timeframe, 1.0)
    if price > 10_000: return 200.0 * scale
    if price > 500:    return 30.0  * scale
    if price > 50:     return 1.5   * scale
    return 1.5 * scale

def _zone_width_pips(price: float) -> float:
    if price > 10_000: return 300.0   # BTC: $300 half-width
    if price > 500:    return 50.0    # Gold: $5 half-width
    if price > 50:     return 3.0     # JPY: 3 pips (unchanged)
    return 3.0                         # Standard FX: 3 pips (unchanged)


from .pip_utils import pip_size as _pip_size


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
        ref = current_price
    else:
        ref = sorted(s["price"] for s in swings)[len(swings) // 2]
        pip = _pip_size(ref)

    cluster_threshold = _cluster_pips(ref, timeframe) * pip
    zone_width        = _zone_width_pips(ref) * pip
    # Timeframe strength weights
    tf_strength = {"w1": 5, "d1": 4, "4h": 3, "1h": 2, "15m": 1, "5m": 0}
    base_strength = tf_strength.get(timeframe, 1)

    # Pair prices with times, then sort by price so the seed-based clustering
    # always compares against the lowest price in the cluster (deterministic).
    # --- BUG-017 fix: separate high swings (supply) from low swings (demand) ---
    high_swings = [s for s in swings if s.get("kind") == "high"]
    low_swings  = [s for s in swings if s.get("kind") == "low"]

    def _cluster_swings(swing_list: list, zone_kind: str) -> list[dict]:
        if not swing_list:
            return []
        pairs = sorted(
            zip([s["price"] for s in swing_list], [s["time"] for s in swing_list]),
            key=lambda p: p[0],
        )
        lvls  = [p[0] for p in pairs]
        tms   = [p[1] for p in pairs]

        used     = [False] * len(lvls)
        clusters = []

        for i in range(len(lvls)):
            if used[i]:
                continue
            cluster_prices = [lvls[i]]
            cluster_times  = [tms[i]]
            for j in range(i + 1, len(lvls)):
                if not used[j]:
                    cluster_mean = sum(cluster_prices) / len(cluster_prices)
                    diff = lvls[j] - cluster_mean          # sorted → always ≥ 0
                    if diff > cluster_threshold:            # BUG-018: early exit
                        break
                    cluster_prices.append(lvls[j])
                    cluster_times.append(tms[j])
                    used[j] = True
            used[i] = True

            if len(cluster_prices) >= 2:
                center = sum(cluster_prices) / len(cluster_prices)
                clusters.append({
                    "center":     center,
                    "touches":    len(cluster_prices),
                    "first_time": min(cluster_times),
                    "last_time":  max(cluster_times),
                    "kind":       zone_kind,              # BUG-017: supply | demand
                })
        return clusters

    all_clusters = _cluster_swings(high_swings, "supply") + _cluster_swings(low_swings, "demand")

    zones = []
    for cluster in all_clusters:
        half_w   = zone_width + (cluster["touches"] * pip * 0.1)
        strength = min(base_strength + cluster["touches"], 5)
        top      = round(cluster["center"] + half_w, 5)
        bottom   = round(cluster["center"] - half_w, 5)

        # BUG-019: mark zones that price has fully traded through
        broken = False
        if current_price is not None:
            if cluster["kind"] == "supply" and current_price > top:
                broken = True
            elif cluster["kind"] == "demand" and current_price < bottom:
                broken = True

        zones.append({
            "top":        top,
            "bottom":     bottom,
            "center":     round(cluster["center"], 5),
            "kind":       cluster["kind"],
            "touches":    cluster["touches"],
            "strength":   strength,
            "broken":     broken,
            "timeframe":  timeframe,
            "start_time": cluster["first_time"],
            "end_time":   cluster["last_time"],
        })

    zones.sort(key=lambda z: z["strength"], reverse=True)
    return zones

    