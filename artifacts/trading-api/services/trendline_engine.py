"""
Trendline Engine.

Uptrend   → least-squares fit through Higher Low (HL) points
Downtrend → least-squares fit through Lower High (LH) points

A minimum of 3 swing touches is required (ICT standard).
The projected line endpoint is the last swing plus one estimated bar interval.
A trendline is marked as invalidated if a subsequent candle has closed through it.
"""
from __future__ import annotations
import numpy as np


def compute_trendlines(
    structure_labels: list[dict],
    current_price: float | None = None,
    latest_time: int | None = None,
    bar_seconds: int = 900,       # default: 15-minute bars
    min_touches: int = 3,         # ICT: at least 3 touches required
) -> dict:
    """
    Build regression-based trendlines from structure labels.

    Returns:
      {
        "bullish": { "valid": bool, "slope": float, "intercept": float,
                     "from_time": int, "from_price": float,
                     "to_time": int,   "to_price": float,
                     "touches": int,   "invalidated": bool } | None,
        "bearish": { ... } | None
      }
    """
    def _fit(points: list[dict]) -> dict | None:
        if len(points) < min_touches:
            return None
        xs = np.array([float(p["time"]) for p in points])
        ys = np.array([float(p["price"]) for p in points])
        m, b = np.polyfit(xs, ys, 1)            # slope + intercept

        # Project to one bar after the last swing
        t_start = int(xs[0])
        t_end   = int(xs[-1]) + bar_seconds
        p_start = round(float(m * t_start + b), 5)
        p_end   = round(float(m * t_end   + b), 5)

        # Invalidated if current price has closed clearly through the trendline
        invalidated = False
        if current_price is not None and latest_time is not None:
            projected_now = m * float(latest_time) + b
            # Bullish trendline: invalidated if price closes below it
            # Bearish trendline: invalidated if price closes above it
            # (caller differentiates by checking slope sign / kind)
            invalidated = abs(current_price - projected_now) > abs(p_end - p_start)

        return {
            "valid":       True,
            "slope":       round(float(m), 10),
            "intercept":   round(float(b), 5),
            "from_time":   t_start,
            "from_price":  p_start,
            "to_time":     t_end,
            "to_price":    p_end,
            "touches":     len(points),
            "invalidated": invalidated,
        }

    hl_points = [s for s in structure_labels if s["label"] == "HL"]
    lh_points = [s for s in structure_labels if s["label"] == "LH"]

    bullish = _fit(hl_points)
    if bullish and current_price is not None:
        # Bullish trendline: invalidated when price closes below the projected value
        if bullish["slope"] > 0:
            proj = bullish["slope"] * float(latest_time or bullish["to_time"]) + bullish["intercept"]
            bullish["invalidated"] = current_price < proj

    bearish = _fit(lh_points)
    if bearish and current_price is not None:
        if bearish["slope"] < 0:
            proj = bearish["slope"] * float(latest_time or bearish["to_time"]) + bearish["intercept"]
            bearish["invalidated"] = current_price > proj

    return {
        "bullish": bullish,
        "bearish": bearish,
    }

    