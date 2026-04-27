"""
CHOCH Engine — Change of Character.

Detects early trend reversals:
  In a BULLISH trend → CHOCH occurs when price closes below a HL (Higher Low)
  In a BEARISH trend → CHOCH occurs when price closes above a LH (Lower High)
  In a NEUTRAL trend → both directions are monitored

CHOCH is the first sign of structural shift — before a full BOS sequence.
"""

import pandas as pd
from .zigzag_engine import SwingPoint


def detect_choch(df: pd.DataFrame, swings: list[SwingPoint], structure_labels: list[dict], trend: str) -> list[dict]:
    """
    Detect Change of Character events, filtered by current trend direction.

    - Bullish trend  → only flag bearish CHOCH (break below HL)
    - Bearish trend  → only flag bullish CHOCH (break above LH)
    - Neutral trend  → flag both directions

    Returns list: {time, price, direction, label, broken_label}
    """
    if len(structure_labels) < 2 or len(df) == 0:
        return []

    closes = df["close"].values
    times_arr = [int(pd.Timestamp(t).timestamp()) for t in df["time"].values]

    choch_events = []
    triggered: set[float] = set()

    for label_item in structure_labels:
        label = label_item["label"]
        level = label_item["price"]
        swing_idx = label_item["index"]

        if level in triggered:
            continue

        # Bearish CHOCH: close breaks BELOW a HL
        # Only relevant in a bullish or neutral trend — in bearish the structure
        # is already broken so HL violations are ordinary BOS, not CHOCH.
        if label == "HL" and trend in ("bullish", "neutral"):
            for i in range(swing_idx + 1, len(df)):
                if closes[i] < level:
                    choch_events.append({
                        "time": times_arr[i],
                        "price": round(level, 5),
                        "direction": "bearish",
                        "label": "CHOCH",
                        "broken_label": "HL",
                    })
                    triggered.add(level)
                    break

        # Bullish CHOCH: close breaks ABOVE a LH
        # Only relevant in a bearish or neutral trend.
        elif label == "LH" and trend in ("bearish", "neutral"):
            for i in range(swing_idx + 1, len(df)):
                if closes[i] > level:
                    choch_events.append({
                        "time": times_arr[i],
                        "price": round(level, 5),
                        "direction": "bullish",
                        "label": "CHOCH",
                        "broken_label": "LH",
                    })
                    triggered.add(level)
                    break

    return choch_events
