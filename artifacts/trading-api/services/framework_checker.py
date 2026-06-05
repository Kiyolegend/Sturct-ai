"""
Framework Checker — computes scalp_ready / limit_ready for all pairs.

Ports the FrameworkPanel.tsx logic to Python so the backend can evaluate
all 5 pairs at once and return a compact status dict.

This is the source-of-truth for the notification system:
  scalp_ready and limit_ready match the exact same conditions as
  FrameworkPanel.tsx to prevent false positives / missed alerts.
"""
from __future__ import annotations
from typing import Optional


def _pip(price: float) -> float:
    return 0.01 if price > 50 else 0.0001


# ── Port of detectOrderBlocks() from TradingChart.tsx ─────────────────────────

def detect_order_blocks(candles: list[dict], current_price: float) -> list[dict]:
    n = len(candles)
    if n < 10 or not current_price:
        return []
    pip = _pip(current_price)
    min_size = 5 * pip
    proximity = min(0.015, (60 * pip) / current_price)
    results: list[dict] = []

    for i in range(1, n - 3):
        c = candles[i]
        lookback = candles[max(0, i - 10):i]
        avg_range = (sum(x["high"] - x["low"] for x in lookback) / len(lookback)) if lookback else 0

        # Bullish OB: bearish candle followed by impulsive bullish displacement
        if c["close"] < c["open"]:
            slice_ = candles[i + 1: min(i + 6, n)]
            if not slice_:
                continue
            future_high = max(x["close"] for x in slice_)
            if future_high > c["high"] and c["high"] - c["low"] >= min_size:
                break_c = max(slice_, key=lambda x: x["high"] - x["low"])
                if avg_range > 0 and (break_c["high"] - break_c["low"]) >= 1.5 * avg_range:
                    center = (c["high"] + c["low"]) / 2
                    dist = abs(center - current_price) / current_price
                    if dist <= proximity:
                        mitigated = any(fc["close"] < c["low"] - 2 * pip for fc in candles[i + 1:])
                        if not mitigated:
                            results.append({"type": "bullish", "top": c["high"], "bottom": c["low"],
                                            "dist": dist, "time": c.get("time", 0)})

        # Bearish OB: bullish candle followed by impulsive bearish displacement
        if c["close"] > c["open"]:
            slice_ = candles[i + 1: min(i + 6, n)]
            if not slice_:
                continue
            future_low = min(x["close"] for x in slice_)
            if future_low < c["low"] and c["high"] - c["low"] >= min_size:
                break_c = max(slice_, key=lambda x: x["high"] - x["low"])
                if avg_range > 0 and (break_c["high"] - break_c["low"]) >= 1.5 * avg_range:
                    center = (c["high"] + c["low"]) / 2
                    dist = abs(center - current_price) / current_price
                    if dist <= proximity:
                        mitigated = any(fc["close"] > c["high"] + 2 * pip for fc in candles[i + 1:])
                        if not mitigated:
                            results.append({"type": "bearish", "top": c["high"], "bottom": c["low"],
                                            "dist": dist, "time": c.get("time", 0)})

    bull = sorted(
        [r for r in results if r["type"] == "bullish" and (r["top"] + r["bottom"]) / 2 <= current_price],
        key=lambda x: x["dist"])[:1]
    bear = sorted(
        [r for r in results if r["type"] == "bearish" and (r["top"] + r["bottom"]) / 2 >= current_price],
        key=lambda x: x["dist"])[:1]

    return [{"type": r["type"], "top": round(r["top"], 5), "bottom": round(r["bottom"], 5),
             "time": r.get("time", 0)} for r in bull + bear]


# ── Port of detectFVGs() from TradingChart.tsx ────────────────────────────────

def detect_fvgs(candles: list[dict], current_price: float) -> list[dict]:
    n = len(candles)
    if n < 3 or not current_price:
        return []
    pip = _pip(current_price)
    min_gap = 3 * pip
    proximity = min(0.01, (100 * pip) / current_price)
    results: list[dict] = []

    for i in range(1, n - 1):
        prev = candles[i - 1]
        next_ = candles[i + 1]

        b_top, b_bottom = next_["low"], prev["high"]
        if b_top > b_bottom and b_top - b_bottom >= min_gap:
            center = (b_top + b_bottom) / 2
            dist = abs(center - current_price) / current_price
            if dist <= proximity:
                mitigated = any(c["close"] <= b_bottom for c in candles[i + 2:])
                if not mitigated:
                    results.append({"type": "bullish", "top": b_top, "bottom": b_bottom, "dist": dist})

        d_top, d_bottom = prev["low"], next_["high"]
        if d_top > d_bottom and d_top - d_bottom >= min_gap:
            center = (d_top + d_bottom) / 2
            dist = abs(center - current_price) / current_price
            if dist <= proximity:
                mitigated = any(c["close"] >= d_top for c in candles[i + 2:])
                if not mitigated:
                    results.append({"type": "bearish", "top": d_top, "bottom": d_bottom, "dist": dist})

    bull = sorted(
        [r for r in results if r["type"] == "bullish" and (r["top"] + r["bottom"]) / 2 <= current_price],
        key=lambda x: x["dist"])[:1]
    bear = sorted(
        [r for r in results if r["type"] == "bearish" and (r["top"] + r["bottom"]) / 2 >= current_price],
        key=lambda x: x["dist"])[:1]

    return [{"type": r["type"], "top": round(r["top"], 5), "bottom": round(r["bottom"], 5)}
            for r in bull + bear]


# ── Phase logic (port of phaseInfo() from FrameworkPanel.tsx) ─────────────────

def _phase_good(bias_4h: str, bias_1h: str, bias_15m: str) -> bool:
    if bias_4h == "neutral":
        return False
    opp = "bearish" if bias_4h == "bullish" else "bullish"
    if bias_1h == bias_4h and (bias_15m == opp or bias_15m == "neutral"):
        return True
    if (bias_1h == opp or bias_1h == "neutral") and bias_15m == bias_4h:
        return True
    return False


# ── DataFrame → candle list ────────────────────────────────────────────────────

def _df_to_candles(df) -> list[dict]:
    if df is None or len(df) == 0:
        return []
    try:
        rows = []
        for _, row in df.iterrows():
            t = row["time"]
            rows.append({
                "time":  int(t.timestamp()) if hasattr(t, "timestamp") else int(t),
                "open":  float(row["open"]),
                "high":  float(row["high"]),
                "low":   float(row["low"]),
                "close": float(row["close"]),
            })
        return rows
    except Exception:
        return []


# ── Core framework status computer ────────────────────────────────────────────

def compute_framework_status(
    symbol:       str,
    r4h:          dict,
    r1h:          dict,
    r15m:         dict,
    r5m:          dict,
    broker_ts:    int,
    sr_levels:    list[dict],
    news_blocked: bool,
) -> dict:
    """
    Compute scalp_ready and limit_ready for one symbol.
    Matches FrameworkPanel.tsx logic exactly.
    """
    current_price = (
        r5m.get("price") or r15m.get("price") or
        r1h.get("price") or r4h.get("price") or 0.0
    )
    if not current_price:
        return {"scalp_ready": False, "limit_ready": False, "error": "no data"}

    pip = _pip(current_price)

    bias_4h  = (r4h.get("trend")  or {}).get("trend",  "neutral")
    bias_1h  = (r1h.get("trend")  or {}).get("trend",  "neutral")
    bias_15m = (r15m.get("trend") or {}).get("trend",  "neutral")

    has_dir = bias_4h != "neutral"
    is_bull = bias_4h == "bullish"
    direction = bias_4h
    phase_ok = _phase_good(bias_4h, bias_1h, bias_15m)

    # ── 1H OBs / FVGs / zones ─────────────────────────────────────────────────
    ob1h = fvg1h = zone1h = None
    candles_1h = _df_to_candles(r1h.get("df"))
    if candles_1h:
        obs = detect_order_blocks(candles_1h, current_price)
        ob1h = next((o for o in obs if o["type"] == direction), None)
        fvgs = detect_fvgs(candles_1h, current_price)
        fvg1h = next((f for f in fvgs if f["type"] == direction), None)

    zones_1h = r1h.get("zones") or []
    max_dist = 80 * pip
    nearby: list[dict] = []
    for z in zones_1h:
        center = (z.get("top", 0) + z.get("bottom", 0)) / 2
        in_dir = (is_bull and center < current_price) or (not is_bull and center > current_price)
        if in_dir and abs(center - current_price) <= max_dist:
            nearby.append(z)
    if nearby:
        zone1h = min(nearby, key=lambda z: abs((z["top"] + z["bottom"]) / 2 - current_price))

    has_1h_zone = ob1h is not None or fvg1h is not None or zone1h is not None

    # ── 15M OBs / FVGs (for limit mode) ──────────────────────────────────────
    ob15m = fvg15m = None
    candles_15m = _df_to_candles(r15m.get("df"))
    if candles_15m:
        obs15 = detect_order_blocks(candles_15m, current_price)
        ob15m  = next((o for o in obs15 if o["type"] == direction), None)
        fvgs15 = detect_fvgs(candles_15m, current_price)
        fvg15m = next((f for f in fvgs15 if f["type"] == direction), None)

    # Fix #4 — Per-zone overlap: 15M must align with a specific 1H zone, not a merged box
    def _overlaps(a: dict, b: dict) -> bool:
        return a["top"] >= b["bottom"] and a["bottom"] <= b["top"]

    _1h_zones = [z for z in [ob1h, fvg1h, zone1h] if z is not None]
    ob15m_in_zone  = ob15m  is not None and any(_overlaps(ob15m,  h) for h in _1h_zones)
    fvg15m_in_zone = fvg15m is not None and any(_overlaps(fvg15m, h) for h in _1h_zones)

    # ── Recency-filtered CHoCH / BOS ──────────────────────────────────────────
    choch_15m_list = [
        c for c in (r15m.get("choch") or [])
        if c.get("direction") == direction and c.get("time", 0) >= broker_ts - 3 * 3600
    ]
    choch_15m = max(choch_15m_list, key=lambda c: c["time"]) if choch_15m_list else None

    bos_15m_list = [
        b for b in (r15m.get("bos") or [])
        if b.get("direction") == direction and b.get("time", 0) >= broker_ts - 2 * 3600
    ]
    bos_15m = max(bos_15m_list, key=lambda b: b["time"]) if bos_15m_list else None

    bos_5m_list = [
        b for b in (r5m.get("bos") or [])
        if b.get("direction") == direction and b.get("time", 0) >= broker_ts - 45 * 60
    ]
    bos_5m = max(bos_5m_list, key=lambda b: b["time"]) if bos_5m_list else None

    has_15m_confirm = choch_15m is not None or bos_15m is not None
    has_5m_trigger  = bos_5m is not None

    # ── Scalp invalidation guards ─────────────────────────────────────────────
    scalp_drift   = round(abs(current_price - bos_5m["price"]) / pip) if bos_5m else 0
    scalp_chasing = scalp_drift > 20

    # ── sl5m from 5M structure labels ─────────────────────────────────────────
    sl5m: Optional[float] = None
    try:
        labels_5m = r5m.get("structure_labels") or []
        if is_bull:
            candidates = [s for s in labels_5m if s.get("label") in ("HL", "EQL", "LL")]
        else:
            candidates = [s for s in labels_5m if s.get("label") in ("LH", "EQH", "HH")]
        if candidates:
            sl5m = float(candidates[-1]["price"])
    except Exception:
        sl5m = None

    # ── sl15m from 15M structure labels (FrameworkPanel.tsx slLow / slHigh) ───
    sl15m: Optional[float] = None
    try:
        labels_15m = r15m.get("structure_labels") or []
        if is_bull:
            cands_15m = [s for s in labels_15m if s.get("label") in ("HL", "EQL", "LL")]
        else:
            cands_15m = [s for s in labels_15m if s.get("label") in ("LH", "EQH", "HH")]
        if cands_15m:
            sl15m = float(cands_15m[-1]["price"])
    except Exception:
        sl15m = None

    # ── Retrace % gate (38–70% of last 4H swing) ─────────────────────────────
    trend_4h  = r4h.get("trend") or {}
    hi_price  = trend_4h.get("last_high_price")
    lo_price  = trend_4h.get("last_low_price")
    retrace_gate = True  # default: pass when data unavailable
    if hi_price and lo_price and current_price and has_dir:
        leg_size = hi_price - lo_price
        if leg_size > 0:
            raw_pct = (
                ((hi_price - current_price) / leg_size * 100) if is_bull
                else ((current_price - lo_price) / leg_size * 100)
            )
            retrace_pct = round(raw_pct)
            retrace_gate = 38 <= retrace_pct <= 70

    # ── Setup (entry / SL / TP / RR) ─────────────────────────────────────────
    def _setup(mode: str) -> dict:
        zone = (ob1h or fvg1h or zone1h) if mode == "limit" else None
        zone_width = (zone["top"] - zone["bottom"]) if zone else 0
        entry_p = (
            (zone["bottom"] + zone_width * 0.30 if is_bull else zone["top"] - zone_width * 0.30)
            if zone else current_price
        )

        if mode == "limit" and zone:
            zone15 = ob15m or fvg15m
            sl_buffer = max(10 * pip, zone_width * 0.25)
            sl_1h  = (zone["bottom"] - sl_buffer) if is_bull else (zone["top"] + sl_buffer)
            if zone15:
                sl_15m = (zone15["bottom"] - 5 * pip) if is_bull else (zone15["top"] + 5 * pip)
                sl_p = min(sl_1h, sl_15m) if is_bull else max(sl_1h, sl_15m)
            else:
                sl_p = sl_1h
        else:
            if sl5m is not None:
                sl_p = (sl5m - 3 * pip) if is_bull else (sl5m + 3 * pip)
            elif sl15m is not None:
                sl_p = (sl15m - 3 * pip) if is_bull else (sl15m + 3 * pip)
            else:
                sl_p = (entry_p - 20 * pip) if is_bull else (entry_p + 20 * pip)

            if is_bull  and sl_p >= entry_p: sl_p = entry_p - 20 * pip
            if not is_bull and sl_p <= entry_p: sl_p = entry_p + 20 * pip

            zc = ob1h or fvg1h or zone1h
            if zc:
                if is_bull  and sl_p > zc["bottom"]: sl_p = zc["bottom"] - 3 * pip
                if not is_bull and sl_p < zc["top"]:  sl_p = zc["top"]   + 3 * pip

        sr_f = [l for l in sr_levels if l.get("timeframe") != "15m"]
        if is_bull:
            tp_cands = sorted(
                [l for l in sr_f if l.get("kind") == "resistance" and l["price"] > entry_p],
                key=lambda l: l["price"])
        else:
            tp_cands = sorted(
                [l for l in sr_f if l.get("kind") == "support" and l["price"] < entry_p],
                key=lambda l: -l["price"])
        # NEW — Fibonacci extension fallback
if hi_price and lo_price and hi_price > lo_price:
    fib_range = hi_price - lo_price
    ext_127 = (hi_price + 0.272 * fib_range) if is_bull else (lo_price - 0.272 * fib_range)
    ext_162 = (hi_price + 0.618 * fib_range) if is_bull else (lo_price - 0.618 * fib_range)
    fib_tp = ext_127 if mode == "scalp" else ext_162
else:
    fb_pips = 60 if "JPY" in symbol else (40 if ("GBP" in symbol or "EUR" in symbol) else 30)
    fib_tp = entry_p + fb_pips * pip if is_bull else entry_p - fb_pips * pip
tp_p = tp_cands[0]["price"] if tp_cands else fib_tp

        risk   = abs(entry_p - sl_p)
        reward = abs(tp_p - entry_p)
        rr     = round(reward / risk, 1) if risk > 0 else 0.0
        return {"entry": round(entry_p, 5), "sl": round(sl_p, 5), "tp": round(tp_p, 5), "rr": rr}

    scalp_setup = _setup("scalp")
    limit_setup = _setup("limit")

    scalp_tp_hit = (
        (current_price >= scalp_setup["tp"]) if is_bull else (current_price <= scalp_setup["tp"])
    )
    scalp_signal_ok = not scalp_chasing and not scalp_tp_hit

    # ── Limit zone status ─────────────────────────────────────────────────────
    lz = ob1h or fvg1h or zone1h
    limit_zone_status   = "none"
    limit_zone_distance = 0
    if lz:
        if is_bull:
            if current_price < lz["bottom"] - 5 * pip:  limit_zone_status = "blown"
            elif current_price < lz["top"] + 5 * pip:   limit_zone_status = "entering"
            else:                                         limit_zone_status = "approaching"
            limit_zone_distance = round((current_price - lz["top"]) / pip)
        else:
            if current_price > lz["top"] + 5 * pip:      limit_zone_status = "blown"
            elif current_price > lz["bottom"] - 5 * pip: limit_zone_status = "entering"
            else:                                          limit_zone_status = "approaching"
            limit_zone_distance = round((lz["bottom"] - current_price) / pip)

    limit_out_of_reach = limit_zone_distance > 50

    # ── Ready flags ───────────────────────────────────────────────────────────
    scalp_ready = bool(
        has_dir and phase_ok and has_1h_zone and has_15m_confirm and
        has_5m_trigger and scalp_signal_ok and not news_blocked and
        scalp_setup["rr"] >= 2.5
    )
    limit_ready = bool(
        has_dir and phase_ok and retrace_gate and has_1h_zone and
        (ob15m_in_zone or fvg15m_in_zone) and
        limit_zone_status != "blown" and not limit_out_of_reach and
        not news_blocked and limit_setup["rr"] >= 2.5
    )

    return {
        "scalp_ready":      scalp_ready,
        "limit_ready":      limit_ready,
        "direction":        direction,
        "scalp_rr":         scalp_setup["rr"],
        "limit_rr":         limit_setup["rr"],
        "phase_good":       phase_ok,
        "has_1h_zone":      has_1h_zone,
        "has_15m_confirm":  has_15m_confirm,
        "has_5m_trigger":   has_5m_trigger,
        "news_blocked":     news_blocked,
        "price":            round(current_price, 5),
        "scalp_entry":      scalp_setup["entry"],
        "scalp_sl":         scalp_setup["sl"],
        "scalp_tp":         scalp_setup["tp"],
        "limit_entry":      limit_setup["entry"],
        "limit_sl":         limit_setup["sl"],
        "limit_tp":         limit_setup["tp"],
    }
