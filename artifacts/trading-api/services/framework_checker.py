"""
Framework Checker — computes limit_ready for all pairs.

Ports the FrameworkPanel.tsx logic to Python so the backend can evaluate
all 5 pairs at once and return a compact status dict.

This is the source-of-truth for the notification system:
  limit_ready matches the exact same conditions as
  FrameworkPanel.tsx to prevent false positives / missed alerts.

limit_ready hard requirements (all must pass):
  1. 4H direction clear (not neutral)
  2. Valid 1H zone exists (OB or FVG or S/D zone)
  3. Zone not blown
  4. No news block active
  5. R:R >= 2.5

Bonus indicators (computed and returned, do NOT gate limit_ready):
  - phase_good          — 1H/15M in pullback phase relative to 4H
  - retrace_pct         — how far price has retraced into last 4H swing
  - has_15m_confluence  — 15M OB/FVG overlaps the 1H zone
  - zone_freshness      — 0=fresh (never tested), 1=tested once, 2+=stale

Auto-cancel signals (returned for FrameworkMonitor to act on):
  - limit_zone_status — "approaching" / "entering" / "blown" / "none"
  - HTF flip is detected in FrameworkMonitor from direction changes

Improvements (v2):
  1. Zone freshness — OBs track touch_count; fresh zones (0 touches) preferred
     over tested zones; among equals, strongest displacement wins.
  2. TP improvement — limit mode TP uses the 4H swing origin (the high/low
     price came FROM before this pullback) for maximum reward; falls back to
     S/R or Fib only when swing origin unavailable.
  3. Displacement strength scoring — OBs scored by displacement_candle / avg_range;
     strongest fresh zone chosen over nearest zone.
"""
from __future__ import annotations
from typing import Optional


def _pip(price: float) -> float:
    return 0.01 if price > 50 else 0.0001


# ── Port of detectOrderBlocks() from TradingChart.tsx ─────────────────────────
# v2 additions: touch_count (freshness) and strength_score (displacement quality)

def detect_order_blocks(candles: list[dict], current_price: float, interval: str = "1h") -> list[dict]:
    n = len(candles)
    if n < 10 or not current_price:
        return []
    pip = _pip(current_price)
    min_size  = 20 * pip  if interval == "d1" else 5 * pip
    proximity = min(0.02, (300 * pip) / current_price) if interval == "d1" else min(0.015, (60 * pip) / current_price)
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
                disp = break_c["high"] - break_c["low"]
                if avg_range > 0 and disp >= 1.5 * avg_range:
                    center = (c["high"] + c["low"]) / 2
                    dist = abs(center - current_price) / current_price
                    if dist <= proximity:
                        future = candles[i + 1:]
                        mitigated = any(fc["close"] < c["low"] - 2 * pip for fc in future)
                        if not mitigated:
                            # Count how many times price has entered the zone without mitigating
                            touch_count = sum(
                                1 for fc in future
                                if fc["low"] <= c["high"] and fc["high"] >= c["low"]
                            )
                            strength_score = disp / avg_range if avg_range > 0 else 1.0
                            results.append({
                                "type":           "bullish",
                                "top":            c["high"],
                                "bottom":         c["low"],
                                "dist":           dist,
                                "time":           c.get("time", 0),
                                "touch_count":    touch_count,
                                "strength_score": round(strength_score, 2),
                            })

        # Bearish OB: bullish candle followed by impulsive bearish displacement
        if c["close"] > c["open"]:
            slice_ = candles[i + 1: min(i + 6, n)]
            if not slice_:
                continue
            future_low = min(x["close"] for x in slice_)
            if future_low < c["low"] and c["high"] - c["low"] >= min_size:
                break_c = max(slice_, key=lambda x: x["high"] - x["low"])
                disp = break_c["high"] - break_c["low"]
                if avg_range > 0 and disp >= 1.5 * avg_range:
                    center = (c["high"] + c["low"]) / 2
                    dist = abs(center - current_price) / current_price
                    if dist <= proximity:
                        future = candles[i + 1:]
                        mitigated = any(fc["close"] > c["high"] + 2 * pip for fc in future)
                        if not mitigated:
                            touch_count = sum(
                                1 for fc in future
                                if fc["low"] <= c["high"] and fc["high"] >= c["low"]
                            )
                            strength_score = disp / avg_range if avg_range > 0 else 1.0
                            results.append({
                                "type":           "bearish",
                                "top":            c["high"],
                                "bottom":         c["low"],
                                "dist":           dist,
                                "time":           c.get("time", 0),
                                "touch_count":    touch_count,
                                "strength_score": round(strength_score, 2),
                            })

    def _best(candidates: list[dict]) -> list[dict]:
        """
        Prefer fresh zones (touch_count == 0) over tested zones.
        Among equals, prefer strongest displacement score.
        Falls back to tested zones if no fresh zones exist.
        """
        fresh  = sorted([r for r in candidates if r["touch_count"] == 0],
                        key=lambda x: -x["strength_score"])
        tested = sorted([r for r in candidates if r["touch_count"] > 0],
                        key=lambda x: -x["strength_score"])
        return (fresh or tested)[:1]

    bull_cands = [r for r in results
                  if r["type"] == "bullish" and (r["top"] + r["bottom"]) / 2 <= current_price]
    bear_cands = [r for r in results
                  if r["type"] == "bearish" and (r["top"] + r["bottom"]) / 2 >= current_price]

    chosen = _best(bull_cands) + _best(bear_cands)
    return [
        {
            "type":           r["type"],
            "top":            round(r["top"], 5),
            "bottom":         round(r["bottom"], 5),
            "time":           r.get("time", 0),
            "touch_count":    r["touch_count"],
            "strength_score": r["strength_score"],
        }
        for r in chosen
    ]


# ── Port of detectFVGs() from TradingChart.tsx ────────────────────────────────

def detect_fvgs(candles: list[dict], current_price: float, interval: str = "1h") -> list[dict]:
    n = len(candles)
    if n < 3 or not current_price:
        return []
    pip = _pip(current_price)
    min_gap   = 10 * pip if interval == "d1" else 3 * pip
    proximity = min(0.02, (400 * pip) / current_price) if interval == "d1" else min(0.01, (100 * pip) / current_price)
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
    r_d1:         dict | None = None,
) -> dict:
    """
    Compute limit_ready for one symbol.

    limit_ready fires on 4 hard conditions only:
      1. 4H direction clear
      2. Valid 1H zone
      3. Zone not blown
      4. No news block + R:R >= 2.5

    phase_good, retrace_pct, has_15m_confluence, zone_freshness are bonus
    indicators — returned in the response for display but do NOT gate the signal.

    v2: zone freshness + displacement strength drive OB selection;
        limit TP uses 4H swing origin for maximum reward.
    """
    current_price = (
        r5m.get("price") or r15m.get("price") or
        r1h.get("price") or r4h.get("price") or 0.0
    )
    if not current_price:
        return {"limit_ready": False, "error": "no data"}

    pip = _pip(current_price)

    bias_4h  = (r4h.get("trend")  or {}).get("trend",  "neutral")
    bias_1h  = (r1h.get("trend")  or {}).get("trend",  "neutral")
    bias_15m = (r15m.get("trend") or {}).get("trend",  "neutral")

    has_dir   = bias_4h != "neutral"
    is_bull   = bias_4h == "bullish"
    direction = bias_4h
    phase_ok  = _phase_good(bias_4h, bias_1h, bias_15m)

    # ── 4H swing origin (used as limit TP — the high/low price came FROM) ──────
    trend_4h = r4h.get("trend") or {}
    hi_price = trend_4h.get("last_high_price")
    lo_price = trend_4h.get("last_low_price")

    # ── 1H OBs / FVGs / zones ─────────────────────────────────────────────────
    ob1h = fvg1h = zone1h = None
    candles_1h = _df_to_candles(r1h.get("df"))
    if candles_1h:
        obs = detect_order_blocks(candles_1h, current_price)
        ob1h = next((o for o in obs if o["type"] == direction), None)
        fvgs = detect_fvgs(candles_1h, current_price)
        fvg1h = next((f for f in fvgs if f["type"] == direction), None)

    ob_d1 = fvg_d1 = None
    if r_d1:
        candles_d1 = _df_to_candles(r_d1.get("df"))
        if candles_d1:
            obs_d1  = detect_order_blocks(candles_d1, current_price, interval="d1")
            ob_d1   = next((o for o in obs_d1  if o["type"] == direction), None)
            fvgs_d1 = detect_fvgs(candles_d1, current_price, interval="d1")
            fvg_d1  = next((f for f in fvgs_d1 if f["type"] == direction), None)

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

    # Zone freshness — from OB touch_count (0 = never tested = strongest)
    zone_freshness: Optional[int] = ob1h.get("touch_count") if ob1h else None

    # ── 15M OBs / FVGs (bonus confluence indicator) ───────────────────────────
    ob15m = fvg15m = None
    candles_15m = _df_to_candles(r15m.get("df"))
    if candles_15m:
        obs15 = detect_order_blocks(candles_15m, current_price)
        ob15m  = next((o for o in obs15 if o["type"] == direction), None)
        fvgs15 = detect_fvgs(candles_15m, current_price)
        fvg15m = next((f for f in fvgs15 if f["type"] == direction), None)

    def _overlaps(a: dict, b: dict) -> bool:
        return a["top"] >= b["bottom"] and a["bottom"] <= b["top"]

    _1h_zones = [z for z in [ob1h, fvg1h, zone1h] if z is not None]
    ob15m_in_zone  = ob15m  is not None and any(_overlaps(ob15m,  h) for h in _1h_zones)
    fvg15m_in_zone = fvg15m is not None and any(_overlaps(fvg15m, h) for h in _1h_zones)

    has_15m_confluence = ob15m_in_zone or fvg15m_in_zone

    # ── sl5m from 5M structure labels ─────────────────────────────────────────
    sl5m: Optional[float] = None
    try:
        labels_5m = r5m.get("structure_labels") or []
        if is_bull:
            candidates = [s for s in labels_5m if s.get("label") in ("HL", "EQL")]
        else:
            candidates = [s for s in labels_5m if s.get("label") in ("LH", "EQH")]
        if candidates:
            sl5m = float(candidates[-1]["price"])
    except Exception:
        sl5m = None

    # ── sl15m from 15M structure labels ───────────────────────────────────────
    sl15m: Optional[float] = None
    try:
        labels_15m = r15m.get("structure_labels") or []
        if is_bull:
            cands_15m = [s for s in labels_15m if s.get("label") in ("HL", "EQL")]
        else:
            cands_15m = [s for s in labels_15m if s.get("label") in ("LH", "EQH")]
        if cands_15m:
            sl15m = float(cands_15m[-1]["price"])
    except Exception:
        sl15m = None

    # ── Retrace % (bonus indicator only — does NOT gate limit_ready) ──────────
    retrace_pct: Optional[int] = None
    if hi_price and lo_price and current_price and has_dir:
        leg_size = hi_price - lo_price
        if leg_size > 0:
            raw_pct = (
                ((hi_price - current_price) / leg_size * 100) if is_bull
                else ((current_price - lo_price) / leg_size * 100)
            )
            retrace_pct = round(raw_pct)

    # ── Setup (entry / SL / TP / RR) ──────────────────────────────────────────
    _ENTRY_DEPTH: dict[str, float] = {
        "USD/JPY": 0.65,
        "GBP/USD": 0.60,
        "EUR/USD": 0.55,
        "AUD/USD": 0.50,
        "USD/CHF": 0.50,
    }

    def _setup(mode: str) -> dict:
        zone = (ob1h or fvg1h or zone1h) if mode == "limit" else None
        zone_width = (zone["top"] - zone["bottom"]) if zone else 0
        depth = _ENTRY_DEPTH.get(symbol, 0.55)
        entry_p = (
            (zone["bottom"] + zone_width * depth if is_bull else zone["top"] - zone_width * depth)
            if zone else current_price
        )

        # ── SL ────────────────────────────────────────────────────────────────
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

        # ── TP ────────────────────────────────────────────────────────────────
        sr_f = [l for l in sr_levels if l.get("timeframe") != "15m"]
        if is_bull:
            tp_cands = sorted(
                [l for l in sr_f if l.get("kind") == "resistance" and l["price"] > entry_p],
                key=lambda l: l["price"])
        else:
            tp_cands = sorted(
                [l for l in sr_f if l.get("kind") == "support" and l["price"] < entry_p],
                key=lambda l: -l["price"])

        # Fibonacci extension fallback
        if hi_price and lo_price and hi_price > lo_price:
            fib_range = hi_price - lo_price
            ext_127 = (hi_price + 0.272 * fib_range) if is_bull else (lo_price - 0.272 * fib_range)
            ext_162 = (hi_price + 0.618 * fib_range) if is_bull else (lo_price - 0.618 * fib_range)
            fib_tp = ext_127 if mode == "scalp" else ext_162
        else:
            fb_pips = 60 if "JPY" in symbol else (40 if ("GBP" in symbol or "EUR" in symbol) else 30)
            fib_tp = entry_p + fb_pips * pip if is_bull else entry_p - fb_pips * pip

        if mode == "limit":
            # v2: Use the 4H swing origin as primary TP — price came FROM there,
            # it is the natural return target and produces the highest R:R.
            # Pick whichever is farther: swing origin vs nearest S/R level.
            sr_tp = tp_cands[0]["price"] if tp_cands else fib_tp
            origin_tp = hi_price if is_bull else lo_price
            if origin_tp and ((is_bull and origin_tp > entry_p) or
                              (not is_bull and origin_tp < entry_p)):
                tp_p = max(origin_tp, sr_tp) if is_bull else min(origin_tp, sr_tp)
            else:
                tp_p = sr_tp
        else:
            tp_p = tp_cands[0]["price"] if tp_cands else fib_tp

        risk   = abs(entry_p - sl_p)
        reward = abs(tp_p - entry_p)
        rr     = round(reward / risk, 1) if risk > 0 else 0.0
        return {"entry": round(entry_p, 5), "sl": round(sl_p, 5), "tp": round(tp_p, 5), "rr": rr}

    limit_setup = _setup("limit")

    # ── Limit zone status (for auto-cancel monitoring) ─────────────────────────
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

    # ── Ready flags ────────────────────────────────────────────────────────────
    limit_ready = bool(
        has_dir and
        has_1h_zone and
        limit_zone_status != "blown" and
        limit_zone_distance <= 50 and 
        not news_blocked and
        limit_setup["rr"] >= 2.5
    )

    return {
        "limit_ready":         limit_ready,
        "direction":           direction,
        "limit_rr":            limit_setup["rr"],
        # Bonus indicators — shown in UI / toast but do not block the signal
        "phase_good":          phase_ok,
        "retrace_pct":         retrace_pct,
        "has_15m_confluence":  has_15m_confluence,
        "zone_freshness":      zone_freshness,   # 0=fresh, 1+=tested; None if not OB
        "ob_strength":         ob1h.get("strength_score") if ob1h else None,
        # Zone state — returned so FrameworkMonitor can fire auto-cancel alerts
        "limit_zone_status":   limit_zone_status,
        "limit_zone_distance": limit_zone_distance,
        # Standard fields
        "has_1h_zone":         has_1h_zone,
        "news_blocked":        news_blocked,
        "price":               round(current_price, 5),
        "limit_entry":         limit_setup["entry"],
        "limit_sl":            limit_setup["sl"],
        "limit_tp":            limit_setup["tp"],
        "ob_d1":   ob_d1,
        "fvg_d1":  fvg_d1,
    }