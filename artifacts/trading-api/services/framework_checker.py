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
    # Proximity expressed as fraction of current_price.
    # BTC and Gold need much larger windows because their pip is tiny vs price.
    if current_price > 10_000:   # BTC
        proximity = 0.03 if is_d1 else 0.015   # 3% / 1.5% of price (~$1950 / $975)
    elif current_price > 500:    # Gold
        proximity = 0.015 if is_d1 else 0.008  # 1.5% / 0.8% of price (~$35 / $19)
    else:                        # FX and JPY — original formula
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

def compute_framework_status(
    symbol: str,
    r4h: dict,
    r1h: dict,
    r15m: dict,
    r5m: dict,
    broker_ts: int = 0,
    sr_levels: list | None = None,
    news_blocked: bool = False,
) -> dict:
    """
    Evaluate whether a limit-order framework setup is ready.
    Returns {"limit_ready": bool, "limit_rr": float, "reason": str}
    """
    try:
        trend_4h  = (r4h.get("trend")  or {}).get("trend",  "neutral")
        trend_1h  = (r1h.get("trend")  or {}).get("trend",  "neutral")
        trend_15m = (r15m.get("trend") or {}).get("trend",  "neutral")

        # Must have at least 2 timeframes aligned
        directions = [trend_4h, trend_1h, trend_15m]
        bull = directions.count("bullish")
        bear = directions.count("bearish")
        aligned_count = max(bull, bear)
        if aligned_count < 2:
            return {"limit_ready": False, "limit_rr": 0.0, "reason": "No multi-TF alignment"}

        direction = "bullish" if bull >= bear else "bearish"

        if news_blocked:
            return {"limit_ready": False, "limit_rr": 0.0, "reason": "News block active"}

        # Need a recent CHoCH on 15M in the aligned direction
        choch_15m = r15m.get("choch") or []
        import time as _time
        now = broker_ts or int(_time.time())
        recent_choch = any(
            c.get("direction") == direction and now - c.get("time", 0) <= 4 * 3600
            for c in choch_15m
        )
        if not recent_choch:
            return {"limit_ready": False, "limit_rr": 0.0, "reason": "No recent 15M CHoCH"}

        # Need an OB on 1H in the aligned direction
        df_1h = r1h.get("df")
        if df_1h is None or len(df_1h) < 10:
            return {"limit_ready": False, "limit_rr": 0.0, "reason": "No 1H data"}

        current_price = float(df_1h["close"].iloc[-1])
        pip = _pip(current_price)

        candles = []
        for _, row in df_1h.iterrows():
            candles.append({
                "time":  int(row["time"].value // 10**9) if hasattr(row["time"], "value") else int(row["time"]),
                "open":  float(row["open"]),
                "high":  float(row["high"]),
                "low":   float(row["low"]),
                "close": float(row["close"]),
            })

        obs = detect_order_blocks(candles, current_price, "1h")
        ob  = next((o for o in obs if o["type"] == direction), None)
        if not ob:
            return {"limit_ready": False, "limit_rr": 0.0, "reason": "No 1H OB in aligned direction"}

        entry = (ob["top"] + ob["bottom"]) / 2
        # SL below OB for bullish, above for bearish
        sl_dist = 15 * pip
        sl = (ob["bottom"] - sl_dist) if direction == "bullish" else (ob["top"] + sl_dist)

        # TP: nearest opposing S/R level
        tp = None
        for lvl in (sr_levels or []):
            p = lvl.get("price", 0)
            if direction == "bullish" and p > entry:
                if tp is None or p < tp:
                    tp = p
            elif direction == "bearish" and p < entry:
                if tp is None or p > tp:
                    tp = p

        if tp is None:
            tp = entry + 50 * pip if direction == "bullish" else entry - 50 * pip

        risk   = abs(entry - sl)
        reward = abs(tp - entry)
        rr     = round(reward / risk, 1) if risk > 0 else 0.0

        if rr < 1.5:
            return {"limit_ready": False, "limit_rr": rr, "reason": f"R:R {rr} too low"}

        return {
            "limit_ready": True,
            "limit_rr":    rr,
            "reason":      f"{aligned_count}/3 TF aligned {direction}, 1H OB present, R:R {rr}",
        }

    except Exception as e:
        return {"limit_ready": False, "limit_rr": 0.0, "reason": f"Error: {e}"}