"""
Auto Trade Engine — D1-first top-down sniper entry system.

REQUIRED: D1 trend is bullish OR bearish (not neutral)
REQUIRED: 4H CHoCH in the SAME direction as D1
ENTRY:    1H OB zone mid-point OR 1H CHoCH price level
SL:       Structural swing low/high on 1H (not fixed pips)
TP:       D1 swing origin for maximum R:R
FILTER:   R:R >= 1.5
BONUS:    Exhaustion score — detects if price is at a major extreme

Paper mode  -> logs signal, does NOT send to MT5
Live mode   -> queues order via routers.trading.queue_order()
"""

from __future__ import annotations
import asyncio
import time
import logging
from typing import Optional

from services.data_service import fetch_ohlc, candles_to_dict
from services.zigzag_engine import detect_swings
from services.structure_engine import classify_structure
from services.trend_engine import detect_trend
from services.choch_engine import detect_choch
from services.framework_checker import detect_order_blocks, _pip
from services.bos_engine import detect_bos


log = logging.getLogger(__name__)

PAIRS = [
    "USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY", "GBP/JPY",
    "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "AUD/JPY", "CAD/JPY",
]

# ── Module-level state ────────────────────────────────────────────────────────
_enabled:     bool = False
_paper_mode:  bool = True
_pair_status: dict[str, dict] = {}
_trade_log:   list[dict] = []
_fired_ids:   set[str] = set()
_fired_times: dict[str, float] = {} 
_FIRED_TTL_S: float = 7 * 24 * 3600
_bg_task: Optional[asyncio.Task] = None


# ── Public state accessors ────────────────────────────────────────────────────

def get_state() -> dict:
    return {
        "enabled":    _enabled,
        "paper_mode": _paper_mode,
        "pairs":      dict(_pair_status),
        "log_count":  len(_trade_log),
    }

def get_log() -> list[dict]:
    return list(_trade_log)

def set_enabled(v: bool) -> None:
    global _enabled
    _enabled = v

def set_paper_mode(v: bool) -> None:
    global _paper_mode
    _paper_mode = v


# ── Trend Exhaustion Detector ─────────────────────────────────────────────────

def _check_exhaustion(df_d1: object, labels_d1: list, current_price: float, is_bull: bool) -> dict:
    """
    Score 0–100. >= 50 means exhaustion signal is present.

    Check 1: How many consecutive D1 structure labels in trend direction
             Long run = trend getting tired
    Check 2: Is price within 1% of the highest high or lowest low in dataset
             Reaching extremes = big reversal potential
    Check 3: Last 3 D1 candles have small bodies + wicks opposing trend
             Distribution / absorption = institutional exit
    Check 4: Price within 30 pips of a major round number
             Round numbers = liquidity traps
    """
    score  = 0
    detail = []

    try:
        # Check 1 — Trend run length
        bull_labels = {"HH", "HL"}
        bear_labels = {"LH", "LL"}
        run_count = 0
        for lbl in reversed(labels_d1):
            tag = lbl.get("label", "")
            if is_bull and tag in bull_labels:
                run_count += 1
            elif not is_bull and tag in bear_labels:
                run_count += 1
            else:
                break

        if run_count >= 12:
            score += 30
            detail.append(f"long run {run_count} labels")
        elif run_count >= 8:
            score += 18
            detail.append(f"run {run_count} labels")
        elif run_count >= 5:
            score += 8
            detail.append(f"run {run_count} labels")

        # Check 2 — Price at period extreme
        try:
            period_hi = float(max(df_d1["high"].values))   # type: ignore
            period_lo = float(min(df_d1["low"].values))    # type: ignore

            if is_bull:
                dist = (period_hi - current_price) / current_price
                if dist <= 0.003:
                    score += 35
                    detail.append(f"at period high {round(period_hi, 3)}")
                elif dist <= 0.008:
                    score += 15
                    detail.append("approaching period high")
            else:
                dist = (current_price - period_lo) / current_price
                if dist <= 0.003:
                    score += 35
                    detail.append(f"at period low {round(period_lo, 3)}")
                elif dist <= 0.008:
                    score += 15
                    detail.append("approaching period low")
        except Exception:
            pass

        # Check 3 — Candle exhaustion pattern
        try:
            recent = df_d1.tail(3)   # type: ignore
            exh_count = 0
            for _, row in recent.iterrows():
                body = abs(float(row["close"]) - float(row["open"]))
                rng  = float(row["high"]) - float(row["low"])
                if rng == 0:
                    continue
                if body / rng < 0.40:
                    upper_wick = float(row["high"]) - max(float(row["open"]), float(row["close"]))
                    lower_wick = min(float(row["open"]), float(row["close"])) - float(row["low"])
                    if is_bull and upper_wick > lower_wick:
                        exh_count += 1
                    if not is_bull and lower_wick > upper_wick:
                        exh_count += 1
            if exh_count >= 2:
                score += 25
                detail.append(f"{exh_count}/3 exhaustion candles")
            elif exh_count == 1:
                score += 10
                detail.append("1 exhaustion candle")
        except Exception:
            pass

        # Check 4 — Round number trap
        try:
            pip = _pip(current_price)
            if current_price > 10_000:    step = 1_000.0   # Crypto — BTC respects $1000 round numbers
            elif current_price > 500:     step = 50.0      # Gold — respects $50 round numbers
            elif current_price > 50:      step = 5.0       # JPY pairs
            else:                         step = 0.05      # Standard FX
            nearest = round(current_price / step) * step
            dist_pips = abs(current_price - nearest) / pip
            if dist_pips <= 30:
                score += 10
                detail.append(f"round number {round(nearest, 3)} ({round(dist_pips)}p away)")
        except Exception:
            pass

    except Exception as e:
        log.debug(f"[AutoTrade] Exhaustion check error: {e}")

    return {
        "exhaustion_score":  min(score, 100),
        "exhaustion_signal": score >= 50,
        "exhaustion_detail": " · ".join(detail) if detail else "none",
    }
def _calc_lots(symbol: str, entry: float, sl: float, current_price: float) -> float:
    """
    Risk 1% of a nominal $10,000 account per trade.
    Lot sizing is instrument-aware: BTC and Gold have very different pip values.
    Replace ACCOUNT_BALANCE with your real account size or make it configurable.
    """
    ACCOUNT_BALANCE = 10_000.0
    RISK_PCT        = 0.01          # 1% risk per trade
    risk_cash       = ACCOUNT_BALANCE * RISK_PCT   # e.g. $100

    pip   = _pip(current_price)
    sl_pips = abs(entry - sl) / pip
    if sl_pips <= 0:
        return 0.02

    # Approximate pip value per lot (USD per pip per standard lot)
    if "BTC" in symbol:    pip_value_per_lot = 1.0    # $1 per pip per lot (1 BTC contract)
    elif "XAU" in symbol:  pip_value_per_lot = 10.0   # $1 per 0.1 pip × 100oz = $10/pip/lot
    elif "JPY" in symbol:  pip_value_per_lot = 9.0    # approx $9/pip/lot at current JPY rates
    else:                  pip_value_per_lot = 10.0   # standard FX: $10/pip/standard lot

    lots = risk_cash / (sl_pips * pip_value_per_lot)
    # Clamp to broker limits
    lots = max(0.01, min(round(lots, 2), 0.5))
    return lots

# ── Core evaluation for one pair ──────────────────────────────────────────────

async def _evaluate_pair(symbol: str) -> dict:
    """Full top-down evaluation. Returns a status dict. Never raises."""
    try:
        # ── STEP 1: D1 direction (the law) ───────────────────────────────────
        try:
            df_d1 = await fetch_ohlc(symbol, "d1", 500)
        except ValueError:
            return {"status": "WAITING", "reason": "No D1 data from MT5 yet", "symbol": symbol}

        swings_d1     = detect_swings(df_d1, fractal_n=3)
        labels_d1     = classify_structure(swings_d1)
        trend_d1_data = detect_trend(labels_d1)
        d1_dir        = trend_d1_data.get("trend", "neutral")
        current_price = float(df_d1["close"].iloc[-1])
        pip           = _pip(current_price)
        is_bull       = d1_dir == "bullish"

        if d1_dir == "neutral":
            return {
                "status": "NEUTRAL",
                "reason": "D1 trend neutral — no direction, no trade",
                "symbol": symbol,
                "price":  current_price,
            }

        # D1 swing origin (used for TP)
        d1_hi: Optional[float] = None
        d1_lo: Optional[float] = None
        for lbl in reversed(labels_d1):
            tag = lbl.get("label", "")
            if tag in ("HH", "LH", "EQH") and d1_hi is None:
                d1_hi = float(lbl["price"])
            if tag in ("HL", "LL", "EQL") and d1_lo is None:
                d1_lo = float(lbl["price"])
            if d1_hi and d1_lo:
                break

        # Exhaustion check (runs while we have D1 data)
        exhaustion = _check_exhaustion(df_d1, labels_d1, current_price, is_bull)

        # ── STEP 2: 4H CHoCH (momentum confirmation) ─────────────────────────
        try:
            df_4h = await fetch_ohlc(symbol, "4h", 300)
        except ValueError:
            return {
                "status": "WAITING",
                "reason": "No 4H data from MT5 yet",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }

        swings_4h     = detect_swings(df_4h, fractal_n=3)
        labels_4h     = classify_structure(swings_4h)
        trend_4h_data = detect_trend(labels_4h)
        choch_4h      = detect_choch(
            df_4h, swings_4h, labels_4h,
            trend_4h_data.get("trend", "neutral"),
            lookback_hours=336, fractal_n=3,
        )

        latest_4h_choch = choch_4h[-1] if choch_4h else None
        choch_aligned   = (
            latest_4h_choch is not None
            and latest_4h_choch["direction"] == d1_dir
        )

        if not choch_aligned:
            return {
                "status": "WATCHING",
                "reason": f"D1 {d1_dir} ✓ — waiting for 4H CHoCH in same direction",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }
                        # BUG-035: check no subsequent 4H BOS in the opposite direction has invalidated the CHoCH
        bos_4h = detect_bos(
            df_4h, swings_4h, labels_4h,
            trend_4h_data.get("trend", "neutral"),
            lookback_hours=336, fractal_n=3,
        )
        choch_dir = latest_4h_choch.get("direction")
        invalidating_bos = [
            b for b in bos_4h
            if b["direction"] != choch_dir
            and b["time"] > latest_4h_choch["time"]
        ]
        if invalidating_bos:
            return {
                "status": "WATCHING",
                "reason": f"4H CHoCH invalidated by subsequent 4H BOS {invalidating_bos[-1]['direction']}",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }

        from services.mt5_store import get_latest_timestamp as _broker_now
        _now = _broker_now() or int(time.time())
        choch_age_h = (_now - latest_4h_choch["time"]) / 3600
        if choch_age_h > 48:
            return {
                "status": "WATCHING",
                "reason": f"D1 {d1_dir} ✓ — 4H CHoCH too old ({choch_age_h:.0f}h, need < 48h)",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }

        # ── STEP 3: 1H entry zone ────────────────────────────────────────────
        try:
            df_1h = await fetch_ohlc(symbol, "1h", 300)
        except ValueError:
            return {
                "status": "WAITING",
                "reason": "No 1H data from MT5 yet",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }

        candles_1h = candles_to_dict(df_1h)
        obs_1h     = detect_order_blocks(candles_1h, current_price, "1h")
        ob_1h      = next((o for o in obs_1h if o["type"] == d1_dir), None)

        swings_1h     = detect_swings(df_1h, fractal_n=3)
        labels_1h     = classify_structure(swings_1h)
        trend_1h_data = detect_trend(labels_1h)
        choch_1h      = detect_choch(
            df_1h, swings_1h, labels_1h,
            trend_1h_data.get("trend", "neutral"),
            lookback_hours=72, fractal_n=3,
        )
        latest_1h_choch = choch_1h[-1] if choch_1h else None
        choch_1h_valid  = (
            latest_1h_choch is not None
            and latest_1h_choch["direction"] == d1_dir
            and (_now - latest_1h_choch["time"]) < 8 * 3600
        )

        entry_p: Optional[float] = None
        entry_source = "none"

        if ob_1h:
            entry_p      = round((ob_1h["top"] + ob_1h["bottom"]) / 2, 5)
            entry_source = "1H OB"
        elif choch_1h_valid:
            entry_p      = round(float(latest_1h_choch["price"]), 5)
            entry_source = "1H CHoCH"

        # Verify 1H structure is not actively opposing the trade direction.
        # If 1H is clearly in the opposite direction, the OB/CHoCH entry is
        # inside a broken structure — skip until 1H realigns.
        trend_1h = trend_1h_data.get("trend", "neutral")
        opposing = (is_bull and trend_1h == "bearish") or (not is_bull and trend_1h == "bullish")
        if opposing:
            return {
                "status": "WATCHING",
                "reason": f"D1 {d1_dir} ✓  4H CHoCH ✓ — 1H structure ({trend_1h}) conflicts, waiting for realignment",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }
        if entry_p is None:
            return {
                "status": "WATCHING",
                "reason": f"D1 {d1_dir} ✓  4H CHoCH ✓ — waiting for 1H entry zone",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                **exhaustion,
            }

        # ── STEP 4: Structural SL ────────────────────────────────────────────
        # Minimum SL distance — a D1-based trade needs room to breathe.
        # Skip any structural swing that is too close to give a meaningful SL.
        MIN_SL_PIPS = 15
        sl_p: Optional[float] = None

        if is_bull:
            # Walk back through HLs — use the first one that gives >= MIN_SL_PIPS
            hl_cands = [l for l in labels_1h if l.get("label") in ("HL", "EQL")]
            for cand in reversed(hl_cands):
                cand_sl = round(float(cand["price"]) - 3 * pip, 5)
                if (entry_p - cand_sl) >= MIN_SL_PIPS * pip:
                    sl_p = cand_sl
                    break
        else:
            # Walk back through LHs — use the first one that gives >= MIN_SL_PIPS
            lh_cands = [l for l in labels_1h if l.get("label") in ("LH", "EQH")]
            for cand in reversed(lh_cands):
                cand_sl = round(float(cand["price"]) + 3 * pip, 5)
                if (cand_sl - entry_p) >= MIN_SL_PIPS * pip:
                    sl_p = cand_sl
                    break

        # Fallback 1 — OB boundary if no valid swing found
        if sl_p is None and ob_1h:
            sl_p = round(
                ob_1h["bottom"] - MIN_SL_PIPS * pip if is_bull
                else ob_1h["top"] + MIN_SL_PIPS * pip,
                5,
            )

        # Fallback 2 — hard minimum distance
        if sl_p is None:
            sl_p = round(
                entry_p - MIN_SL_PIPS * pip if is_bull
                else entry_p + MIN_SL_PIPS * pip,
                5,
            )

        # Final hard safety — can never be less than MIN_SL_PIPS no matter what
        if is_bull and (entry_p - sl_p) < MIN_SL_PIPS * pip:
            sl_p = round(entry_p - MIN_SL_PIPS * pip, 5)
        if not is_bull and (sl_p - entry_p) < MIN_SL_PIPS * pip:
            sl_p = round(entry_p + MIN_SL_PIPS * pip, 5)

        # ── STEP 5: TP from D1 swing origin ─────────────────────────────────
        tp_p: Optional[float] = None
        if is_bull and d1_hi and d1_hi > entry_p:
            tp_p = round(d1_hi, 5)
        elif not is_bull and d1_lo and d1_lo < entry_p:
            tp_p = round(d1_lo, 5)
        if tp_p is None:
            if   "BTC" in symbol: fb = 2000 * pip   # BTC: 2000 × $1.00 = $2000 fallback TP
            elif "XAU" in symbol: fb = 300  * pip   # Gold: 300 × $0.10 = $30 fallback TP
            elif "JPY" in symbol: fb = 80   * pip   # JPY: 80 pips
            else:                 fb = 50   * pip   # Standard FX: 50 pips
            tp_p = round(entry_p + fb if is_bull else entry_p - fb, 5)

        # ── STEP 6: R:R check ────────────────────────────────────────────────
        risk   = abs(entry_p - sl_p)
        reward = abs(tp_p   - entry_p)
        rr     = round(reward / risk, 1) if risk > 0 else 0.0

        if rr < 1.5:
            return {
                "status": "WATCHING",
                "reason": f"D1 ✓  4H CHoCH ✓  {entry_source} ✓  R:R {rr} too low (need ≥ 1.5)",
                "symbol": symbol, "d1": d1_dir, "price": current_price,
                "entry": entry_p, "sl": sl_p, "tp": tp_p, "rr": rr,
                **exhaustion,
            }

        # ── READY ─────────────────────────────────────────────────────────────
        signal_id = f"{symbol}_{d1_dir}_{latest_4h_choch['time']}"
        exh_tag   = f"  ⚡ EXHAUSTION {exhaustion['exhaustion_score']}" if exhaustion["exhaustion_signal"] else ""
        return {
            "status":            "READY",
            "reason":            f"D1 {d1_dir} ✓  4H CHoCH ✓  {entry_source} ✓  R:R {rr}{exh_tag}",
            "symbol":            symbol,
            "d1":                d1_dir,
            "direction":         "BUY" if is_bull else "SELL",
            "entry":             entry_p,
            "sl":                sl_p,
            "tp":                tp_p,
            "rr":                rr,
            "entry_source":      entry_source,
            "signal_id":         signal_id,
            "price":             current_price,
            **exhaustion,
        }

    except Exception as e:
        log.exception(f"[AutoTrade] Eval error for {symbol}: {e}")
        return {"status": "ERROR", "reason": str(e), "symbol": symbol}


# ── Background loop ────────────────────────────────────────────────────────────

async def _run_loop() -> None:
    global _pair_status, _trade_log, _fired_ids
    log.info("[AutoTrade] Engine started")

    while _enabled:
        for symbol in PAIRS:
            if not _enabled:
                break
            result = await _evaluate_pair(symbol)
            _pair_status[symbol] = {**result, "evaluated_at": int(time.time())}

            if result.get("status") == "READY":
                sid = result.get("signal_id", "")
                if sid and sid not in _fired_ids:
                    _fired_ids.add(sid)
                    _fired_times[sid] = time.time()
                    entry = {**result, "fired_at": int(time.time()), "paper_mode": _paper_mode}
                    _trade_log.insert(0, entry)
                    if len(_trade_log) > 50:
                        _trade_log.pop()
                    if not _paper_mode:
                        try:
                            from routers.trading import queue_order
                            order_id = queue_order({
                                "symbol":     symbol,
                                "direction":  result["direction"],
                                "order_type": "LIMIT",
                                "price":      result["entry"],
                                "sl":         result["sl"],
                                "tp":         result["tp"],
                                "lots":       _calc_lots(symbol, result["entry"], result["sl"], result["price"]),
                                "comment":    "STRUCT.ai-Auto",
                            })
                            _pair_status[symbol]["order_id"] = order_id
                            log.info(f"[AutoTrade] LIVE order: {symbol} {result['direction']} id={order_id}")
                        except Exception as e:
                            log.error(f"[AutoTrade] Failed to queue order: {e}")
                    else:
                        log.info(f"[AutoTrade] PAPER: {symbol} {result['direction']} entry={result['entry']} R:R={result['rr']}")

                # Prune stale IDs — runs every cycle
                now_t   = time.time()
                expired = [k for k, v in _fired_times.items() if now_t - v > _FIRED_TTL_S]
                for k in expired:
                    _fired_ids.discard(k)
                    del _fired_times[k]

        if _enabled:
            await asyncio.sleep(60)

    log.info("[AutoTrade] Engine stopped")


def start_engine() -> None:
    global _bg_task
    if _bg_task and not _bg_task.done():
        return
    _bg_task = asyncio.ensure_future(_run_loop())


def stop_engine() -> None:
    global _bg_task
    if _bg_task:
        _bg_task.cancel()
        _bg_task = None