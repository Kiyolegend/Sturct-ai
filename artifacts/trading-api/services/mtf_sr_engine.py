"""
Multi-Timeframe Support/Resistance Engine.

For each higher timeframe (15m, 1h, 4h):
  1. Detect swing points using the ZigZag engine
  2. Swing HIGHS → resistance candidates
  3. Swing LOWS  → support candidates
  4. Cluster nearby prices within a pip threshold
  5. Only keep clusters with >= min_touches (means price visited repeatedly)
  6. Apply S/R flip: relabel each level as support (below price) or
     resistance (above price) based on its position relative to current price.
     A former resistance that price has risen above becomes support, and vice versa.
  7. Apply proximity filter: discard levels too far from current price.
  8. Return labelled levels: {price, kind, timeframe, touches}

Resistance = above current price (yellow on chart)
Support    = below current price (purple on chart)

Clustering thresholds (USDJPY — 1 pip = 0.01):
  4h  → 0.15  (15 pips tolerance; large candles)
  1h  → 0.07  (7 pips)
  15m → 0.03  (3 pips)

Proximity limits (pips from current price):
  4h  → 300 pips
  1h  → 200 pips
  15m → 100 pips
"""

from .zigzag_engine import detect_swings

# Per-timeframe config: (cluster_threshold, min_touches, max_distance_pips)
TF_CONFIG = {
    "4h":  (0.15, 2, 300),   # 15-pip cluster, 300-pip proximity limit
    "1h":  (0.07, 2, 200),   # 7-pip cluster,  200-pip proximity limit
    "15m": (0.03,  2, 100),  # 3-pip cluster,  100-pip proximity limit
}


def _cluster_levels(prices: list[float], threshold: float) -> list[dict]:
    """
    Group nearby prices into clusters.
    Returns list of {center, touches, prices} dicts.
    Greedy: iterate sorted prices, grow cluster while within threshold of cluster seed.
    """
    if not prices:
        return []

    sorted_prices = sorted(prices)
    clusters: list[dict] = []
    used = [False] * len(sorted_prices)

    for i in range(len(sorted_prices)):
        if used[i]:
            continue
        cluster = [sorted_prices[i]]
        used[i] = True
        for j in range(i + 1, len(sorted_prices)):
            if not used[j] and abs(sorted_prices[j] - sorted_prices[i]) <= threshold:
                cluster.append(sorted_prices[j])
                used[j] = True
        clusters.append({
            "center": round(sum(cluster) / len(cluster), 5),
            "touches": len(cluster),
            "prices": cluster,
        })

    return clusters


def detect_sr_levels(df_map: dict, timeframe: str, current_price: float) -> list[dict]:
    """
    Given a DataFrame for one timeframe, return S/R levels.

    After clustering, applies two corrections:
      1. S/R FLIP: relabel each level based on its position relative to current price.
         - Level above current price → resistance (regardless of historical origin)
         - Level below current price → support
      2. PROXIMITY FILTER: discard levels beyond the timeframe's max pip distance.
    """
    df = df_map[timeframe]
    threshold, min_touches, max_dist_pips = TF_CONFIG[timeframe]
    max_dist = max_dist_pips * 0.01  # pips → price units (USDJPY: 1 pip = 0.01)

    swings = detect_swings(df)
    if not swings:
        return []

    highs = [s["price"] for s in swings if s["kind"] == "high"]
    lows  = [s["price"] for s in swings if s["kind"] == "low"]

    all_clusters = (
        _cluster_levels(highs, threshold) +
        _cluster_levels(lows, threshold)
    )

    levels: list[dict] = []

    for c in all_clusters:
        if c["touches"] < min_touches:
            continue

        price = c["center"]
        dist  = abs(price - current_price)

        # Proximity filter — skip levels too far from current price
        if dist > max_dist:
            continue

        # S/R flip: assign label purely by position relative to current price
        kind = "resistance" if price > current_price else "support"

        levels.append({
            "price":     price,
            "kind":      kind,
            "timeframe": timeframe,
            "touches":   c["touches"],
        })

    return levels


def deduplicate_across_timeframes(all_levels: list[dict]) -> list[dict]:
    """
    When the same price area appears on multiple timeframes, keep only the
    highest-timeframe label (4h > 1h > 15m).
    Dedup threshold: 0.10 (10 pips) — within this range = same level.
    """
    TF_RANK = {"4h": 3, "1h": 2, "15m": 1}
    DEDUP_THRESHOLD = 0.10

    # Sort so higher timeframes come first
    sorted_levels = sorted(all_levels, key=lambda l: -TF_RANK.get(l["timeframe"], 0))

    kept: list[dict] = []
    for level in sorted_levels:
        overlap = False
        for existing in kept:
            if (existing["kind"] == level["kind"] and
                    abs(existing["price"] - level["price"]) <= DEDUP_THRESHOLD):
                overlap = True
                break
        if not overlap:
            kept.append(level)

    return kept


def compute_mtf_sr_levels(df_map: dict) -> list[dict]:
    """
    Main entry point. Compute S/R levels for all timeframes and deduplicate.
    Returns list of {price, kind, timeframe, touches}.

    Current price is taken from the most recent close of the 5m (or smallest
    available) timeframe so that S/R flip and proximity filter are accurate.
    """
    # Derive current price from smallest available timeframe
    for tf_key in ["5m", "15m", "1h", "4h"]:
        if tf_key in df_map and len(df_map[tf_key]) > 0:
            current_price = float(df_map[tf_key]["close"].iloc[-1])
            break
    else:
        return []

    all_levels: list[dict] = []

    for tf in ["4h", "1h", "15m"]:
        if tf in df_map:
            levels = detect_sr_levels(df_map, tf, current_price)
            all_levels.extend(levels)

    return deduplicate_across_timeframes(all_levels)
