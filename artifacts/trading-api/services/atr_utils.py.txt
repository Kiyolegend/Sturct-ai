"""
atr_utils.py — True ATR-14 computation, shared across all engines.

Single source of truth for ATR. Import compute_atr14 from here instead of
duplicating H-L range approximations in individual engines.

True ATR = max(H-L,  |H - prevClose|,  |L - prevClose|) per bar.
This correctly accounts for overnight / weekend gaps that H-L alone misses.
"""
import math
import numpy as np
import pandas as pd


def compute_atr14(df: pd.DataFrame) -> float:
    """
    Compute the 14-bar Average True Range for the given OHLC DataFrame.

    Requires columns: "high", "low", "close".
    Returns 0.0 when there is insufficient data or the result is non-finite.
    """
    if len(df) < 2:
        return 0.0

    high  = df["high"].values
    low   = df["low"].values
    close = df["close"].values

    # True range for bars 1..N requires the previous close
    prev_close = close[:-1]   # shape: N-1
    h = high[1:]              # shape: N-1
    l = low[1:]               # shape: N-1

    tr = np.maximum(
        h - l,
        np.maximum(np.abs(h - prev_close), np.abs(l - prev_close))
    )

    # Average over the last 14 true-range values
    window = tr[-14:] if len(tr) >= 14 else tr
    atr = float(window.mean()) if len(window) > 0 else 0.0
    return atr if math.isfinite(atr) else 0.0