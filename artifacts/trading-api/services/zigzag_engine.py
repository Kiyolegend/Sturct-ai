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
TF_FRACTAL_N: dict[str, int] = {
    "w1": 2, "d1": 3, "4h": 3, "1h": 3, "15m": 5, "5m": 5
}


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
    ts_unix = df["time"].astype("datetime64[s]").astype("int64").values
    
    # BUG-055: spike filter — candles whose H-L range exceeds 5× the median
    # candle range are data errors or flash crashes; exclude from pivot detection.
    _ranges    = highs - lows
    _med_range = float(np.median(_ranges[_ranges > 0])) if np.any(_ranges > 0) else 0.0
    _spike     = (_ranges > 5.0 * _med_range) if _med_range > 0 else np.zeros(len(_ranges), dtype=bool)

    raw_pivots: list[SwingPoint] = []

    for i in range(n, len(df) - n):
        if _spike[i]:
            continue  # skip spike candles
        # Build neighbor windows excluding the center bar for strict comparison
        neighbors_h = np.concatenate([highs[i - n:i], highs[i + 1:i + n + 1]])
        neighbors_l = np.concatenate([lows[i - n:i], lows[i + 1:i + n + 1]])

        # Swing High: center bar strictly greater than ALL neighbors
        if highs[i] > neighbors_h.max():
            raw_pivots.append({
                "index": i,
                "time": int(ts_unix[i]),
                "price": float(round(highs[i], 5)),
                "kind": "high",
            })
        # elif prevents the same candle emitting both high AND low simultaneously
        elif lows[i] < neighbors_l.min():
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
    if len(alternating) >= 2:
        p   = alternating[0]["price"]
        pip = 1.0 if p > 10_000 else 0.1 if p > 500 else 0.01 if p > 50 else 0.0001
        # Minimum swing scaled by asset class: BTC needs $100+, Gold $5+, FX 5 pips
        if p > 10_000:  min_pips = 100   # BTC
        elif p > 500:   min_pips = 50    # Gold
        else:           min_pips = 5     # JPY + standard FX
        min_move = min_pips * pip
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
