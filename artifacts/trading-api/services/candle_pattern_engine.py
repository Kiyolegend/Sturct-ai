"""
Candle Pattern Engine.

Detects a small set of high-value price-action patterns — but ONLY when they
occur AT a meaningful structural location (a swing point or a supply/demand
zone edge). A pattern forming in open air, away from any structural level, is
not returned. This is deliberate: it is the difference between a signal and
noise. Every pattern reports a direction so callers never have to guess
whether "engulfing" means buy or sell.

Patterns detected:
  pin_bar_rejection   — long wick (>=2x body) rejecting a level, closes opposite the wick
  engulfing           — full-body reversal candle engulfing the prior candle
  liquidity_sweep     — wick pierces a level, candle closes back on the other side (fakey)
  displacement        — unusually large body breaking through a level with momentum
  inside_bar          — range compression sitting at a level (continuation signal only)

Deliberately NOT detected: plain doji, isolated hammer/hanging man, harami,
morning/evening star — these are either redundant with pin_bar_rejection once
you require structural context, or too rare/ambiguous to act on reliably.
"""

from __future__ import annotations
import pandas as pd


from services.pip_utils import pip_size as _pip_size


def _body(row) -> float:
    return abs(row["close"] - row["open"])


def _range(row) -> float:
    return row["high"] - row["low"]


def _upper_wick(row) -> float:
    return row["high"] - max(row["close"], row["open"])


def _lower_wick(row) -> float:
    return min(row["close"], row["open"]) - row["low"]


def _collect_levels(swings: list[dict], zones: list[dict]) -> list[float]:
    """Flatten swing prices + zone edges into one list of reference levels."""
    levels: list[float] = [s["price"] for s in (swings or [])]
    for z in zones or []:
        levels.append(z["top"])
        levels.append(z["bottom"])
    return levels

def _collect_high_levels(swings: list[dict], zones: list[dict]) -> list[float]:
    """Supply levels only — swing highs + supply zone tops. For bearish sweeps."""
    lvls: list[float] = [s["price"] for s in (swings or []) if s.get("kind") == "high"]
    for z in (zones or []):
        if z.get("kind") == "supply":
            lvls.append(z["top"])
    return lvls


def _collect_low_levels(swings: list[dict], zones: list[dict]) -> list[float]:
    """Demand levels only — swing lows + demand zone bottoms. For bullish sweeps."""
    lvls: list[float] = [s["price"] for s in (swings or []) if s.get("kind") == "low"]
    for z in (zones or []):
        if z.get("kind") == "demand":
            lvls.append(z["bottom"])
    return lvls


def _touches_any_level(row, levels: list[float], tolerance: float) -> bool:
    return any(lvl - tolerance <= row["high"] and lvl + tolerance >= row["low"] for lvl in levels)


def detect_candle_patterns(
    df: pd.DataFrame,
    swings: list[dict],
    zones: list[dict] | None = None,
    lookback: int = 6,
    proximity_pips: float = 6.0,
) -> list[dict]:
    """
    Scans the last `lookback` closed candles. Returns a list of pattern dicts,
    newest first, capped at 10. Each dict:
      {time, index, pattern, direction, price, context}
    """
    if df is None or len(df) < lookback + 2:
        return []

    current_price = float(df["close"].iloc[-1])
    pip = _pip_size(current_price)
    tolerance = proximity_pips * pip

    levels = _collect_levels(swings, zones or [])
    if not levels:
        return []
    high_levels = _collect_high_levels(swings, zones or [])
    low_levels  = _collect_low_levels(swings, zones or [])

    window = df.tail(lookback + 1).reset_index(drop=True)
    results: list[dict] = []

    for i in range(1, len(window)):
        row, prev = window.iloc[i], window.iloc[i - 1]
        rng = _range(row)
        if rng <= 0 or not _touches_any_level(row, levels, tolerance):
            continue

        body = _body(row)
        upper_wick, lower_wick = _upper_wick(row), _lower_wick(row)
        is_bull, is_bear = row["close"] > row["open"], row["close"] < row["open"]
        time_val = int(pd.Timestamp(row["time"]).timestamp())

        # 1) Rejection / pin bar
        if body > 0 and lower_wick >= 2 * body and lower_wick > upper_wick and is_bull:
            results.append({"time": time_val, "index": i, "pattern": "pin_bar_rejection",
                             "direction": "bullish", "price": float(row["low"]),
                             "context": "Long lower wick rejected a structural level; closed bullish."})
        elif body > 0 and upper_wick >= 2 * body and upper_wick > lower_wick and is_bear:
            results.append({"time": time_val, "index": i, "pattern": "pin_bar_rejection",
                             "direction": "bearish", "price": float(row["high"]),
                             "context": "Long upper wick rejected a structural level; closed bearish."})

        # 2) Engulfing
        prev_top, prev_bottom = max(prev["open"], prev["close"]), min(prev["open"], prev["close"])
        if is_bull and prev["close"] < prev["open"] and row["close"] > prev_top and row["open"] < prev_bottom:
            results.append({"time": time_val, "index": i, "pattern": "engulfing",
                             "direction": "bullish", "price": float(row["close"]),
                             "context": "Bullish candle engulfed the prior bearish candle at a level."})
        elif is_bear and prev["close"] > prev["open"] and row["close"] < prev_bottom and row["open"] > prev_top:
            results.append({"time": time_val, "index": i, "pattern": "engulfing",
                             "direction": "bearish", "price": float(row["close"]),
                             "context": "Bearish candle engulfed the prior bullish candle at a level."})

        # 3) Liquidity sweep / fakey — zone-kind aware (BUG-027)
        if high_levels and any(row["high"] > lvl + tolerance and row["close"] < lvl for lvl in high_levels):
            results.append({"time": time_val, "index": i, "pattern": "liquidity_sweep",
                             "direction": "bearish", "price": float(row["high"]),
                             "context": "Wick swept above a supply level and closed back below it — liquidity grab."})
        if low_levels and any(row["low"] < lvl - tolerance and row["close"] > lvl for lvl in low_levels):
            results.append({"time": time_val, "index": i, "pattern": "liquidity_sweep",
                             "direction": "bullish", "price": float(row["low"]),
                             "context": "Wick swept below a demand level and closed back above it — liquidity grab."})

        # 4) Displacement
        recent = [_range(window.iloc[j]) for j in range(max(0, i - 5), i)]
        avg_range = (sum(recent) / len(recent)) if recent else rng
        close_near_high = (row["high"] - row["close"]) <= 0.15 * rng
        close_near_low = (row["close"] - row["low"]) <= 0.15 * rng
        if avg_range > 0 and body >= 1.8 * avg_range:
            if is_bull and close_near_high:
                results.append({"time": time_val, "index": i, "pattern": "displacement",
                                 "direction": "bullish", "price": float(row["close"]),
                                 "context": "Large-bodied candle broke through a level with strong momentum."})
            elif is_bear and close_near_low:
                results.append({"time": time_val, "index": i, "pattern": "displacement",
                                 "direction": "bearish", "price": float(row["close"]),
                                 "context": "Large-bodied candle broke through a level with strong momentum."})

    # 5) Inside bar — only checked on the LAST closed candle, direction-agnostic
    last, prior = window.iloc[-1], window.iloc[-2]
    if last["high"] <= prior["high"] and last["low"] >= prior["low"] and _touches_any_level(last, levels, tolerance):
        results.append({"time": int(pd.Timestamp(last["time"]).timestamp()), "index": len(window) - 1,
                         "pattern": "inside_bar", "direction": "neutral", "price": float(last["close"]),
                         "context": "Range compression at a structural level — often precedes a breakout."})

    results.sort(key=lambda r: r["time"], reverse=True)
    return results[:10]