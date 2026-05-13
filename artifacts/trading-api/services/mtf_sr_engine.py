"""
Multi-Timeframe Support/Resistance Engine — v2 (scored + recency-weighted)

For each higher timeframe (15m, 1h, 4h):
  1. Detect swing points using the ZigZag engine
  2. Swing HIGHS → resistance candidates
  3. Swing LOWS  → support candidates
  4. Cluster nearby prices within a pip threshold
  5. Only keep clusters with >= min_touches (raised to 3 for 15m/1h)
  6. Score each level by recency — how recently price tested this level.
     Recent levels rank higher; stale levels are naturally deprioritised.
  7. Apply S/R flip: relabel each level as support (below price) or
     resistance (above price) based on its position relative to current price.
  8. Apply proximity filter: discard levels too far from current price.
  9. Return labelled levels sorted by score descending:
     {price, kind, timeframe, touches, score}

Resistance = above current price (yellow on chart)
Support    = below current price (purple on chart)

Clustering thresholds (pip-aware, applied at runtime):
  4h  → 15 pips
  1h  → 7  pips
  15m → 3  pips

Proximity limits:
  4h  → 300 pips
  1h  → 200 pips
  15m → 100 pips

Deduplication: 10 pips (pip-aware — works correctly for all pairs)

min_touches raised:
  15m: 2 → 3  (reduces noise; 3 confirmed reactions needed)
  1h:  2 → 3  (same)
  4h:  2 → 2  (unchanged; fewer pivots available on 4H)

Recency decay:
  Each level is scored by how recently price last tested it.
  score = exp(-bars_since_last_touch / decay_half_life)
  decay_half_life per timeframe:
    15m → 150 bars (~37 hours)
    1h  → 80  bars (~80 hours / 3.3 days)
    4h  → 40  bars (~160 hours / 6.6 days)
"""

import math
from .zigzag_engine import detect_swings

# Per-timeframe config stored in pips (symbol-agnostic).
# pip_size is computed at runtime from current_price — no symbol name needed:
#   JPY pairs  (USD/JPY, EUR/JPY, GBP/JPY) → price ~100–200 → pip_size = 0.01
#   Other pairs (EUR/USD, GBP/USD, etc.)   → price ~0.5–2.0 → pip_size = 0.0001
# Keys: (cluster_pips, min_touches, max_dist_pips, recency_decay_bars)
TF_CONFIG = {
    "4h":  {"cluster_pips": 15, "min_touches": 2, "max_dist_pips": 300, "decay_bars": 40},
    "1h":  {"cluster_pips":  7, "min_touches": 3, "max_dist_pips": 200, "decay_bars": 80},
    "15m": {"cluster_pips":  3, "min_touches": 3, "max_dist_pips": 100, "decay_bars": 150},
}

# Deduplication tolerance in pips — applied pip-aware at runtime.
# 10 pips for any pair (was hardcoded 0.10 which only worked for JPY).
DEDUP_PIPS = 10


def _pip_size(price: float) -> float:
    """
    Infer pip size from current price.
    JPY pairs trade 100–200, all others trade 0.5–2.0.
    This avoids needing the symbol name while being 100% reliable for forex.
    """
    return 0.01 if price > 50 else 0.0001


def _cluster_levels(swing_data: list[dict], threshold: float) -> list[dict]:
    """
    Group nearby prices into clusters.
    Each swing_data item: {price, bar_index}
    Returns list of {center, touches, prices, last_bar_index} dicts.

    last_bar_index = the most recent bar at which this cluster was touched.
    This is used for recency scoring.

    Greedy: iterate sorted prices, grow cluster while within threshold of seed.
    """
    if not swing_data:
        return []

    sorted_data = sorted(swing_data, key=lambda x: x["price"])
    clusters: list[dict] = []
    used = [False] * len(sorted_data)

    for i in range(len(sorted_data)):
        if used[i]:
            continue
        cluster_items = [sorted_data[i]]
        used[i] = True
        for j in range(i + 1, len(sorted_data)):
            if not used[j] and abs(sorted_data[j]["price"] - sorted_data[i]["price"]) <= threshold:
                cluster_items.append(sorted_data[j])
                used[j] = True

        prices = [item["price"] for item in cluster_items]
        bar_indices = [item["bar_index"] for item in cluster_items]

        clusters.append({
            "center": round(sum(prices) / len(prices), 5),
            "touches": len(cluster_items),
            "prices": prices,
            "last_bar_index": max(bar_indices),  # most recent touch
        })

    return clusters


def _recency_score(last_bar_index: int, total_bars: int, decay_bars: float) -> float:
    """
    Compute a 0.0–1.0 recency score using exponential decay.
    A level tested at the last bar scores ~1.0.
    A level tested decay_bars bars ago scores ~0.37 (1/e).
    A level tested 3x decay_bars ago scores ~0.05 (nearly ignored).
    """
    bars_ago = max(0, total_bars - 1 - last_bar_index)
    return round(math.exp(-bars_ago / decay_bars), 4)


def detect_sr_levels(df_map: dict, timeframe: str, current_price: float) -> list[dict]:
    """
    Given a DataFrame for one timeframe, return scored S/R levels.

    Scoring uses recency (how recently the level was last tested).
    Levels are sorted descending by score so the frontend cap (3R + 3S)
    always picks the most recently confirmed levels.

    After clustering, applies two corrections:
      1. S/R FLIP: relabel each level based on position relative to current price.
      2. PROXIMITY FILTER: discard levels beyond the timeframe's max pip distance.
    """
    df = df_map[timeframe]
    cfg = TF_CONFIG[timeframe]

    # Determine pip size from current price — no symbol name required
    pip = _pip_size(current_price)
    threshold  = cfg["cluster_pips"]  * pip   # e.g. 15 pips for 4H
    max_dist   = cfg["max_dist_pips"] * pip   # e.g. 300 pips for 4H
    min_touches = cfg["min_touches"]
    decay_bars  = cfg["decay_bars"]
    total_bars  = len(df)

    swings = detect_swings(df)
    if not swings:
        return []

        # Build a time → bar_index lookup for recency calculation
    def get_bar_index(swing: dict) -> int:
        # swing["index"] is the bar position already stored by detect_swings()
        return int(swing.get("index", total_bars // 2))

    highs = [{"price": s["price"], "bar_index": get_bar_index(s)} for s in swings if s["kind"] == "high"]
    lows  = [{"price": s["price"], "bar_index": get_bar_index(s)} for s in swings if s["kind"] == "low"]

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

        # Recency score (0.0 – 1.0): higher = more recently tested
        score = _recency_score(c["last_bar_index"], total_bars, decay_bars)

        # Composite score: 60% recency + 40% touch count (normalised at 5 touches)
        touch_component = min(c["touches"] / 5.0, 1.0) * 0.4
        final_score = round(score * 0.6 + touch_component, 4)

        levels.append({
            "price":     price,
            "kind":      kind,
            "timeframe": timeframe,
            "touches":   c["touches"],
            "score":     final_score,
        })

    # Sort by score descending — best levels first
    levels.sort(key=lambda x: x["score"], reverse=True)

    return levels


def deduplicate_across_timeframes(all_levels: list[dict], current_price: float) -> list[dict]:
    """
    When the same price area appears on multiple timeframes, keep only the
    highest-timeframe label (4h > 1h > 15m).
    Dedup threshold: 10 pips — pip-aware, works correctly for all 8 pairs.
    """
    TF_RANK = {"4h": 3, "1h": 2, "15m": 1}

    # Pip-aware dedup: always 10 pips regardless of pair
    dedup_threshold = DEDUP_PIPS * _pip_size(current_price)

    # Sort so higher timeframes come first, then by score within same TF
    sorted_levels = sorted(
        all_levels,
        key=lambda l: (-TF_RANK.get(l["timeframe"], 0), -l.get("score", 0))
    )

    kept: list[dict] = []
    for level in sorted_levels:
        overlap = False
        for existing in kept:
            if (existing["kind"] == level["kind"] and
                    abs(existing["price"] - level["price"]) <= dedup_threshold):
                overlap = True
                break
        if not overlap:
            kept.append(level)

    return kept


def compute_mtf_sr_levels(df_map: dict) -> list[dict]:
    """
    Main entry point. Compute S/R levels for all timeframes and deduplicate.
    Returns list of {price, kind, timeframe, touches, score}.

    Current price is taken from the most recent close of the smallest
    available timeframe so that S/R flip and proximity filter are accurate.
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

    # Pass current_price so dedup threshold is pip-aware
    return deduplicate_across_timeframes(all_levels, current_price)