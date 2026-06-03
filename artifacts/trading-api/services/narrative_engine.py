"""
Narrative Engine — translates raw market structure analysis into plain-English commentary.

Takes computed analysis (bias, BOS, CHoCH, zones, S/R, sessions) and produces a
structured narrative that answers: what condition is the market in, what are the
key levels, what should I be doing right now?

No market data is fetched here — this is a pure transformation function.
"""

from __future__ import annotations
import time


# ── Condition Classification ──────────────────────────────────────────────────

def _classify_condition(
    bias4h: str, bias1h: str, bias15m: str,
    bos_5m: list, choch_15m: list,
    near_resistance: bool, near_support: bool,
    broker_ts: float = 0,
) -> tuple[str, str]:
    """
    Returns (condition_label, one-sentence explanation).
    Labels match the set requested: Bullish Trend, Bullish Pullback, Bearish Trend,
    Bearish Pullback, Consolidation, Expansion, Distribution, Accumulation, Range.
    """
    now = broker_ts or time.time()

    def recent_choch(direction: str, hours: float = 6) -> bool:
        cutoff = now - hours * 3600
        return any(
            c.get("direction") == direction and c.get("time", 0) >= cutoff
            for c in choch_15m
        )

    def recent_bos(direction: str, hours: float = 1) -> bool:
        cutoff = now - hours * 3600
        return any(
            b.get("direction") == direction and b.get("time", 0) >= cutoff
            for b in bos_5m
        )

    bull4h = bias4h == "bullish"
    bear4h = bias4h == "bearish"
    bull1h = bias1h == "bullish"
    bear1h = bias1h == "bearish"
    bull15 = bias15m == "bullish"
    bear15 = bias15m == "bearish"
    neut4h = not bull4h and not bear4h
    neut1h = not bull1h and not bear1h
    neut15 = not bull15 and not bear15

    # ── Expansion (all TFs aligned + active BOS) ──
    if bull4h and bull1h and bull15 and recent_bos("bullish"):
        return ("Expansion",
                "Strong bullish momentum across all timeframes with active 5M BOS — trend is accelerating.")
    if bear4h and bear1h and bear15 and recent_bos("bearish"):
        return ("Expansion",
                "Strong bearish momentum across all timeframes with active 5M BOS — trend is accelerating.")

    # ── Full trend alignment ──
    if bull4h and bull1h and bull15:
        return ("Bullish Trend", "All timeframes aligned bullish. Buyers are in full control.")
    if bear4h and bear1h and bear15:
        return ("Bearish Trend", "All timeframes aligned bearish. Sellers are in full control.")

    # ── Pullback (best entry zones) ──
    if bull4h and bull1h:
        if bear15 or recent_choch("bearish"):
            return ("Bullish Pullback",
                    "Higher timeframe structure is bullish but 15M is correcting — "
                    "this is typically the prime long entry zone.")
        if neut15:
            return ("Bullish Pullback",
                    "Higher timeframe bullish with 15M pausing. "
                    "Consolidation within an uptrend — watch for the next leg higher.")

    if bear4h and bear1h:
        if bull15 or recent_choch("bullish"):
            return ("Bearish Pullback",
                    "Higher timeframe structure is bearish but 15M is bouncing — "
                    "this is typically the prime short entry zone.")
        if neut15:
            return ("Bearish Pullback",
                    "Higher timeframe bearish with 15M pausing. "
                    "Bounce within a downtrend — watch for the next leg lower.")

    # ── Distribution / Accumulation (HTF conflict near extremes) ──
    if bull4h and bear1h:
        if near_resistance:
            return ("Distribution",
                    "4H bullish but 1H has turned bearish near resistance — "
                    "potential distribution area. Longs are at risk.")
        return ("Distribution",
                "4H bullish but 1H sellers are gaining control. "
                "Short-term structure is weakening.")

    if bear4h and bull1h:
        if near_support:
            return ("Accumulation",
                    "4H bearish but 1H buyers are recovering near support — "
                    "potential accumulation area. Shorts are at risk.")
        return ("Accumulation",
                "4H bearish but 1H buyers are gaining control. "
                "Watch for a structural shift.")

    # ── Single clear TF ──
    if bull4h and neut1h:
        return ("Bullish Bias",
                "4H structure is bullish but 1H has not yet confirmed. "
                "Macro context favors longs — wait for lower TF alignment.")
    if bear4h and neut1h:
        return ("Bearish Bias",
                "4H structure is bearish but 1H has not yet confirmed. "
                "Macro context favors shorts — wait for lower TF alignment.")

    if neut4h and bull1h:
        if near_resistance:
            return ("Range",
                    "1H bullish but approaching key resistance with no 4H trend. "
                    "Breakout or reversal imminent.")
        return ("Range", "1H showing bullish structure but 4H is flat. Range conditions likely.")

    if neut4h and bear1h:
        if near_support:
            return ("Range",
                    "1H bearish but approaching key support with no 4H trend. "
                    "Breakdown or bounce imminent.")
        return ("Range", "1H showing bearish structure but 4H is flat. Range conditions likely.")

    return ("Consolidation",
            "No clear directional bias on any timeframe. "
            "Market is compressing — wait for a session-driven breakout.")


# ── Structure Summary ─────────────────────────────────────────────────────────

def _structure_summary(
    bias4h: str, bias1h: str, bias15m: str,
    choch_15m: list, bos_5m: list,
    broker_ts: float = 0,
) -> list[str]:
    """Returns 3-5 factual sentences describing the current market structure."""
    now = broker_ts or time.time()
    lines: list[str] = []

    def fmt(b: str) -> str:
        return {"bullish": "bullish", "bearish": "bearish"}.get(b, "neutral")

    lines.append(f"4H structure is {fmt(bias4h)}.")
    lines.append(f"1H structure is {fmt(bias1h)}.")

    # 15M with CHoCH annotation
    recent_15m = sorted(
        [c for c in choch_15m if now - c.get("time", 0) <= 8 * 3600],
        key=lambda x: x.get("time", 0), reverse=True,
    )
    if recent_15m:
        evt = recent_15m[0]
        age_h = round((now - evt.get("time", now)) / 3600, 1)
        lines.append(
            f"15M structure is {fmt(bias15m)} — "
            f"CHoCH {evt['direction']} formed {age_h}h ago."
        )
    else:
        lines.append(f"15M structure is {fmt(bias15m)}.")

    # HTF summary sentence
    if bias4h == "bullish" and bias1h == "bullish":
        lines.append("Higher timeframe buyers remain in control.")
    elif bias4h == "bearish" and bias1h == "bearish":
        lines.append("Higher timeframe sellers remain in control.")
    elif bias4h != "neutral" and bias1h != "neutral" and bias4h != bias1h:
        lines.append(
            "Higher timeframes are conflicting — reduce conviction "
            "or wait for one side to capitulate."
        )
    else:
        lines.append("Higher timeframe bias is developing — patience required.")

    # Recent 5M BOS note
    bos_recent = sorted(
        [b for b in bos_5m if now - b.get("time", 0) <= 90 * 60],
        key=lambda x: x.get("time", 0), reverse=True,
    )
    if bos_recent:
        b = bos_recent[0]
        age_m = int((now - b.get("time", now)) / 60)
        lines.append(f"5M {b['direction']} BOS {age_m}m ago — momentum confirmed in that direction.")

    return lines


# ── Key Levels ────────────────────────────────────────────────────────────────

def _key_levels(
    sr_levels: list, zones: list,
    current_price: float, pip_size: float,
) -> dict:
    """
    Returns nearest resistance levels above price and support levels below price.
    Combines S/R swing levels and supply/demand zones.
    """
    resistance: list[dict] = []
    support: list[dict] = []

    for lvl in (sr_levels or []):
        p = lvl.get("price")
        if not isinstance(p, (int, float)):
            continue
        score     = lvl.get("score", 1)
        touches   = lvl.get("touches", 1)
        timeframe = lvl.get("timeframe", "")
        major     = score >= 3 or touches >= 4 or timeframe == "4h"
        pips      = round(abs(p - current_price) / pip_size)
        entry     = {
            "price":     round(p, 5),
            "label":     "Major" if major else "",
            "timeframe": timeframe.upper() if timeframe else "",
            "pips_away": pips,
            "source":    "S/R",
        }
        (resistance if p > current_price else support).append(entry)

    for zone in (zones or []):
        top    = zone.get("top", 0)
        bottom = zone.get("bottom", 0)
        if not top or not bottom:
            continue
        center    = zone.get("center", (top + bottom) / 2)
        timeframe = zone.get("timeframe", "")
        pips      = round(abs(center - current_price) / pip_size)
        entry     = {
            "price":     round(center, 5),
            "range":     [round(bottom, 5), round(top, 5)],
            "label":     "Zone",
            "timeframe": timeframe.upper() if timeframe else "",
            "pips_away": pips,
            "source":    "Zone",
        }
        (resistance if center > current_price else support).append(entry)

    return {
        "resistance": sorted(resistance, key=lambda x: x["pips_away"])[:3],
        "support":    sorted(support,    key=lambda x: x["pips_away"])[:3],
    }


# ── Session Context ───────────────────────────────────────────────────────────

def _session_context(sessions: list[str]) -> list[str]:
    """Returns 2-3 plain-English sentences about the current session."""
    lines: list[str] = []
    s = [x.lower() for x in (sessions or [])]

    if "london" in s and ("ny" in s or "new york" in s):
        lines.append("London/New York overlap is active — highest liquidity window of the day.")
        lines.append("This is the most reliable period for breakout and momentum trades.")
    elif "london" in s:
        lines.append("London session is active.")
        lines.append("Expect directional moves and elevated volatility. London trends typically set the day's direction.")
    elif "ny" in s or "new york" in s:
        lines.append("New York session is active.")
        lines.append("Watch for US data-driven moves. NY often reverses or continues London trends decisively.")
    elif "asian" in s or "asia" in s:
        lines.append("Asian session — range conditions expected with tighter price action.")
        lines.append("London open setup is forming. S5/S6 breakout strategies are most applicable here.")
        lines.append("Avoid chasing moves in thin conditions.")
    else:
        lines.append("Inter-session period — liquidity is lower than normal.")
        lines.append("Avoid low-conviction entries. Wait for London or New York to open.")

    return lines


# ── Trade Readiness ───────────────────────────────────────────────────────────

def _trade_readiness(
    condition: str,
    bias4h: str, bias1h: str, bias15m: str,
    choch_15m: list, bos_5m: list,
    sessions: list[str],
    sr_levels: list, zones: list,
    current_price: float, pip_size: float,
    news_blocked: bool,
    broker_ts: float = 0
) -> dict:
    """
    Evaluates 5 conditions and returns a readiness object with plain-English summary.
    """
    now = broker_ts or time.time()
    s_lower = [x.lower() for x in (sessions or [])]
    in_session = any(x in s_lower for x in ["london", "ny", "new york"])

    if news_blocked:
        return {
            "ready": False, "direction": None,
            "summary": "This pair is blocked due to a high-impact news event.",
            "action": "Do not trade. Wait for the news window to pass before entering.",
            "conditions": [{"label": "News window clear", "met": False}],
            "met": 0, "total": 1,
        }

    if condition in ("Consolidation", "Range"):
        return {
            "ready": False, "direction": None,
            "summary": "Market is ranging with no clear directional bias.",
            "action": "Wait. No trade until price breaks and holds outside the current range.",
            "conditions": [
                {"label": "4H + 1H aligned",   "met": False},
                {"label": "Active session",     "met": in_session},
            ],
            "met": 1 if in_session else 0, "total": 2,
        }

    bull = bias4h == "bullish" and bias1h == "bullish"
    bear = bias4h == "bearish" and bias1h == "bearish"
    direction = "long" if bull else ("short" if bear else None)

    if not direction:
        return {
            "ready": False, "direction": None,
            "summary": "Higher timeframe bias is not yet aligned.",
            "action": "Wait for 4H and 1H to agree on direction before looking for entries.",
            "conditions": [
                {"label": "4H + 1H aligned",   "met": False},
                {"label": "Active session",     "met": in_session},
            ],
            "met": 1 if in_session else 0, "total": 2,
        }

    # ── Build 5-condition checklist ──────────────────────────────────────────
    # 1. HTF alignment
    htf_met = True

    # 2. 15M pullback / pause structure
    recent_choch = [c for c in choch_15m if now - c.get("time", 0) <= 24 * 3600]
    pullback_met = (
        (direction == "long"  and (bias15m in ("neutral", "bearish") or any(c.get("direction") == "bearish" for c in recent_choch))) or
        (direction == "short" and (bias15m in ("neutral", "bullish") or any(c.get("direction") == "bullish" for c in recent_choch)))
    )

    # 3. 5M BOS in trade direction (last 90 min)
    bos_dir = "bullish" if direction == "long" else "bearish"
    bos_met = any(
        b.get("direction") == bos_dir and now - b.get("time", 0) <= 90 * 60
        for b in bos_5m
    )

    # 4. Key level nearby (within 15 pips)
    threshold = 15 * pip_size
    level_met = False
    for lvl in (sr_levels or []):
        p = lvl.get("price")
        if isinstance(p, (int, float)) and abs(p - current_price) <= threshold:
            level_met = True
            break
    if not level_met:
        for zone in (zones or []):
            top, bottom = zone.get("top", 0), zone.get("bottom", 0)
            if top and bottom:
                center = (top + bottom) / 2
                if abs(center - current_price) <= threshold:
                    level_met = True
                    break

    # 5. Active session
    session_met = in_session

    conditions = [
        {"label": f"4H + 1H aligned {'bullish' if direction == 'long' else 'bearish'}", "met": htf_met},
        {"label": "15M pullback / structure pause present",                              "met": pullback_met},
        {"label": "5M BOS confirmed in trade direction",                                 "met": bos_met},
        {"label": "Price near key S/R level or zone (15 pips)",                         "met": level_met},
        {"label": "Active trading session (London or New York)",                         "met": session_met},
    ]

    met   = sum(1 for c in conditions if c["met"])
    total = len(conditions)

    dir_label = "Long" if direction == "long" else "Short"

    if met == total:
        summary = f"All {total} conditions satisfied — {dir_label} setup is ready."
        action  = f"Look to enter {dir_label.lower()} at current price or on the next touch of the nearest key level."
        ready   = True
    elif met == total - 1:
        missing = next(c["label"] for c in conditions if not c["met"])
        summary = f"{met}/{total} conditions met — {dir_label} setup is nearly complete."
        action  = f"One condition missing: {missing}. Monitor closely."
        ready   = False
    elif met >= 2:
        missing = [c["label"] for c in conditions if not c["met"]]
        summary = f"{met}/{total} conditions met — {dir_label} setup is developing."
        action  = f"Still waiting on: {'; '.join(missing[:2])}."
        ready   = False
    else:
        summary = f"Only {met}/{total} conditions met. No {dir_label.lower()} setup at this time."
        action  = "Wait. Market conditions are not aligned for a trade."
        ready   = False

    return {
        "ready":      ready,
        "direction":  direction,
        "summary":    summary,
        "action":     action,
        "conditions": conditions,
        "met":        met,
        "total":      total,
    }


# ── Confidence ────────────────────────────────────────────────────────────────

def _confidence(
    readiness: dict,
    bias4h: str, bias1h: str, bias15m: str,
) -> dict:
    bull_align = bias4h == "bullish" and bias1h == "bullish"
    bear_align = bias4h == "bearish" and bias1h == "bearish"

    if bull_align or bear_align:
        clarity, clarity_score = "High", 85
    elif (bias4h in ("bullish", "bearish")) and (bias1h in ("bullish", "bearish")) and bias4h != bias1h:
        clarity, clarity_score = "Low", 25
    elif (bias4h in ("bullish", "bearish")) or (bias1h in ("bullish", "bearish")):
        clarity, clarity_score = "Medium", 60
    else:
        clarity, clarity_score = "Low", 20

    aligned_15m = (
        (bias4h == "bullish" and bias15m == "bullish") or
        (bias4h == "bearish" and bias15m == "bearish")
    )
    structure_quality = "High" if aligned_15m else ("Medium" if bias15m != "neutral" else "Low")

    met   = readiness.get("met", 0)
    total = readiness.get("total", 5)
    base  = int((met / max(total, 1)) * 100)

    if clarity == "High":
        signal_confidence = min(100, base + 10)
    elif clarity == "Low":
        signal_confidence = max(0, base - 20)
    else:
        signal_confidence = base

    return {
        "market_clarity":    clarity,
        "structure_quality": structure_quality,
        "signal_confidence": signal_confidence,
    }


# ── Main Entry Point ──────────────────────────────────────────────────────────

def generate_narrative(
    symbol:        str,
    current_price: float,
    pip_size:      float,
    bias_4h:       str,
    bias_1h:       str,
    bias_15m:      str,
    bos_5m:        list,
    bos_15m:       list,
    choch_5m:      list,
    choch_15m:     list,
    zones:         list,
    sr_levels:     list,
    sessions:      list[str],
    news_blocked:  bool,
    news_reason:   str,
    broker_ts:     float = 0,
) -> dict:
    pip_size = pip_size or 0.0001
    now = broker_ts or time.time()


    # Near-level flags for condition classifier
    threshold = 20 * pip_size
    near_res = any(
        isinstance((p := lvl.get("price")), (int, float)) and
        p > current_price and abs(p - current_price) <= threshold
        for lvl in (sr_levels or [])
    )
    near_sup = any(
        isinstance((p := lvl.get("price")), (int, float)) and
        p < current_price and abs(p - current_price) <= threshold
        for lvl in (sr_levels or [])
    )

    condition, condition_detail = _classify_condition(
        bias_4h, bias_1h, bias_15m, bos_5m, choch_15m, near_res, near_sup, broker_ts=now,
    )

    structure  = _structure_summary(bias_4h, bias_1h, bias_15m, choch_15m, bos_5m,  broker_ts=now,)
    key_levels = _key_levels(sr_levels, zones, current_price, pip_size)
    session    = _session_context(sessions)
    readiness  = _trade_readiness(
        condition, bias_4h, bias_1h, bias_15m,
        choch_15m, bos_5m, sessions,
        sr_levels, zones, current_price, pip_size, news_blocked, broker_ts=now,
    )
    confidence = _confidence(readiness, bias_4h, bias_1h, bias_15m)

    return {
        "symbol":           symbol,
        "price":            current_price,
        "condition":        condition,
        "condition_detail": condition_detail,
        "structure":        structure,
        "key_levels":       key_levels,
        "session":          session,
        "trade_readiness":  readiness,
        "confidence":       confidence,
        "news": {
            "blocked": news_blocked,
            "reason":  news_reason,
        },
        "broker_time":  int(now),
        "generated_at": int(now), 
    }

    # ── Environment Evaluator ─────────────────────────────────────────────────────
def build_environment(
    current_price: float,
    pip_size: float,
    bias_4h: str,
    bias_1h: str,
    bias_15m: str,
    bos_5m: list,
    choch_15m: list,
    sr_levels: list,
    sessions: list,
    news_blocked: bool,
    news_reason: str,
    broker_ts: float = 0,

) -> dict:
    """
    Returns Scalp and Limit environment ratings for one symbol.
    Ratings: "Favorable" | "Mixed" | "Unfavorable"
    No trade signals — only describes market conditions.
    """
    
    now = broker_ts or time.time()
    # ── Helpers ───────────────────────────────────────────────────────────────
    def recent_choch(hours: float = 4) -> bool:
        cutoff = now - hours * 3600
        return any(c.get("time", 0) >= cutoff for c in choch_15m)
    def recent_bos(hours: float = 1) -> bool:
        cutoff = now - hours * 3600
        return any(b.get("time", 0) >= cutoff for b in bos_5m)
    def aligned_tfs() -> int:
        """How many of the 3 TFs agree on direction."""
        directions = [bias_4h, bias_1h, bias_15m]
        bull = directions.count("bullish")
        bear = directions.count("bearish")
        return max(bull, bear)
    # ── Nearest S/R level distance in pips ────────────────────────────────────
    nearest_pips: float | None = None
    nearest_label: str = ""
    level_warning: str | None = None
    if sr_levels and current_price:
        distances = []
        for lvl in sr_levels:
            price = lvl.get("price", 0)
            if price:
                dist_pips = abs(current_price - price) / pip_size
                distances.append((dist_pips, lvl))
        if distances:
            distances.sort(key=lambda x: x[0])
            nearest_pips, nearest_lvl = distances[0]
            tf_label = nearest_lvl.get("timeframe", "").upper()
            kind     = nearest_lvl.get("kind", "level")
            side     = "resistance" if nearest_lvl.get("price", 0) > current_price else "support"
            nearest_label = f"{tf_label} {side}"
            if nearest_pips <= 10:
                level_warning = f"Price {nearest_pips:.0f} pips from {nearest_label}"
    # ── Session quality ────────────────────────────────────────────────────────
    active = [s.lower() for s in sessions]
    prime_session  = any(s in active for s in ("london",  "ny"))
    dead_session   = not active  # no recognised session active
    # ── SCALP environment ─────────────────────────────────────────────────────
    scalp_issues:   list[str] = []
    scalp_positives: list[str] = []
    if news_blocked:
        scalp_issues.append(f"news block active — {news_reason}")
    if dead_session:
        scalp_issues.append("no active trading session")
    alignment = aligned_tfs()
    if alignment >= 2 and recent_bos():
        scalp_positives.append("directional structure with active BOS")
    elif alignment >= 2:
        scalp_positives.append("multi-TF bias aligned")
    else:
        scalp_issues.append("no clear multi-TF alignment")
    if prime_session:
        scalp_positives.append("prime session active")
    # Fresh CHoCH = structure is transitioning; mixed for scalp (not blocked)
    fresh_choch = recent_choch(hours=2)
    if fresh_choch:
        scalp_issues.append("fresh CHoCH — structure transitioning")
    if level_warning:
        scalp_issues.append("price near key level — reduced follow-through risk")
    if len(scalp_issues) == 0:
        scalp_rating = "Favorable"
        scalp_reason = "; ".join(scalp_positives) or "conditions clear"
    elif len(scalp_issues) == 1 and len(scalp_positives) >= 1:
        scalp_rating = "Mixed"
        scalp_reason = scalp_issues[0]
    else:
        scalp_rating = "Unfavorable"
        scalp_reason = scalp_issues[0]
    # ── LIMIT environment ─────────────────────────────────────────────────────
    limit_issues:    list[str] = []
    limit_positives: list[str] = []
    if news_blocked:
        limit_issues.append(f"news block — {news_reason}")
    # Strong momentum = limit orders get blown through
    if alignment == 3 and recent_bos(hours=0.5):
        limit_issues.append("strong expansion momentum — limits may be blown through")
    elif alignment >= 2:
        limit_positives.append("clear directional bias present")
    # Distance logic
    if nearest_pips is None:
        limit_issues.append("no meaningful S/R level nearby")
    elif nearest_pips <= 5:
        limit_positives.append(f"significant level {nearest_pips:.0f} pips away")
    elif nearest_pips <= 20:
        limit_positives.append(f"level {nearest_pips:.0f} pips away")
    else:
        limit_issues.append(f"nearest level {nearest_pips:.0f} pips away — too distant")
    # CHoCH: fresh = mixed for limits (level may not hold), not unfavorable
    if fresh_choch and alignment < 2:
        limit_issues.append("conflicting structure during CHoCH — level reliability reduced")
    elif fresh_choch:
        limit_issues.append("fresh CHoCH — potential reversal zone but unconfirmed")
    if len(limit_issues) == 0:
        limit_rating = "Favorable"
        limit_reason = "; ".join(limit_positives) or "conditions clear"
    elif len(limit_issues) == 1 and len(limit_positives) >= 1:
        limit_rating = "Mixed"
        limit_reason = limit_issues[0]
    else:
        limit_rating = "Unfavorable"
        limit_reason = limit_issues[0]
    return {
        "scalp":         scalp_rating,
        "scalp_reason":  scalp_reason,
        "limit":         limit_rating,
        "limit_reason":  limit_reason,
        "level_warning": level_warning,
    }


