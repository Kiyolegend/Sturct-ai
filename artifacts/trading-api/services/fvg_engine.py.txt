"""
FVG Engine — Fair Value Gap detection for the confluence layer.

Mirrors detectFVGs() in TradingChart.tsx with improvements:
  - 50% mitigation threshold (midpoint fill, not full bottom edge)
  - Displacement filter (middle candle must be >= 1.2x avg range)

Returns ALL unmitigated FVGs within proximity so the confluence
engine can cross-reference every confluence hit price against the
full set — not capped at 1+1 like the chart rendering version.
"""
from .pip_utils import pip_size as _pip_size


def detect_fvgs(
    df,
    timeframe: str = "1h",
    current_price: float | None = None,
) -> list[dict]:
    """
    Detect unmitigated Fair Value Gaps from an OHLC DataFrame.

    Parameters
    ----------
    df            : OHLC DataFrame with open, high, low, close columns
    timeframe     : "5m", "15m", "1h", "4h", "d1", "w1"
    current_price : latest close (pip sizing + proximity filter)

    Returns
    -------
    list of {type, top, bottom, timeframe}
    type is "bullish" or "bearish"
    """
    if df is None or len(df) < 3:
        return []

    if current_price is None:
        current_price = float(df["close"].iloc[-1])

    pip     = _pip_size(current_price)
    is_high = timeframe in ("d1", "w1")
    min_gap   = (10 if is_high else 3) * pip
    proximity = (
        min(0.02, 400 * pip / current_price) if is_high
        else min(0.01, 100 * pip / current_price)
    )

    candles = df.reset_index(drop=True)
    n       = len(candles)
    results = []

    for i in range(1, n - 1):
        prev = candles.iloc[i - 1]
        mid  = candles.iloc[i]
        nxt  = candles.iloc[i + 1]

        # Displacement filter — middle candle must be impulsive
        lookback = candles.iloc[max(0, i - 8):i]
        if len(lookback) > 0:
            avg_rng = float((lookback["high"] - lookback["low"]).mean())
            mid_rng = float(mid["high"] - mid["low"])
            if avg_rng > 0 and mid_rng < 1.2 * avg_rng:
                continue

        # ── Bullish FVG: prev.high < next.low ──────────────────────────────
        b_top    = float(nxt["low"])
        b_bottom = float(prev["high"])
        if b_top > b_bottom and (b_top - b_bottom) >= min_gap:
            center = (b_top + b_bottom) / 2
            dist   = abs(center - current_price) / current_price
            if dist <= proximity:
                midpoint  = b_bottom + (b_top - b_bottom) * 0.5
                future    = candles.iloc[i + 2:]
                mitigated = len(future) > 0 and bool((future["close"] <= midpoint).any())
                if not mitigated:
                    results.append({
                        "type":      "bullish",
                        "top":       round(b_top,    5),
                        "bottom":    round(b_bottom, 5),
                        "timeframe": timeframe,
                    })

        # ── Bearish FVG: prev.low > next.high ──────────────────────────────
        d_top    = float(prev["low"])
        d_bottom = float(nxt["high"])
        if d_top > d_bottom and (d_top - d_bottom) >= min_gap:
            center = (d_top + d_bottom) / 2
            dist   = abs(center - current_price) / current_price
            if dist <= proximity:
                midpoint  = d_top - (d_top - d_bottom) * 0.5
                future    = candles.iloc[i + 2:]
                mitigated = len(future) > 0 and bool((future["close"] >= midpoint).any())
                if not mitigated:
                    results.append({
                        "type":      "bearish",
                        "top":       round(d_top,    5),
                        "bottom":    round(d_bottom, 5),
                        "timeframe": timeframe,
                    })

    return results