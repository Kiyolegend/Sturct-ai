"""
Narrative Engine — translates raw market structure analysis into plain-English commentary.

IMPORTANT DESIGN CHANGE (per product decision):
This engine no longer classifies a market "condition" (Bullish Pullback, Range,
Expansion, etc.) and it no longer tells the trader WHERE to enter, WHAT level to
watch, or WHAT to wait for. Finding the entry is the trader's job.

Instead this engine answers one question: "what trading style does the current
structure support right now?" — Scalping, Intraday Trade, Swing Trade, and/or
Trend Exhaustion (a caution state, not a style to trade). More than one can be
true at once, and if so, all of them are reported.

Accuracy note on "Trend Exhaustion": this engine only has visibility into the
recent swing structure pulled from the analysis window (roughly the last
handful of 4H/1H/15M swings). It cannot know true multi-year/all-time highs or
lows. Exhaustion here means "relative to the recent swing structure this
engine can see" — described that way everywhere it's surfaced, not as an
absolute all-time extreme claim.

No market data is fetched here — this is a pure transformation function.
"""

from __future__ import annotations
import time


# ── Structure Summary ─────────────────────────────────────────────────────────

def _structure_summary(
    bias4h: str, bias1h: str, bias15m: str,
    choch_15m: list, bos_5m: list,
    broker_ts: float = 0,
    bias_d1: str = "neutral",
) -> list[str]:
    """Returns 4-6 factual sentences describing the current market structure/bias."""
    now = broker_ts or time.time()
    lines: list[str] = []

    def fmt(b: str) -> str:
        return {"bullish": "bullish", "bearish": "bearish"}.get(b, "neutral")

    lines.append(f"D1 structure is {fmt(bias_d1)}.")
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

    # Recent 5M BOS note (factual, not an instruction to act)
    bos_recent = sorted(
        [b for b in bos_5m if now - b.get("time", 0) <= 90 * 60],
        key=lambda x: x.get("time", 0), reverse=True,
    )
    if bos_recent:
        b = bos_recent[0]
        age_m = int((now - b.get("time", now)) / 60)
        lines.append(f"5M {b['direction']} BOS {age_m}m ago — momentum confirmed in that direction.")

    return lines


# ── Swing Context (used internally for style/exhaustion classification) ───────

def _swing_context(
    hi_price: float | None,
    lo_price: float | None,
    current_price: float,
    bias_4h: str,
    pip_size: float,
) -> dict:
    """
    Returns where price sits within the current 4H swing leg. Purely descriptive —
    no entry instruction. Used both for display (structure context) and internally
    to help classify trading style / trend exhaustion.
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

    # Negative retrace = price has broken beyond the swing extreme (active expansion)
    if retrace_pct < 0:
        side = "high" if is_bull else "low"
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has broken beyond the recent "
            f"4H swing {side} — currently in active expansion ({abs(retrace_pct)}% beyond the extreme)."
        )
        return {
            "leg_pips":    leg_pips,
            "retrace_pct": retrace_pct,
            "in_window":   False,
            "description": desc,
        }

    if retrace_pct < 20:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has barely pulled back "
            f"({retrace_pct}% retrace) — the move is still extended."
        )
    elif retrace_pct < 38:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price is at a {retrace_pct}% retrace — "
            f"approaching the typical structural pullback zone (38%) but not there yet."
        )
    elif retrace_pct <= 70:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price is at a {retrace_pct}% retrace — "
            f"inside the typical structural pullback zone (38–70%)."
        )
    elif retrace_pct <= 85:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has retraced {retrace_pct}% — "
            f"deeper than a typical pullback."
        )
    else:
        desc = (
            f"The 4H leg covered {leg_pips} pips. Price has retraced {retrace_pct}% — "
            f"this deep a pullback often signals the prior trend leg is exhausted."
        )

    return {
        "leg_pips":    leg_pips,
        "retrace_pct": retrace_pct,
        "in_window":   in_window,
        "description": desc,
    }


# ── Session Context ───────────────────────────────────────────────────────────

def _session_context(sessions: list[str]) -> list[str]:
    """Returns 2-3 plain-English sentences about the current session."""
    lines: list[str] = []
    s = [x.lower() for x in (sessions or [])]

    if "london" in s and ("ny" in s or "new york" in s):
        lines.append("London/New York overlap is active — highest liquidity window of the day.")
        lines.append("This is generally the most active period for breakout and momentum conditions.")
    elif "london" in s:
        lines.append("London session is active.")
        lines.append("Expect directional moves and elevated volatility. London typically sets the day's tone.")
    elif "ny" in s or "new york" in s:
        lines.append("New York session is active.")
        lines.append("US data-driven moves are common. NY often reverses or continues London's move.")
    elif "asian" in s or "asia" in s:
        lines.append("Asian session — range conditions expected with tighter price action.")
        lines.append("Liquidity is thin compared to London/NY.")
    else:
        lines.append("Inter-session period — liquidity is lower than normal.")
        lines.append("Session is quiet until London or New York opens.")

    return lines


# ── Confidence ────────────────────────────────────────────────────────────────

def _confidence(
    bias4h: str, bias1h: str, bias15m: str,
    sessions: list[str], news_blocked: bool,
) -> dict:
    """Market clarity / structure quality / overall signal confidence. No entry info."""
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

    in_session = any(x in [s.lower() for s in (sessions or [])] for x in ("london", "ny", "new york"))

    signal_confidence = clarity_score
    if news_blocked:
        signal_confidence -= 15
    if not in_session:
        signal_confidence -= 10
    signal_confidence = max(0, min(100, signal_confidence))

    return {
        "market_clarity":    clarity,
        "structure_quality": structure_quality,
        "signal_confidence": signal_confidence,
    }


# ── Trading Style Classification ──────────────────────────────────────────────

def _classify_trading_styles(
    bias4h: str, bias1h: str, bias15m: str,
    bos_5m: list, bos_15m: list, choch_15m: list,
    sessions: list[str], news_blocked: bool,
    swing_ctx: dict,
    broker_ts: float = 0,
    bias_d1: str = "neutral",
) -> list[dict]:
    """
    Returns a list of {"style": str, "direction": str|None, "reason": str} entries
    for every style currently supported by structure. Zero, one, or several can
    qualify. Does NOT mention price levels, entries, or waiting instructions.
    """
    now = broker_ts or time.time()
    s_lower = [x.lower() for x in (sessions or [])]
    in_session = any(x in s_lower for x in ("london", "ny", "new york"))

    def recent(events: list, hours: float, direction: str | None = None) -> bool:
        cutoff = now - hours * 3600
        return any(
            e.get("time", 0) >= cutoff and (direction is None or e.get("direction") == direction)
            for e in events
        )

    styles: list[dict] = []

    htf_dir: str | None = None
    if bias4h == bias1h and bias4h in ("bullish", "bearish"):
        htf_dir = bias4h

    full_align = htf_dir is not None and bias15m == htf_dir

    def to_direction(d: str | None) -> str | None:
        """Maps a bias string to an explicit long/short direction. None means no directional read."""
        if d == "bullish":
            return "long"
        if d == "bearish":
            return "short"
        return None

    # ── Scalping: needs live liquidity + short-term structure moving, no news block ──
    if not news_blocked and in_session:
        short_term_active = (
            bias15m != "neutral"
            or recent(bos_5m, 1.5)
            or recent(choch_15m, 4)
        )
        if short_term_active:
            styles.append({
                "style": "Scalping",
                "direction": to_direction(bias15m),
                "reason": (
                    "Active session with short-term (5M/15M) structure moving — "
                    "conditions support scalping."
                ),
            })

    # ── Intraday Trade: 4H + 1H agree on direction ──
    if htf_dir is not None:
        styles.append({
            "style": "Intraday Trade",
            "direction": to_direction(htf_dir),
            "reason": (
                f"4H and 1H structure both {htf_dir} — conditions support an "
                f"intraday trade in that direction."
            ),
        })

    # ── Swing Trade: all three timeframes aligned, or HTF aligned with a healthy 4H pullback ──
    d1_confirms = bias_d1 in ("bullish", "bearish") and htf_dir is not None and bias_d1 == htf_dir
    d1_suffix = " D1 also confirms this direction — stronger macro conviction." if d1_confirms else ""

    if full_align:
        styles.append({
            "style": "Swing Trade",
            "direction": to_direction(htf_dir),
            "reason": (
                f"4H, 1H, and 15M are all aligned {htf_dir} — conditions support "
                f"a swing trade in that direction.{d1_suffix}"
            ),
        })
    elif htf_dir is not None and swing_ctx.get("in_window"):
        styles.append({
            "style": "Swing Trade",
            "direction": to_direction(htf_dir),
            "reason": (
                f"4H and 1H aligned {htf_dir}, with the 4H leg pulled back into a "
                f"typical structural zone ({swing_ctx.get('retrace_pct')}% retrace) — "
                f"conditions support a swing trade.{d1_suffix}"
            ),
        })

    return styles


def _trend_exhaustion(
    bias4h: str,
    swing_ctx: dict,
    bos_5m: list,
    choch_15m: list,
    current_price: float,
    hi_4h: float | None,
    lo_4h: float | None,
    pip_size: float,
    broker_ts: float = 0,
    bias_d1: str = "neutral",
    hi_d1: float | None = None,
    lo_d1: float | None = None,
) -> dict:
    """
    Flags trend exhaustion relative to the recent swing structure this engine can
    see (NOT a claim about true multi-year/all-time highs or lows — this engine
    doesn't have that data). Returns {"active": bool, "notes": [str, ...]}.
    """
    now = broker_ts or time.time()
    notes: list[str] = []

    retrace_pct = swing_ctx.get("retrace_pct")

    # Deep retracement — the prior leg likely exhausted
    if retrace_pct is not None and retrace_pct >= 85:
        notes.append(
            f"The 4H pullback has gone very deep ({retrace_pct}%) — this often marks "
            f"exhaustion of the prior trend leg rather than a healthy retracement."
        )

    # Hard extension with almost no pullback — climax-style move
    full_align_bull = bias4h == "bullish"
    full_align_bear = bias4h == "bearish"
    hard_bos = (
        (full_align_bull and any(b.get("direction") == "bullish" and now - b.get("time", 0) <= 30 * 60 for b in bos_5m)) or
        (full_align_bear and any(b.get("direction") == "bearish" and now - b.get("time", 0) <= 30 * 60 for b in bos_5m))
    )
    if hard_bos and retrace_pct is not None and retrace_pct <= 8:
        notes.append(
            "Price is extending hard with almost no pullback — this kind of move "
            "can reverse sharply once it runs out of steam."
        )

    # Pushed beyond the recent 4H swing extreme without fresh confirmation
    if bias4h == "bullish" and hi_4h and current_price > hi_4h:
        confirmed = any(b.get("direction") == "bullish" and now - b.get("time", 0) <= 3600 for b in bos_5m)
        if not confirmed:
            notes.append(
                "Price has pushed beyond the most recent 4H swing high visible to this "
                "engine without fresh confirmation — often a sign of exhaustion or a "
                "false breakout (not a claim about the all-time high)."
            )
    elif bias4h == "bearish" and lo_4h and current_price < lo_4h:
        confirmed = any(b.get("direction") == "bearish" and now - b.get("time", 0) <= 3600 for b in bos_5m)
        if not confirmed:
            notes.append(
                "Price has pushed beyond the most recent 4H swing low visible to this "
                "engine without fresh confirmation — often a sign of exhaustion or a "
                "false breakdown (not a claim about the all-time low)."
            )

    # Pushed beyond the recent D1 (daily) swing extreme — the strongest
    # multi-timeframe exhaustion signal this engine can produce. This is the
    # daily swing range visible in the data pulled, NOT a true all-time high/low.
    if bias_d1 == "bullish" and hi_d1 and current_price > hi_d1:
        confirmed_d1 = any(
            b.get("direction") == "bullish" and now - b.get("time", 0) <= 4 * 3600
            for b in bos_5m
        )
        if not confirmed_d1:
            notes.append(
                "Price has pushed beyond the most recent D1 (daily) swing high visible "
                "to this engine without fresh confirmation — the strongest exhaustion / "
                "false-breakout signal available here (this engine cannot see true "
                "all-time highs, only the recent daily swing range)."
            )
    elif bias_d1 == "bearish" and lo_d1 and current_price < lo_d1:
        confirmed_d1 = any(
            b.get("direction") == "bearish" and now - b.get("time", 0) <= 4 * 3600
            for b in bos_5m
        )
        if not confirmed_d1:
            notes.append(
                "Price has pushed beyond the most recent D1 (daily) swing low visible "
                "to this engine without fresh confirmation — the strongest exhaustion / "
                "false-breakdown signal available here (this engine cannot see true "
                "all-time lows, only the recent daily swing range)."
            )

    return {"active": len(notes) > 0, "notes": notes}


def _build_style_summary(best: list[dict]) -> str:
    if not best:
        return (
            "No trading style is favorable right now — structure is unclear or "
            "conditions are quiet. Standing aside is the best action."
        )
    names = [b["style"] for b in best]
    if len(names) == 1:
        return f"Best trading style right now: {names[0]}."
    return f"Multiple styles are currently confirmed: {', '.join(names)}."


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
    bias_d1:       str = "neutral",
    hi_d1:         float | None = None,
    lo_d1:         float | None = None,
) -> dict:
    """
    NOTE: D1 (bias_d1, hi_d1, lo_d1) was added as a new set of parameters with
    defaults, so this remains backward-compatible with any other caller — but
    routers/narrative.py has been updated to fetch D1 and pass these in, since
    that's what powers the D1 bias line and the strongest exhaustion check.
    `zones` and `sr_levels` are accepted for call-compatibility but are no
    longer used to build the response (we no longer surface price levels here).
    """
    pip_size = pip_size or 0.0001
    now = broker_ts or time.time()

    structure  = _structure_summary(bias_4h, bias_1h, bias_15m, choch_15m, bos_5m, broker_ts=now, bias_d1=bias_d1)
    session    = _session_context(sessions)
    swing_ctx  = _swing_context(hi_4h, lo_4h, current_price, bias_4h, pip_size)
    confidence = _confidence(bias_4h, bias_1h, bias_15m, sessions, news_blocked)

    best_styles = _classify_trading_styles(
        bias_4h, bias_1h, bias_15m,
        bos_5m, bos_15m, choch_15m,
        sessions, news_blocked, swing_ctx,
        broker_ts=now,
        bias_d1=bias_d1,
    )

    exhaustion = _trend_exhaustion(
        bias_4h, swing_ctx, bos_5m, choch_15m,
        current_price, hi_4h, lo_4h, pip_size,
        broker_ts=now,
        bias_d1=bias_d1, hi_d1=hi_d1, lo_d1=lo_d1,
    )
    if exhaustion["active"]:
        exhaustion_bias = bias_4h if bias_4h in ("bullish", "bearish") else bias_d1
        exhaustion_direction = (
            "long" if exhaustion_bias == "bullish"
            else "short" if exhaustion_bias == "bearish"
            else None
        )
        best_styles = best_styles + [{
            "style":     "Trend Exhaustion",
            "direction": exhaustion_direction,
            "reason":    " ".join(exhaustion["notes"]),
        }]

    trading_styles = {
        "best":                best_styles,
        "multiple_confirmed":  len(best_styles) > 1,
        "summary":             _build_style_summary(best_styles),
    }

    return {
        "symbol": symbol,
        "price":  current_price,
        "bias": {
            "d1":  bias_d1,
            "h4":  bias_4h,
            "h1":  bias_1h,
            "m15": bias_15m,
        },
        "structure":       structure,
        "session":         session,
        "swing_context":   swing_ctx,
        "trading_styles":  trading_styles,
        "trend_exhaustion": exhaustion,
        "confidence":      confidence,
        "news": {
            "blocked": news_blocked,
            "reason":  news_reason,
        },
        "broker_time":  int(now),
        "generated_at": int(time.time()),
    }


# ── Environment Evaluator (UNCHANGED — powers the pair-sweep sidebar, not this panel) ──

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
    This function is untouched — it feeds /pair-sweep, a separate feature from
    the narrative panel this change targets.
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