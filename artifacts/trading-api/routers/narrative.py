"""
Narrative router — GET /trading-api/narrative?symbol=USD/JPY

Pulls multi-timeframe analysis from existing engines and returns a plain-English
market narrative. All heavy lifting is done by the narrative_engine service.
"""

from __future__ import annotations
import asyncio
import os
import time
import requests
import threading
from collections import deque



from fastapi import APIRouter, HTTPException, Query


from services.data_service import fetch_ohlc
from services.zigzag_engine import detect_swings
from services.structure_engine import classify_structure
from services.trend_engine import detect_trend
from services.bos_engine import detect_bos
from services.choch_engine import detect_choch
from services.zones_engine import detect_zones
from services.mtf_sr_engine import compute_mtf_sr_levels
from services.session_engine import compute_sessions
from services.narrative_engine import generate_narrative, build_environment

router = APIRouter()

NEWS_SERVICE_URL = os.environ.get("NEWS_SERVICE_URL", "http://localhost:5003")

PIP_SIZES: dict[str, float] = {
    "USD/JPY": 0.01,  "EUR/JPY": 0.01,  "GBP/JPY": 0.01,
    "EUR/USD": 0.0001, "GBP/USD": 0.0001, "AUD/USD": 0.0001,
    "USD/CAD": 0.0001, "USD/CHF": 0.0001,
}

# ── In-memory environment history (for shift detection) ──────────────────────
# Stores last 30 snapshots per symbol: {"USD/JPY": deque([{...}, {...}], maxlen=30)}
_env_history: dict[str, deque] = {}
_env_lock = threading.Lock()
SCAN_SYMBOLS = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"]




def _get_news_status(symbol: str) -> tuple[bool, str]:
    """Returns (blocked, reason) from the Repo 3 news service. Fails silently."""
    try:
        r = requests.get(
            f"{NEWS_SERVICE_URL}/api/impact/symbol",
            params={"pair": symbol},
            timeout=2,
        )
        data = r.json()
        return bool(data.get("blocked")), data.get("reason", "")
    except Exception:
        return False, ""


async def _analyse_timeframe(symbol: str, interval: str, outputsize: int) -> dict:
    """Fetch + run the full analysis pipeline for one timeframe. Returns a result dict."""
    try:
        df = await fetch_ohlc(symbol=symbol, interval=interval, outputsize=outputsize)
        if df is None or len(df) < 5:
            return {}
        fractal_n     = 3 if interval in ("1h", "4h") else 5
        swings        = detect_swings(df, fractal_n=fractal_n)
        labels        = classify_structure(swings)
        trend         = detect_trend(labels)
        bos           = detect_bos(df, swings, labels, trend["trend"])
        choch         = detect_choch(df, swings, labels, trend["trend"])
        zones         = detect_zones(swings, interval, float(df["close"].iloc[-1]))
        return {
            "df":     df,
            "trend":  trend,
            "bos":    bos,
            "choch":  choch,
            "zones":  zones,
            "price":  float(df["close"].iloc[-1]),
        }
    except Exception:
        return {}


@router.get("/narrative")
async def get_narrative(symbol: str = Query(default="USD/JPY")):
    """
    Returns a full plain-English market narrative for the selected symbol.
    Updates automatically when symbol changes on the dashboard.
    """
    pip_size = PIP_SIZES.get(symbol, 0.0001)

    # ── Fetch all 4 timeframes in parallel ───────────────────────────────────
    results = await asyncio.gather(
        _analyse_timeframe(symbol, "4h",  100),
        _analyse_timeframe(symbol, "1h",  200),
        _analyse_timeframe(symbol, "15m", 200),
        _analyse_timeframe(symbol, "5m",  300),
    )
    r4h, r1h, r15m, r5m = results

    current_price = (
        r5m.get("price") or r15m.get("price") or
        r1h.get("price") or r4h.get("price")
    )
    if not current_price:
        raise HTTPException(status_code=503, detail=f"No data available for {symbol}")

    # ── Extract analysis fields ───────────────────────────────────────────────
    bias_4h  = (r4h.get("trend")  or {}).get("trend",  "neutral")
    bias_1h  = (r1h.get("trend")  or {}).get("trend",  "neutral")
    bias_15m = (r15m.get("trend") or {}).get("trend",  "neutral")

    bos_5m    = r5m.get("bos",   []) or []
    bos_15m   = r15m.get("bos",  []) or []
    choch_5m  = r5m.get("choch", []) or []
    choch_15m = r15m.get("choch",[]) or []

    all_zones = (r5m.get("zones") or []) + (r15m.get("zones") or []) + (r1h.get("zones") or [])

    # ── S/R levels (multi-TF) ─────────────────────────────────────────────────
    sr_levels: list[dict] = []
    try:
        df_map: dict = {}
        for key, res in [("4h", r4h), ("1h", r1h), ("15m", r15m)]:
            df = res.get("df")
            if df is not None and len(df) > 0:
                df_map[key] = df
        if df_map:
            sr_levels = compute_mtf_sr_levels(df_map)
    except Exception:
        pass

    # ── Active sessions from 1H data ──────────────────────────────────────────
    active_sessions: list[str] = []
    try:
        df_1h = r1h.get("df")
        if df_1h is not None and len(df_1h) > 0:
            all_sess = compute_sessions(df_1h)
            now_ts   = int(time.time())
            active_sessions = [
                s["session"]
                for s in all_sess
                if s.get("start_time", 0) <= now_ts <= s.get("end_time", 0) + 3600
            ]
    except Exception:
        pass

    # ── News status ───────────────────────────────────────────────────────────
    news_blocked, news_reason = _get_news_status(symbol)

    # ── Generate narrative ────────────────────────────────────────────────────
    narrative = generate_narrative(
        symbol=symbol,
        current_price=current_price,
        pip_size=pip_size,
        bias_4h=bias_4h,
        bias_1h=bias_1h,
        bias_15m=bias_15m,
        bos_5m=bos_5m,
        bos_15m=bos_15m,
        choch_5m=choch_5m,
        choch_15m=choch_15m,
        zones=all_zones,
        sr_levels=sr_levels,
        sessions=active_sessions,
        news_blocked=news_blocked,
        news_reason=news_reason,
    )

    return narrative

@router.get("/pair-sweep")
async def get_pair_sweep():
    """
    Returns Scalp + Limit environment for all 5 scanned pairs in parallel.
    Also detects environment shifts vs the previous snapshot.
    """
    async def _evaluate_one(symbol: str) -> tuple[str, dict]:
        pip_size = PIP_SIZES.get(symbol, 0.0001)
        try:
            results = await asyncio.gather(
                _analyse_timeframe(symbol, "4h",  80),
                _analyse_timeframe(symbol, "1h",  150),
                _analyse_timeframe(symbol, "15m", 150),
                _analyse_timeframe(symbol, "5m",  200),
            )
            r4h, r1h, r15m, r5m = results
            current_price = (
                r5m.get("price") or r15m.get("price") or
                r1h.get("price") or r4h.get("price")
            )
            if not current_price:
                return symbol, {"error": "no data"}
            bias_4h  = (r4h.get("trend")  or {}).get("trend",  "neutral")
            bias_1h  = (r1h.get("trend")  or {}).get("trend",  "neutral")
            bias_15m = (r15m.get("trend") or {}).get("trend",  "neutral")
            bos_5m   = r5m.get("bos",    []) or []
            choch_15m = r15m.get("choch", []) or []
            sr_levels: list[dict] = []
            try:
                df_map = {}
                for key, res in [("4h", r4h), ("1h", r1h), ("15m", r15m)]:
                    df = res.get("df")
                    if df is not None and len(df) > 0:
                        df_map[key] = df
                if df_map:
                    from services.mtf_sr_engine import compute_mtf_sr_levels
                    sr_levels = compute_mtf_sr_levels(df_map)
            except Exception:
                pass

            try:
                _df = r5m.get("df") or r15m.get("df") or r1h.get("df")
                broker_ts = int(_df.iloc[-1]["time"].timestamp()) if _df is not None and len(_df) > 0 else int(time.time())
            except Exception:
                broker_ts = int(time.time())

            active_sessions: list[str] = []
            try:
                from services.session_engine import compute_sessions
                df_1h = r1h.get("df")
                if df_1h is not None and len(df_1h) > 0:
                    all_sess = compute_sessions(df_1h)
                    
                    active_sessions = [
                        s["session"] for s in all_sess
                        if s.get("start_time", 0) <= broker_ts <= s.get("end_time", 0) + 300
                    ]
            except Exception:
                pass
            news_blocked, news_reason = _get_news_status(symbol)
            env = build_environment(
                current_price=current_price,
                pip_size=pip_size,
                bias_4h=bias_4h,
                bias_1h=bias_1h,
                bias_15m=bias_15m,
                bos_5m=bos_5m,
                choch_15m=choch_15m,
                sr_levels=sr_levels,
                sessions=active_sessions,
                news_blocked=news_blocked,
                news_reason=news_reason,
                broker_ts=float(broker_ts),
            )
            env["price"] = current_price
            env["symbol"] = symbol
            return symbol, env
        except Exception as e:
            return symbol, {"error": str(e)}
    # Run all 5 pairs in parallel
    tasks = [_evaluate_one(sym) for sym in SCAN_SYMBOLS]
    results = await asyncio.gather(*tasks)
    pairs: dict[str, dict] = {}
    shifts: list[dict] = []
    with _env_lock:
        for symbol, env in results:
            if "error" in env:
                pairs[symbol] = env
                continue
            pairs[symbol] = env
            # ── Shift detection ───────────────────────────────────────────────
            if symbol not in _env_history:
                _env_history[symbol] = deque(maxlen=30)
            history = _env_history[symbol]
            if history:
                prev = history[-1]
                if prev.get("scalp") != env.get("scalp"):
                    shifts.append({
                        "symbol":    symbol,
                        "type":      "scalp",
                        "from":      prev["scalp"],
                        "to":        env["scalp"],
                        "reason":    env["scalp_reason"],
                        "timestamp": int(time.time()),
                    })
                if prev.get("limit") != env.get("limit"):
                    shifts.append({
                        "symbol":    symbol,
                        "type":      "limit",
                        "from":      prev["limit"],
                        "to":        env["limit"],
                        "reason":    env["limit_reason"],
                        "timestamp": int(time.time()),
                    })
            _env_history[symbol].append({
                "scalp":     env.get("scalp"),
                "limit":     env.get("limit"),
                "timestamp": int(time.time()),
            })
    return {
        "pairs":     pairs,
        "shifts":    shifts,
        "timestamp": int(time.time()),
    }
@router.get("/environment-history")
async def get_environment_history(symbol: str = Query(default="USD/JPY")):
    """Returns the last 30 environment snapshots for shift trend display."""
    with _env_lock:
        history = list(_env_history.get(symbol, []))
    return {"symbol": symbol, "history": history}


