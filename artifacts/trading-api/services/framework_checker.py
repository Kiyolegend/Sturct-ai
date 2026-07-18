"""
framework_checker.py
Order Block detection + pip helper for the Auto Trade Engine.
Logic mirrors detectOrderBlocks() in TradingChart.tsx.
Works for all pairs — JPY and non-JPY detected automatically from price.
"""
from __future__ import annotations


def _pip(price: float) -> float:
    if price > 10_000: return 1.0
    if price > 500:    return 0.1
    if price > 50:     return 0.01
    return 0.0001


def detect_order_blocks(
    candles: list[dict],
    current_price: float,
    timeframe: str = "1h",
) -> list[dict]:
    """
    Detect Order Blocks from a list of OHLC candle dicts.

    Args:
        candles       — list of {open, high, low, close, time}
        current_price — latest close (used for pip size + proximity filter)
        timeframe     — "5m", "15m", "1h", "4h", "d1"

    Returns:
        list of {type, top, bottom, time}
        at most 1 bullish OB (below price) + 1 bearish OB (above price)
    """
    n = len(candles)
    if n < 10:
        return []

    pip = _pip(current_price)
    is_d1 = timeframe == "d1"

    # Minimum candle body size to qualify as an OB
    min_size = 20 * pip if is_d1 else 5 * pip

    # How close to current price the OB centre must be
    proximity = (
        min(0.02,  300 * pip / current_price) if is_d1
        else min(0.015, 60 * pip / current_price)
    )

    results: list[dict] = []

    for i in range(1, n - 3):
        c = candles[i]

        # Average range of the 10 bars before i (used for displacement check)
        lookback = candles[max(0, i - 10):i]
        avg_range = (
            sum(x["high"] - x["low"] for x in lookback) / len(lookback)
            if lookback else 0.0
        )
        if avg_range == 0:
            continue

        next_bars = candles[i + 1: min(i + 6, n)]
        if not next_bars:
            continue

        # ── Bullish OB ──────────────────────────────────────────────────────
        # A bearish candle (close < open) that is followed by a strong
        # bullish move that breaks above it — price may return to buy here.
        if c["close"] < c["open"] and (c["high"] - c["low"]) >= min_size:
            future_high = max(x["close"] for x in next_bars)
            if future_high > c["high"]:
                # Displacement: the break candle must be ≥1.5× average range
                brk = max(next_bars, key=lambda x: x["high"] - x["low"])
                if (brk["high"] - brk["low"]) >= 1.5 * avg_range:
                    centre = (c["high"] + c["low"]) / 2
                    if abs(centre - current_price) / current_price <= proximity:
                        # Mitigated = price already closed back below the OB low
                        mitigated = any(
                            fc["close"] < c["low"] - 2 * pip
                            for fc in candles[i + 1:]
                        )
                        if not mitigated:
                            touches = sum(
                                1 for fc in candles[i + 1:]
                                if fc["low"] <= c["high"] and fc["high"] >= c["low"]
                            )
                            results.append({
                                "type":     "bullish",
                                "top":      round(c["high"], 5),
                                "bottom":   round(c["low"],  5),
                                "time":     c.get("time", 0),
                                "strength": (brk["high"] - brk["low"]) / avg_range,
                                "touches":  touches,
                            })

        # ── Bearish OB ──────────────────────────────────────────────────────
        # A bullish candle (close > open) that is followed by a strong
        # bearish move that breaks below it — price may return to sell here.
        if c["close"] > c["open"] and (c["high"] - c["low"]) >= min_size:
            future_low = min(x["close"] for x in next_bars)
            if future_low < c["low"]:
                brk = max(next_bars, key=lambda x: x["high"] - x["low"])
                if (brk["high"] - brk["low"]) >= 1.5 * avg_range:
                    centre = (c["high"] + c["low"]) / 2
                    if abs(centre - current_price) / current_price <= proximity:
                        mitigated = any(
                            fc["close"] > c["high"] + 2 * pip
                            for fc in candles[i + 1:]
                        )
                        if not mitigated:
                            touches = sum(
                                1 for fc in candles[i + 1:]
                                if fc["low"] <= c["high"] and fc["high"] >= c["low"]
                            )
                            results.append({
                                "type":     "bearish",
                                "top":      round(c["high"], 5),
                                "bottom":   round(c["low"],  5),
                                "time":     c.get("time", 0),
                                "strength": (brk["high"] - brk["low"]) / avg_range,
                                "touches":  touches,
                            })

    # Keep the single best OB per side.
    # Prefer fresh (0 touches), then strongest displacement.
    def _best(pool: list[dict]) -> list[dict]:
        fresh  = [o for o in pool if o["touches"] == 0]
        tested = [o for o in pool if o["touches"] >  0]
        ranked = sorted(fresh or tested, key=lambda o: o["strength"], reverse=True)
        return ranked[:1]

    bull = _best([
        o for o in results
        if o["type"] == "bullish"
        and (o["top"] + o["bottom"]) / 2 <= current_price
    ])
    bear = _best([
        o for o in results
        if o["type"] == "bearish"
        and (o["top"] + o["bottom"]) / 2 >= current_price
    ])

    return [
        {"type": o["type"], "top": o["top"], "bottom": o["bottom"], "time": o["time"]}
        for o in bull + bear
    ]