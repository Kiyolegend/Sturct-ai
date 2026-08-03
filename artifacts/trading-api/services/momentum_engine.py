"""
momentum_engine.py — Volatility regime and directional momentum metrics.

Measures HOW the market is moving, independent of structural direction.
Complements trend (what direction) and health (how clean the structure is).
"""
import math
import numpy as np
import pandas as pd

_ATR_EXPANDING    = 1.25  # recent ATR > older ATR by this factor → expanding
_ATR_CONTRACTING  = 0.80  # recent ATR < older ATR by this factor → contracting


def compute_momentum(df: pd.DataFrame, atr_14: float) -> dict:
    """
    Returns momentum metrics for the given OHLC DataFrame.

    atr_regime    → "expanding" / "normal" / "contracting"
    body_ratio    → avg candle body / ATR-14 over last 10 bars (0.0–2.0+)
                    high = candles are using their range with conviction
                    low  = compression / indecision
    impulse_ratio → bull body fraction 0.0–1.0 over last 20 bars
                    >0.55 = bull bodies dominating
                    <0.45 = bear bodies dominating
                    0.45–0.55 = balanced
    """
    if len(df) < 20 or atr_14 <= 0:
        return {
            "atr_regime":    "unknown",
            "body_ratio":    0.0,
            "impulse_ratio": 0.5,
        }

    high  = df["high"].values
    low   = df["low"].values
    close = df["close"].values
    open_ = df["open"].values

    # ── ATR regime ────────────────────────────────────────────────────
    # Compare average range of last 14 bars vs previous 14 bars
    recent_ranges = (high - low)[-14:]
    older_ranges  = (high - low)[-28:-14]

    recent_avg = float(recent_ranges.mean())
    older_avg  = float(older_ranges.mean()) if len(older_ranges) >= 7 else recent_avg

    ratio = recent_avg / older_avg if older_avg > 0 else 1.0
    if ratio >= _ATR_EXPANDING:
        atr_regime = "expanding"
    elif ratio <= _ATR_CONTRACTING:
        atr_regime = "contracting"
    else:
        atr_regime = "normal"

    # ── Body ratio ────────────────────────────────────────────────────
    # How much of the ATR are candles actually closing through?
    bodies_10 = np.abs(close - open_)[-10:]
    body_ratio = round(float(bodies_10.mean()) / atr_14, 2)
    body_ratio = min(body_ratio, 2.0)  # cap for display sanity

    # ── Impulse ratio ─────────────────────────────────────────────────
    # Bull body fraction — who is winning on candle body size?
    bodies_20  = np.abs(close - open_)[-20:]
    is_bull_20 = (close >= open_)[-20:]

    bull_bodies = bodies_20[is_bull_20]
    bear_bodies = bodies_20[~is_bull_20]

    bull_avg = float(bull_bodies.sum())
    bear_avg = float(bear_bodies.sum())

    total = bull_avg + bear_avg
    impulse_ratio = round(bull_avg / total, 2) if total > 0 else 0.5

    return {
        "atr_regime":    atr_regime,
        "body_ratio":    body_ratio,
        "impulse_ratio": impulse_ratio,
    }