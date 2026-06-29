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


def detect_bos(df: pd.DataFrame, swings: list[SwingPoint], structure_labels: list[dict], trend: str = "neutral", lookback_hours: int = 48, fractal_n: int = 5) -> list[dict]:
    """
    Detect Break of Structure events.
    Returns list of BOS events: {time, price, direction, level_broken}

    trend: "bullish" | "bearish" | "neutral"
      - bullish → only emit bullish BOS (bearish breaks are CHoCH, not BOS)
      - bearish → only emit bearish BOS (bullish breaks are CHoCH, not BOS)
      - neutral → emit both directions (default, backward-compatible)
    """
    if not swings or not structure_labels or len(df) == 0:
        return []

    bos_events = []
    closes = df["close"].values
    times_arr = df["time"].astype("datetime64[s]").astype("int64").tolist()

    # Track which swing highs/lows have been broken already to avoid duplicates
    broken_levels: set[float] = set()

    # For each swing high/low, scan subsequent candles for a close beyond it
    for label_item in structure_labels:
        level = label_item["price"]
        label = label_item["label"]
        
        swing_idx = label_item["index"]

        if level in broken_levels:
            continue

        # Only check candles AFTER the swing point
        for i in range(swing_idx + fractal_n + 1, len(df)):
            candle_time = times_arr[i]
            close = closes[i]

            # Bullish BOS: close above a swing HIGH (HH or LH)
            if label in ("HH", "LH", "EQH") and close > level:
                if trend in ("bullish", "neutral"):
                    bos_events.append({
                        "time": candle_time,
                        "price": round(level, 5),
                        "direction": "bullish",
                        "label": "BOS ↑",
                        "level_broken": round(level, 5),
                        "wick_extreme":  round(float(df["high"].values[i]), 5),
                    })
                broken_levels.add(level)
                break

            # Bearish BOS: close below a swing LOW (LL or HL)
            if label in ("LL", "HL", "EQL") and close < level:
                if trend in ("bearish", "neutral"):
                    bos_events.append({
                        "time": candle_time,
                        "price": round(level, 5),
                        "direction": "bearish",
                        "label": "BOS ↓",
                        "level_broken": round(level, 5),
                        "wick_extreme":  round(float(df["low"].values[i]), 5),
                    })
                broken_levels.add(level)
                break
    
    bos_events.sort(key=lambda e: e.get("time", 0)) 
    if times_arr:
        cutoff = times_arr[-1] - (lookback_hours * 3600)
        bos_events = [e for e in bos_events if e["time"] >= cutoff]
    return bos_events
           