"""
Trendline Engine.

Uptrend   → least-squares fit through Higher Low (HL) points
Downtrend → least-squares fit through Lower High (LH) points

A minimum of 3 real touches required (points within 0.15% of the fitted line).
The line projects to current time + one bar so it is always visible on screen.
Invalidation is direction-aware: bullish broken if price closes below, bearish if above.
"""
from __future__ import annotations
import numpy as np


def compute_trendlines(
    structure_labels: list[dict],
    current_price: float | None = None,
    latest_time: int | None = None,
    bar_seconds: int = 900,
    min_touches: int = 3,
) -> dict:
    def _fit(points: list[dict]) -> dict | None:
        if len(points) < 2:
            return None
        xs = np.array([float(p["time"]) for p in points])
        ys = np.array([float(p["price"]) for p in points])
        m, b = np.polyfit(xs, ys, 1)

        t_start = int(xs[0])
        t_end   = (latest_time + bar_seconds) if latest_time is not None else (int(xs[-1]) + bar_seconds)
        p_start = round(float(m * t_start + b), 5)
        p_end   = round(float(m * t_end   + b), 5)

        tolerance    = np.mean(ys) * 0.0015
        real_touches = int(np.sum(np.abs(ys - (m * xs + b)) < tolerance))

        return {
            "valid":       True,
            "slope":       round(float(m), 10),
            "intercept":   round(float(b), 5),
            "from_time":   t_start,
            "from_price":  p_start,
            "to_time":     t_end,
            "to_price":    p_end,
            "touches":     real_touches,
            "invalidated": False,
        }

    hl_points = [s for s in structure_labels if s["label"] == "HL"]
    lh_points = [s for s in structure_labels if s["label"] == "LH"]

    bullish = _fit(hl_points)
    if bullish and bullish["touches"] < min_touches:
        bullish = None
    if bullish and current_price is not None and latest_time is not None:
        proj = bullish["slope"] * float(latest_time) + bullish["intercept"]
        bullish["invalidated"] = current_price < proj

    bearish = _fit(lh_points)
    if bearish and bearish["touches"] < min_touches:
        bearish = None
    if bearish and current_price is not None and latest_time is not None:
        proj = bearish["slope"] * float(latest_time) + bearish["intercept"]
        bearish["invalidated"] = current_price > proj

    return {
        "bullish": bullish,
        "bearish": bearish,
    }