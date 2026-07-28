"""
Confluence Engine — detects when an S/R level falls inside an S/D zone.

Two independent engines agreeing on the same price area = the strongest
SMC signal the system can produce.

Only reports ALIGNED confluences:
  resistance level inside a supply zone  → strong sell area
  support level inside a demand zone     → strong buy area

Misaligned confluences (e.g. support inside supply zone = battle zone)
are intentionally skipped — too noisy for reliable signals.
"""

def find_confluence(
    sr_levels: list[dict],
    zones: list[dict],
    current_price: float,
    obs:  list[dict] | None = None,
    fvgs: list[dict] | None = None,
) -> list[dict]:
    """
    Cross-reference S/R levels with S/D zones.

    Parameters
    ----------
    sr_levels     : output of compute_mtf_sr_levels()
    zones         : combined detect_zones() output across all timeframes
    current_price : latest close price (unused here, reserved for future
                    proximity filtering)

    Returns
    -------
    List of confluence hits sorted by confluence_score descending.
    Each hit contains:
      price, kind, aligned, sr_timeframe, sr_score,
      zone_timeframe, zone_quality, zone_top, zone_bottom,
      zone_kind, zone_status, confluence_score
    """
    results = []

    for level in sr_levels:
        price = level["price"]
        kind  = level["kind"]   # "support" | "resistance"

        for zone in zones:
            # Broken zones are dead — skip them
            if zone.get("broken"):
                continue

            # S/R level price must land inside the zone's top/bottom range
            if not (zone["bottom"] <= price <= zone["top"]):
                continue

            # Only aligned confluences: resistance in supply, support in demand
            aligned = (
                (kind == "resistance" and zone["kind"] == "supply") or
                (kind == "support"    and zone["kind"] == "demand")
            )
            if not aligned:
                continue

            # Score: 50% S/R recency score (0–1) + 50% zone quality (0–100 → 0–1)
            confluence_score = round(
                level["score"] * 0.5 + (zone["quality"] / 100.0) * 0.5,
                4,

            )

            # OB overlap: an OB of matching direction contains this S/R price
            has_ob = any(
                ob["bottom"] <= price <= ob["top"]
                and (
                    (kind == "resistance" and ob["type"] == "bearish") or
                    (kind == "support"    and ob["type"] == "bullish")
                )
                for ob in (obs or [])
            )
            # FVG overlap: an FVG of matching direction contains this S/R price
            has_fvg = any(
                fvg["bottom"] <= price <= fvg["top"]
                and (
                    (kind == "resistance" and fvg["type"] == "bearish") or
                    (kind == "support"    and fvg["type"] == "bullish")
                )
                for fvg in (fvgs or [])
            )
            results.append({
                "price":            price,
                "kind":             kind,
                "aligned":          True,
                "sr_timeframe":     level["timeframe"],
                "sr_score":         level["score"],
                "zone_timeframe":   zone["timeframe"],
                "zone_quality":     zone["quality"],
                "zone_top":         zone["top"],
                "zone_bottom":      zone["bottom"],
                "zone_kind":        zone["kind"],
                "zone_status":      zone.get("status", "unknown"),
                "confluence_score": confluence_score,
                "has_ob":           has_ob,
                "has_fvg":          has_fvg,
            })

            

    results.sort(key=lambda x: x["confluence_score"], reverse=True)
    return results