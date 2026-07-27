"""
Supply/Demand Zones Engine — Phase 2 Enhanced.

Changes vs Phase 1:
  - Candle-derived zone boundaries (top/bottom from actual OHLC, not ±fixed pips)
  - Freshness status: fresh → tested_once → tested_multiple → broken
  - Departure strength: how far price moved away after zone formed (in pips)
  - Quality score (0–100): timeframe + departure + freshness + touches - retests
  - `strength` kept for backward compatibility
  - `df` (OHLC DataFrame) passed in optionally; falls back to fixed width if absent
"""

from .zigzag_engine import SwingPoint


def _cluster_pips(price: float, timeframe: str = "1h") -> float:
    tf_scale = {"5m": 1.0, "15m": 1.5, "1h": 3.0, "4h": 8.0, "d1": 20.0, "w1": 50.0}
    scale = tf_scale.get(timeframe, 1.0)
    if price > 10_000: return min(200.0 * scale, 3000.0)
    if price > 500:    return 30.0  * scale
    if price > 50:     return 1.5   * scale
    return 1.5 * scale


def _zone_width_pips(price: float) -> float:
    if price > 10_000: return 300.0
    if price > 500:    return 50.0
    if price > 50:     return 3.0
    return 3.0


from .pip_utils import pip_size as _pip_size, asset_class as _asset_class


def _df_time_ints(df):
    """Convert df['time'] column to a Series of Unix int64 timestamps."""
    import pandas as pd
    col = df["time"]
    if pd.api.types.is_datetime64_any_dtype(col):
        return col.astype("datetime64[s]").astype("int64")
    return col.astype("int64")


def detect_zones(
    swings: list,
    timeframe: str = "1h",
    current_price: float | None = None,
    df=None,
) -> list[dict]:
    """
    Detect supply/demand zones from swing points.

    Parameters
    ----------
    swings        : list of SwingPoint dicts
    timeframe     : chart timeframe string (e.g. "1h", "4h")
    current_price : latest close price — used for pip size and proximity checks
    df            : OHLC DataFrame (optional). When provided, zone boundaries are
                    derived from the actual candles that formed each swing cluster
                    instead of using a fixed ±pip width.
    """
    if not swings:
        return []

    # ── Pip / reference price ────────────────────────────────────────────────
    if current_price is not None:
        pip = _pip_size(current_price)
        ref = current_price
    else:
        ref = sorted(s["price"] for s in swings)[len(swings) // 2]
        pip = _pip_size(ref)

    cluster_threshold = _cluster_pips(ref, timeframe) * pip
    zone_width        = _zone_width_pips(ref) * pip

    # ── Timeframe weights ────────────────────────────────────────────────────
    tf_strength = {"w1": 5, "d1": 4, "4h": 3, "1h": 2, "15m": 1, "5m": 0}
    base_strength = tf_strength.get(timeframe, 1)

    # Pre-compute df time index once (avoids repeated conversion inside loop)
    df_time_int = None
    if df is not None and len(df) > 0:
        try:
            df_time_int = _df_time_ints(df)
        except Exception:
            df_time_int = None

    # ── BUG-017: separate supply / demand swings ─────────────────────────────
    high_swings = [s for s in swings if s.get("kind") == "high"]
    low_swings  = [s for s in swings if s.get("kind") == "low"]

    # ── Cluster helper ───────────────────────────────────────────────────────
    def _cluster_swings(swing_list: list, zone_kind: str) -> list[dict]:
        if not swing_list:
            return []
        pairs = sorted(
            zip([s["price"] for s in swing_list], [s["time"] for s in swing_list]),
            key=lambda p: p[0],
        )
        lvls = [p[0] for p in pairs]
        tms  = [p[1] for p in pairs]

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
                    diff = lvls[j] - cluster_mean
                    if diff > cluster_threshold:   # BUG-018: early exit
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
                    "times":      cluster_times,          # all swing timestamps in cluster
                    "first_time": min(cluster_times),
                    "last_time":  max(cluster_times),
                    "kind":       zone_kind,              # BUG-017: supply | demand
                })
        return clusters

    all_clusters = (
        _cluster_swings(high_swings, "supply") +
        _cluster_swings(low_swings,  "demand")
    )

    # ── Build zone list ──────────────────────────────────────────────────────
    zones = []

    for cluster in all_clusters:
        strength = min(base_strength + cluster["touches"], 5)

        # ── Zone boundaries ──────────────────────────────────────────────────
        top, bottom = _derive_bounds(
            cluster, zone_kind=cluster["kind"],
            zone_width=zone_width, pip=pip,
            df=df, df_time_int=df_time_int,
        )

        # ── Broken check (BUG-019) ───────────────────────────────────────────
        broken = False
        if current_price is not None:
            if cluster["kind"] == "supply" and current_price > top:
                broken = True
            elif cluster["kind"] == "demand" and current_price < bottom:
                broken = True

        # ── Freshness & retest count ─────────────────────────────────────────
        status, confidence, retest_count = _compute_freshness(
            cluster, top, bottom, broken, df=df, df_time_int=df_time_int
        )

        # ── Departure strength ───────────────────────────────────────────────
        departure_pips = _compute_departure(
            cluster, pip=pip, df=df, df_time_int=df_time_int
        )

        # ── Quality score (0–100, no age penalty) ───────────────────────────
        quality = _compute_quality(
            timeframe=timeframe,
            departure_pips=departure_pips,
            status=status,
            touches=cluster["touches"],
            retest_count=retest_count,
            current_price=ref,
        )

        zones.append({
            "top":            top,
            "bottom":         bottom,
            "center":         round(cluster["center"], 5),
            "kind":           cluster["kind"],
            "touches":        cluster["touches"],
            "strength":       strength,          # kept for backward compat
            "broken":         broken,
            "timeframe":      timeframe,
            "start_time":     cluster["first_time"],
            "end_time":       cluster["last_time"],
            # Phase 2 additions:
            "status":         status,
            "confidence":     confidence,
            "departure_pips": departure_pips,
            "quality":        quality,
        })

    zones.sort(key=lambda z: z["quality"], reverse=True)
    return zones


# ── Private helpers ──────────────────────────────────────────────────────────

def _derive_bounds(cluster, zone_kind, zone_width, pip, df, df_time_int):
    """
    Derive zone top/bottom.
    If df is available: use the actual candle OHLC of the swing cluster.
    Otherwise: fall back to center ± fixed width.
    """
    fallback_top    = round(cluster["center"] + zone_width + cluster["touches"] * pip * 0.1, 5)
    fallback_bottom = round(cluster["center"] - zone_width - cluster["touches"] * pip * 0.1, 5)

    if df is None or df_time_int is None:
        return fallback_top, fallback_bottom

    try:
        cluster_ts  = set(cluster["times"])
        mask        = df_time_int.isin(cluster_ts)
        matching    = df[mask]

        if len(matching) == 0:
            return fallback_top, fallback_bottom

        if zone_kind == "supply":
            # Top = highest wick; Bottom = lowest body top (min of open/close)
            top    = round(float(matching["high"].max()), 5)
            bottom = round(float(matching[["open", "close"]].max(axis=1).min()), 5)
        else:  # demand
            # Bottom = lowest wick; Top = highest body bottom (max of open/close)
            bottom = round(float(matching["low"].min()), 5)
            top    = round(float(matching[["open", "close"]].min(axis=1).max()), 5)

        # Sanity check — must have positive height
        if top <= bottom or (top - bottom) > (cluster["center"] * 0.05):
            return fallback_top, fallback_bottom

        return top, bottom

    except Exception:
        return fallback_top, fallback_bottom


def _compute_freshness(cluster, top, bottom, broken, df, df_time_int):
    """
    Count how many times price returned to the zone after it was formed.
    Returns (status, confidence, retest_count).
    """
    if broken:
        return "broken", 0, 0

    retest_count = 0

    if df is not None and df_time_int is not None:
        try:
            last_ts   = cluster["last_time"]
            future_df = df[df_time_int > last_ts].reset_index(drop=True)
            count = 0
            last_retest_bar = -9999
            MIN_BARS_BETWEEN_RETESTS = 3
            for i in range(1, len(future_df)):
                prev_close   = float(future_df.loc[i - 1, "close"])
                prev_outside = prev_close > top or prev_close < bottom
                row          = future_df.iloc[i]
                enters_zone  = (
                    float(row["low"])   <= top    and
                    float(row["high"])  >= bottom and
                    float(row["close"]) >= bottom and
                    float(row["close"]) <= top
                )
                if prev_outside and enters_zone and (i - last_retest_bar) >= MIN_BARS_BETWEEN_RETESTS:
                    count += 1
                    last_retest_bar = i
            retest_count = count
        except Exception:
            retest_count = 0

    if retest_count == 0:
        return "fresh",           95, retest_count
    elif retest_count == 1:
        return "tested_once",     80, retest_count
    else:
        conf = max(60 - (retest_count - 2) * 10, 30)
        return "tested_multiple", conf, retest_count


def _compute_departure(cluster, pip, df, df_time_int):
    """
    Measure how far price moved from the zone center in the 20 candles
    immediately after the zone was formed. Returns result in pips.
    """
    if df is None or df_time_int is None or pip == 0:
        return 0

    try:
        last_ts   = cluster["last_time"]
        future_df = df[df_time_int > last_ts].head(20)

        if len(future_df) < 5:
            return None

        center = cluster["center"]
        if cluster["kind"] == "supply":
            max_drop = center - float(future_df["low"].min())
            return max(0, round(max_drop / pip))
        else:  # demand
            max_rise = float(future_df["high"].max()) - center
            return max(0, round(max_rise / pip))

    except Exception:
        return 0


# Per-asset departure ceilings — "how many pips = full 25pts on this timeframe?"
# Keyed by asset_class() string so the entire engine shares one classification.
_MAX_DEP: dict[str, dict[str, int]] = {
    "crypto": {"w1": 6000, "d1": 2000, "4h": 600, "1h": 250, "15m": 100, "5m": 50},
    "metal":  {"w1": 1500, "d1":  500, "4h": 150, "1h":  70, "15m":  30, "5m": 15},
    "jpy":    {"w1":  300, "d1":   80, "4h":  30, "1h":  15, "15m":   8, "5m":  5},
    "fx":     {"w1":  300, "d1":   80, "4h":  30, "1h":  15, "15m":   8, "5m":  5},
}


def _compute_quality(timeframe, departure_pips, status, touches, retest_count, current_price: float = 1.0):
    """
    Quality score 0–100. No age penalty — a 6-month-old Weekly zone that
    has never been retested can still score very high.

    Components:
      Timeframe weight  : up to 25 pts
      Departure strength: up to 25 pts
      Freshness         : up to 25 pts
      Touch quality     : up to 15 pts
      Retest penalty    : up to -15 pts
    """
    # Timeframe weight
    tf_pts = {"w1": 25, "d1": 20, "4h": 15, "1h": 10, "15m": 5, "5m": 0}
    tfw = tf_pts.get(timeframe, 5)

    # Departure strength — ceiling from shared _MAX_DEP table, keyed by asset class
    asset_dep = _MAX_DEP.get(_asset_class(current_price), _MAX_DEP["fx"])
    if departure_pips is None:
        dep_score = 12  # not enough future bars yet — neutral, neither reward nor penalise
    else:
        md = max(asset_dep.get(timeframe, 50), 1)
        dep_score = min(25, round((departure_pips / md) * 25))

    # Freshness
    freshness_pts = {"fresh": 25, "tested_once": 18, "tested_multiple": 10, "broken": 0}
    fresh_score = freshness_pts.get(status, 0)

    # Touch quality (more agreeing swings = stronger cluster)
    touch_score = min(15, touches * 5)

    # Retest penalty
    retest_penalty = min(15, retest_count * 5)

    return max(0, min(100, tfw + dep_score + fresh_score + touch_score - retest_penalty))