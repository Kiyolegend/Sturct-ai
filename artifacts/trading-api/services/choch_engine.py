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


def detect_choch(df: pd.DataFrame, swings: list[SwingPoint], structure_labels: list[dict], trend: str, lookback_hours: int = 24, fractal_n: int = 5) -> list[dict]:


    """
    Detect Change of Character events, filtered by current trend direction.

    - Bullish trend  → only flag bearish CHOCH (break below HL)
    - Bearish trend  → only flag bullish CHOCH (break above LH)
    - Neutral trend  → flag both directions

    Returns list: {time, price, direction, label, broken_label}
    """
    if not swings or not structure_labels or len(df) == 0:
        return []

    closes = df["close"].values
    times_arr = df["time"].astype("datetime64[s]").astype("int64").tolist()

    choch_events = []
    

        # Find only the MOST RECENT HL and MOST RECENT LH
    last_hl = next((l for l in reversed(structure_labels) if l["label"] == "HL"), None)
    last_lh = next((l for l in reversed(structure_labels) if l["label"] == "LH"), None)

    # Bearish CHOCH: close breaks BELOW the most recent HL (only in bullish/neutral trend)
    if last_hl and trend in ("bullish", "neutral"):
        level = last_hl["price"]
        swing_idx = last_hl["index"]
        for i in range(swing_idx + fractal_n + 1, len(df)):
            if closes[i] < level:
                choch_events.append({
                    "time": times_arr[i],
                    "price": round(level, 5),
                    "direction": "bearish",
                    "label": "CHOCH",
                    "broken_label": "HL",
                    "wick_extreme":  round(float(df["low"].values[i]), 5),
                })
                break

    # Bullish CHOCH: close breaks ABOVE the most recent LH (only in bearish/neutral trend)
    if last_lh and trend in ("bearish", "neutral"):
        level = last_lh["price"]
        swing_idx = last_lh["index"]
        for i in range(swing_idx + fractal_n + 1, len(df)):
            if closes[i] > level:
                choch_events.append({
                    "time": times_arr[i],
                    "price": round(level, 5),
                    "direction": "bullish",
                    "label": "CHOCH",
                    "broken_label": "LH",
                    "wick_extreme":  round(float(df["high"].values[i]), 5),
                })
                break

    choch_events.sort(key=lambda e: e.get("time", 0))
    if times_arr:
        cutoff = times_arr[-1] - (lookback_hours * 3600)
        choch_events = [e for e in choch_events if e["time"] >= cutoff]
    return choch_events
    
