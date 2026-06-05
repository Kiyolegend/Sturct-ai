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
        [c for c in choch_15m if now - c.get("time", 0) <= 3 * 3600],
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


# ── Swing Context ─────────────────────────────────────────────────────────────

def _swing_context(
    hi_price: float | None,
    lo_price: float | None,
    current_price: float,
    bias_4h: str,
    pip_size: float,
) -> dict:
    """
    Returns plain-English description of where price is in the 4H swing.
    Tells the trader: how far has the pullback gone? Am I in the entry window?
    """
    if not hi_price or not lo_price or not current_price:
        return {}

    leg_size = hi_price - lo_price
    if leg_size <= 0:
        return {}

    is_bull = bias_4h == "bullish"
    leg_pips = round(leg_size / pip_size)

    if is_bull:
        retrace_pct = round(((hi_price - current_price) / leg_size) * 100)
    else:
        retrace_pct = round(((current_price - lo_price) / leg_size) * 100)

    in_window = 38 <= retrace_pct <= 70

    if retrace_pct < 20:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has barely pulled back "
            f"({retrace_pct}% retrace) — momentum is still running. "
            f"Not a great entry zone yet."
        )
    elif retrace_pct < 38:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price is at a {retrace_pct}% retrace — "
            f"approaching the Fibonacci entry window (38%) but not there yet. "
            f"Watch but wait."
        )
    elif retrace_pct <= 70:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price is at a {retrace_pct}% retrace — "
            f"inside the Fibonacci entry window (38–70%). "
            f"This is the zone to look for entries."
        )
    elif retrace_pct <= 85:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has retraced {retrace_pct}% — "
            f"deeper than ideal (above 70%). Setup is lower conviction. "
            f"Tighten your criteria before entering."
        )
    else:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has retraced {retrace_pct}% — "
            f"this deep a pullback suggests the move may be reversing entirely. "
            f"Do not trade in the original direction."
        )

    return {
        "leg_pips":    leg_pips,
        "retrace_pct": retrace_pct,
        "in_window":   in_window,
        "description": desc,
    }


# ── Strongest Level ───────────────────────────────────────────────────────────

def _strongest_level(
    sr_levels: list,
    zones: list,
    current_price: float,
    bias_4h: str,
    pip_size: float,
) -> dict:
    """
    Identifies the single most important level for the trader to watch.
    For bulls → strongest support below. For bears → strongest resistance above.
    Returns plain-English description.
    """
    if bias_4h == "neutral":
        return {}

    is_bull = bias_4h == "bullish"
    candidates: list[dict] = []

    for lvl in (sr_levels or []):
        p = lvl.get("price")
        if not isinstance(p, (int, float)):
            continue
        if is_bull and p >= current_price:
            continue
        if not is_bull and p <= current_price:
            continue
        score   = lvl.get("score", 1)
        touches = lvl.get("touches", 1)
        tf      = lvl.get("timeframe", "")
        tf_weight = {"4h": 3, "1h": 2, "15m": 1}.get(tf, 1)
        importance = (score * 2) + (touches * 1.5) + (tf_weight * 2)
        pips = abs(p - current_price) / pip_size
        candidates.append({
            "price":      round(p, 5),
            "kind":       lvl.get("kind", "level"),
            "timeframe":  tf.upper(),
            "touches":    touches,
            "pips_away":  round(pips),
            "importance": importance,
            "source":     "S/R",
        })

    for zone in (zones or []):
        top    = zone.get("top", 0)
        bottom = zone.get("bottom", 0)
        if not top or not bottom:
            continue
        center = (top + bottom) / 2
        if is_bull and center >= current_price:
            continue
        if not is_bull and center <= current_price:
            continue
        tf        = zone.get("timeframe", "")
        tf_weight = {"4h": 3, "1h": 2, "15m": 1}.get(tf, 1)
        strength  = zone.get("strength", 1)
        importance = (strength * 2) + (tf_weight * 3)
        pips = abs(center - current_price) / pip_size
        candidates.append({
            "price":      round(center, 5),
            "kind":       "zone",
            "timeframe":  tf.upper(),
            "pips_away":  round(pips),
            "importance": importance,
            "source":     "Zone",
            "range":      [round(bottom, 5), round(top, 5)],
        })

    if not candidates:
        return {}

    best = max(candidates, key=lambda x: x["importance"])
    tf_label    = best["timeframe"] or "Key"
    kind_label  = "Order Block / Zone" if best["source"] == "Zone" else best["kind"].capitalize()
    pips        = best["pips_away"]
    side_word   = "below" if is_bull else "above"
    action_word = "support" if is_bull else "resistance"

    best["description"] = (
        f"The strongest level is the {tf_label} {kind_label} at {best['price']} — "
        f"{pips} pips {side_word} current price. "
        f"This is the key {action_word} zone where institutional interest is most likely. "
        f"{'Watch for a bounce here for longs.' if is_bull else 'Watch for a rejection here for shorts.'}"
    )
    return best


# ── Watch For ─────────────────────────────────────────────────────────────────

def _watch_for(
    condition: str,
    bias_4h: str,
    bias_1h: str,
    bias_15m: str,
    choch_15m: list,
    bos_5m: list,
    broker_ts: float,
) -> str:
    """
    Returns one plain-English sentence telling the trader exactly what to wait for
    before committing to a trade.
    """
    now = broker_ts or time.time()
    is_bull = bias_4h == "bullish"
    is_bear = bias_4h == "bearish"

    if condition in ("Consolidation", "Range"):
        return (
            "Wait for price to break and close a full candle outside the current range "
            "on the 1H timeframe before considering any directional trade."
        )

    if condition == "Expansion":
        if is_bull:
            return (
                "Momentum is running — do not chase. Wait for a 15M pullback and a fresh "
                "5M bullish BOS above the most recent swing high before re-entering."
            )
        return (
            "Momentum is running — do not chase. Wait for a 15M bounce and a fresh "
            "5M bearish BOS below the most recent swing low before re-entering."
        )

    if condition == "Distribution":
        return (
            "Conflicting timeframes — wait for the 4H to close a new high (confirming continuation) "
            "or the 1H to break its recent low (confirming reversal) before committing."
        )

    if condition == "Accumulation":
        return (
            "Conflicting timeframes — wait for the 1H to print a clear higher high above the "
            "last 1H swing high before trusting the long side."
        )

    recent_bos = any(now - b.get("time", 0) <= 90 * 60 for b in bos_5m)

    if is_bull:
        if bias_15m in ("bearish", "neutral"):
            return (
                "15M is pulling back into the trend. Wait for a 15M bullish CHoCH or a fresh "
                "5M bullish BOS near the key support level — that is your entry signal."
            )
        if recent_bos:
            return (
                "5M bullish BOS is active. Watch for price to hold above the BOS level on the "
                "next 5M dip — that confirms momentum is real. Enter on the pullback."
            )
        return (
            "Structure is bullish but no fresh 5M trigger yet. Wait for a 5M bullish BOS "
            "above the last swing high to confirm momentum before entering."
        )

    if is_bear:
        if bias_15m in ("bullish", "neutral"):
            return (
                "15M is bouncing into the trend. Wait for a 15M bearish CHoCH or a fresh "
                "5M bearish BOS near the key resistance level — that is your entry signal."
            )
        if recent_bos:
            return (
                "5M bearish BOS is active. Watch for price to hold below the BOS level on the "
                "next 5M bounce — that confirms momentum is real. Enter on the bounce."
            )
        return (
            "Structure is bearish but no fresh 5M trigger yet. Wait for a 5M bearish BOS "
            "below the last swing low to confirm momentum before entering."
        )

    return (
        "No clear directional structure. Wait for the 4H to establish a trend before "
        "looking for any entries."
    )


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
        major     = score >= 0.7 or touches >= 4 or timeframe == "4h"
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
    htf_met = True

    recent_choch = [c for c in choch_15m if now - c.get("time", 0) <= 4 * 3600]
    pullback_met = (
        (direction == "long"  and (bias15m in ("neutral", "bearish") or any(c.get("direction") == "bearish" for c in recent_choch))) or
        (direction == "short" and (bias15m in ("neutral", "bullish") or any(c.get("direction") == "bullish" for c in recent_choch)))
    )

    bos_dir = "bullish" if direction == "long" else "bearish"
    bos_met = any(
        b.get("direction") == bos_dir and now - b.get("time", 0) <= 90 * 60
        for b in bos_5m
    )

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
    hi_4h:         float | None = None,
    lo_4h:         float | None = None,
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

    structure  = _structure_summary(bias_4h, bias_1h, bias_15m, choch_15m, bos_5m, broker_ts=now)
    key_levels = _key_levels(sr_levels, zones, current_price, pip_size)
    session    = _session_context(sessions)
    readiness  = _trade_readiness(
        condition, bias_4h, bias_1h, bias_15m,
        choch_15m, bos_5m, sessions,
        sr_levels, zones, current_price, pip_size, news_blocked, broker_ts=now,
    )
    confidence = _confidence(readiness, bias_4h, bias_1h, bias_15m)

    swing_ctx      = _swing_context(hi_4h, lo_4h, current_price, bias_4h, pip_size)
    strongest_lvl  = _strongest_level(sr_levels, zones, current_price, bias_4h, pip_size)
    watch_for_text = _watch_for(condition, bias_4h, bias_1h, bias_15m, choch_15m, bos_5m, now)

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
        "swing_context":    swing_ctx,
        "strongest_level":  strongest_lvl,
        "watch_for":        watch_for_text,
        "news": {
            "blocked": news_blocked,
            "reason":  news_reason,
        },
        "broker_time":  int(now),
        "generated_at": int(time.time()),
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

    def recent_choch(hours: float = 4) -> bool:
        cutoff = now - hours * 3600
        return any(c.get("time", 0) >= cutoff for c in choch_15m)

    def recent_bos(hours: float = 1) -> bool:
        cutoff = now - hours * 3600
        return any(b.get("time", 0) >= cutoff for b in bos_5m)

    def aligned_tfs() -> int:
        directions = [bias_4h, bias_1h, bias_15m]
        bull = directions.count("bullish")
        bear = directions.count("bearish")
        return max(bull, bear)

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

    active = [s.lower() for s in sessions]
    prime_session = any(s in active for s in ("london", "ny"))
    dead_session  = not active

    scalp_issues:    list[str] = []
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

    limit_issues:    list[str] = []
    limit_positives: list[str] = []
    if news_blocked:
        limit_issues.append(f"news block — {news_reason}")
    if alignment == 3 and recent_bos(hours=0.5):
        limit_issues.append("strong expansion momentum — limits may be blown through")
    elif alignment >= 2:
        limit_positives.append("clear directional bias present")
    if nearest_pips is None:
        limit_issues.append("no meaningful S/R level nearby")
    elif nearest_pips <= 5:
        limit_positives.append(f"significant level {nearest_pips:.0f} pips away")
    elif nearest_pips <= 20:
        limit_positives.append(f"level {nearest_pips:.0f} pips away")
    else:
        limit_issues.append(f"nearest level {nearest_pips:.0f} pips away — too distant")
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
