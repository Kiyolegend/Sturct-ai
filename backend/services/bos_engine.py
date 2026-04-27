"""
BOS Engine — Break of Structure.

Rules:
  Bullish BOS → a candle CLOSES above a previous swing HIGH
  Bearish BOS → a candle CLOSES below a previous swing LOW

Only candle close prices are used (wicks are ignored).
A BOS is confirmed at the candle that closes beyond the level.
"""

import pandas as pd
from .zigzag_engine import SwingPoint


def detect_bos(df: pd.DataFrame, swings: list[SwingPoint], structure_labels: list[dict]) -> list[dict]:
    """
    Detect Break of Structure events.
    Returns list of BOS events: {time, price, direction, level_broken}
    """
    if len(swings) < 2 or len(df) == 0:
        return []

    bos_events = []
    closes = df["close"].values
    times_arr = [int(pd.Timestamp(t).timestamp()) for t in df["time"].values]

    # Track which swing highs/lows have been broken already to avoid duplicates
    broken_levels: set[float] = set()

    # For each swing high/low, scan subsequent candles for a close beyond it
    for label_item in structure_labels:
        level = label_item["price"]
        label = label_item["label"]
        swing_time = label_item["time"]
        swing_idx = label_item["index"]

        if level in broken_levels:
            continue

        # Only check candles AFTER the swing point
        for i in range(swing_idx + 1, len(df)):
            candle_time = times_arr[i]
            close = closes[i]

            # Bullish BOS: close above a swing HIGH (HH or LH)
            if label in ("HH", "LH") and close > level:
                bos_events.append({
                    "time": candle_time,
                    "price": round(level, 5),
                    "direction": "bullish",
                    "label": "BOS ↑",
                    "level_broken": round(level, 5),
                })
                broken_levels.add(level)
                break

            # Bearish BOS: close below a swing LOW (LL or HL)
            if label in ("LL", "HL") and close < level:
                bos_events.append({
                    "time": candle_time,
                    "price": round(level, 5),
                    "direction": "bearish",
                    "label": "BOS ↓",
                    "level_broken": round(level, 5),
                })
                broken_levels.add(level)
                break

    return bos_events
