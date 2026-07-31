"""
framework_checker.py
Order Block detection + pip helper for the Auto Trade Engine.
Logic mirrors detectOrderBlocks() in TradingChart.tsx.
Works for all pairs — JPY and non-JPY detected automatically from price.
"""
from __future__ import annotations

import logging
from services.pip_utils import pip_size as _pip


def detect_order_blocks(
    candles: list[dict],
    current_price: float,
    timeframe: str = "1h",
    structural_breaks: list[dict] | None = None,
) -> list[dict]:
    """
    Detect Order Blocks from a list of OHLC candle dicts.

    Args:
        candles       — list of {open, high, low, close, time}
        current_price — latest close (used for pip size + proximity filter)
        timeframe     — "5m", "15m", "1h", "4h", "d1", "w1"

    Returns:
        list of {type, top, bottom, time}
        at most 1 bullish OB (below price) + 1 bearish OB (above price)
    """
    n = len(candles)
    if n < 10:
        return []

    pip = _pip(current_price)
    is_d1 = timeframe in ("d1", "w1")

    # Minimum candle body size to qualify as an OB — scaled per asset class.
    # Flat 5× pip is meaningless for Gold ($0.50) and BTC ($5); use real dollar floors.
    if current_price > 10_000:     # BTC
        min_size = 500 * pip if is_d1 else 100 * pip   # $500 D1 / $100 intraday
    elif current_price > 500:      # Gold
        min_size = 150 * pip if is_d1 else 30 * pip    # $15 D1 / $3 intraday
    else:                          # FX + JPY — unchanged
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

        # NaN guard — skip candles with missing/corrupt OHLC data from MT5
        if any(v != v for v in (c.get("open", 0.0), c.get("high", 0.0),
                                 c.get("low", 0.0), c.get("close", 0.0))):
            logging.warning(
                f"detect_order_blocks: NaN candle skipped at time={c.get('time', '?')}"
            )
            continue

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
            # First candle that closes above the OB high — causally correct.
            # (replaces max(next_bars) which falsely credits later news spikes)
            brk = next((x for x in next_bars if x["close"] > c["high"]), None)
            if brk is not None and (brk["high"] - brk["low"]) >= 1.5 * avg_range:
                centre = (c["high"] + c["low"]) / 2
                if abs(centre - current_price) / current_price <= proximity:
                    # BOS gate: only accept if a bullish structural break
                    # (BOS or CHoCH) occurred at or after this OB candle.
                    # When structural_breaks is None, gate is skipped (backward-compatible).
                    if structural_breaks is not None:
                        has_sb = any(
                            sb.get("direction") == "bullish"
                            and sb.get("time", 0) >= c.get("time", 0)
                            for sb in structural_breaks
                        )
                        if not has_sb:
                            continue
                    # Mitigated = price already closed back below the OB low
                    mit_buf = 100 * pip if current_price > 10_000 else 20 * pip if current_price > 500 else 2 * pip
                    mitigated = any(
                        fc["close"] < c["low"] - mit_buf
                        for fc in candles[i + 1:]
                    )
                    if not mitigated:
                        # Close-inside touch count — body acceptance, not wick sweeps
                        touches = sum(
                            1 for fc in candles[i + 1:]
                            if c["low"] <= fc["close"] <= c["high"]
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
            # First candle that closes below the OB low — causally correct.
            brk = next((x for x in next_bars if x["close"] < c["low"]), None)
            if brk is not None and (brk["high"] - brk["low"]) >= 1.5 * avg_range:
                centre = (c["high"] + c["low"]) / 2
                if abs(centre - current_price) / current_price <= proximity:
                    # BOS gate: only accept if a bearish structural break
                    # (BOS or CHoCH) occurred at or after this OB candle.
                    if structural_breaks is not None:
                        has_sb = any(
                            sb.get("direction") == "bearish"
                            and sb.get("time", 0) >= c.get("time", 0)
                            for sb in structural_breaks
                        )
                        if not has_sb:
                            continue
                    mit_buf = 100 * pip if current_price > 10_000 else 20 * pip if current_price > 500 else 2 * pip
                    mitigated = any(
                        fc["close"] > c["high"] + mit_buf
                        for fc in candles[i + 1:]
                    )
                    if not mitigated:
                        # Close-inside touch count — body acceptance, not wick sweeps
                        touches = sum(
                            1 for fc in candles[i + 1:]
                            if c["low"] <= fc["close"] <= c["high"]
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
        if current_price > 10_000:   # BTC — SL at least $300 below/above OB edge
            sl_dist = max(300 * pip, 0.008 * current_price)
        elif current_price > 500:    # Gold — SL at least $5 below/above OB edge
            sl_dist = max(50 * pip, 0.003 * current_price)
        else:                        # FX — original 15 pip
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
            if current_price > 10_000:
                fallback_dist = 1000 * pip   # BTC ~$1000 fallback TP
            elif current_price > 500:
                fallback_dist = 150 * pip    # Gold ~$15 fallback TP
            else:
                fallback_dist = 50 * pip     # FX unchanged
            tp = entry + fallback_dist if direction == "bullish" else entry - fallback_dist

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