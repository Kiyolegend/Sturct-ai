"""
ZigZag Engine — The backbone of all market structure analysis.

Uses fractal-based swing detection:
  - A swing HIGH at index i: high[i] is the highest among [i-n .. i+n]
  - A swing LOW at index i:  low[i]  is the lowest  among [i-n .. i+n]

After detecting raw pivots, enforces strict alternation: High → Low → High → Low
(never two consecutive highs or two consecutive lows).
"""

import pandas as pd
import numpy as np
from typing import TypedDict

FRACTAL_N = 5  # bars on each side to confirm a swing point


class SwingPoint(TypedDict):
    index: int
    time: int
    price: float
    kind: str  # "high" or "low"


def detect_swings(df: pd.DataFrame, fractal_n: int = FRACTAL_N) -> list[SwingPoint]:
    """
    Detect swing highs and lows using fractal logic.
    Returns a strictly alternating list of swing points.
    """
    n = fractal_n
    highs = df["high"].values
    lows = df["low"].values
    times = df["time"].values
    ts_unix = (pd.to_datetime(df["time"]).astype("int64") // 10**9).values

    raw_pivots: list[SwingPoint] = []

    for i in range(n, len(df) - n):
        window_highs = highs[i - n: i + n + 1]
        window_lows = lows[i - n: i + n + 1]

        # Swing High: current high is the maximum in the window
        if highs[i] == window_highs.max():
            raw_pivots.append({
                "index": i,
                "time": int(ts_unix[i]),
                "price": float(round(highs[i], 5)),
                "kind": "high",
            })

        # Swing Low: current low is the minimum in the window
        if lows[i] == window_lows.min():
            raw_pivots.append({
                "index": i,
                "time": int(ts_unix[i]),
                "price": float(round(lows[i], 5)),
                "kind": "low",
            })

    if not raw_pivots:
        return []

    # Enforce strict alternation: keep only the most extreme pivot when two of the same kind appear consecutively
    alternating: list[SwingPoint] = [raw_pivots[0]]

    for pivot in raw_pivots[1:]:
        last = alternating[-1]
        if pivot["kind"] == last["kind"]:
            # Same kind — keep the more extreme one
            if pivot["kind"] == "high" and pivot["price"] > last["price"]:
                alternating[-1] = pivot
            elif pivot["kind"] == "low" and pivot["price"] < last["price"]:
                alternating[-1] = pivot
        else:
            alternating.append(pivot)

    # Filter: remove swings smaller than 5 pips from the previous swing
    MIN_SWING_PIPS = 5
    if len(alternating) >= 2:
        pip = 0.01 if alternating[0]["price"] > 50 else 0.0001
        min_move = MIN_SWING_PIPS * pip
        sized = [alternating[0]]
        for pt in alternating[1:]:
               if abs(pt["price"] - sized[-1]["price"]) >= min_move:
                   sized.append(pt)
        alternating = sized

    return alternating


def swings_to_zigzag_lines(swings: list[SwingPoint]) -> list[dict]:
    """
    Convert swing points into line segments for chart rendering.
    Each segment: {time1, price1, time2, price2}
    """
    lines = []
    for i in range(len(swings) - 1):
        lines.append({
            "from_time": swings[i]["time"],
            "from_price": swings[i]["price"],
            "to_time": swings[i + 1]["time"],
            "to_price": swings[i + 1]["price"],
        })
    return lines
