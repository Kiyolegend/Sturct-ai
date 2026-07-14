"""
Data Collection Router — runs collect_history.py as a managed background job.

Endpoints:
  POST /collect/refresh  — fetch only missing bars since last stored (fast, ~30s)
  POST /collect/full     — fetch all history from scratch (slow, ~5 min)
  GET  /collect/status   — current job state + recent log lines
  GET  /collect/stats    — bar counts + date ranges per symbol×TF from SQLite
"""

import os
import sys
import sqlite3
import subprocess
import threading
import time

from fastapi import APIRouter, HTTPException
from services.db import DB_PATH

router = APIRouter()

# ── Single shared job state (one collection at a time) ─────────────────────────

_lock = threading.Lock()
_state: dict = {
    "running":      False,
    "mode":         None,    # "refresh" | "full"
    "log":          [],      # up to 300 recent lines
    "done":         False,
    "error":        None,
    "started_at":   None,
    "finished_at":  None,
}

# Path to the script (routers/ → .. → scripts/)
_SCRIPT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "scripts", "collect_history.py")
)
# Working dir for the subprocess (trading-api root)
_WORKDIR = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))


def _append_log(line: str) -> None:
    with _lock:
        _state["log"].append(line)
        if len(_state["log"]) > 300:
            _state["log"] = _state["log"][-300:]


def _run_collect(mode: str) -> None:
    """Runs in a background daemon thread — does NOT block the API."""
    cmd = [sys.executable, _SCRIPT]
    if mode == "refresh":
        cmd.append("--refresh")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=_WORKDIR,
        )
        for line in proc.stdout:
            _append_log(line.rstrip())
        proc.wait()

        with _lock:
            _state["running"]     = False
            _state["done"]        = True
            _state["finished_at"] = time.time()
            _state["error"] = (
                None if proc.returncode == 0
                else f"Script exited with code {proc.returncode}"
            )

        # Bust the entire in-memory analysis cache so next request recomputes fresh
        from services.structure_cache import invalidate_all
        invalidate_all()

    except Exception as exc:
        _append_log(f"ERROR: {exc}")
        with _lock:
            _state["running"]     = False
            _state["done"]        = True
            _state["error"]       = str(exc)
            _state["finished_at"] = time.time()


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/collect/refresh")
async def start_refresh():
    """Start a --refresh collection: only fetches bars newer than last stored."""
    with _lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="Collection already running")
        _state.update(running=True, mode="refresh", log=[],
                      done=False, error=None,
                      started_at=time.time(), finished_at=None)

    threading.Thread(target=_run_collect, args=("refresh",), daemon=True).start()
    return {"started": True, "mode": "refresh"}


@router.post("/collect/full")
async def start_full():
    """Start a full collection: fetches all history from scratch (slow ~5 min)."""
    with _lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="Collection already running")
        _state.update(running=True, mode="full", log=[],
                      done=False, error=None,
                      started_at=time.time(), finished_at=None)

    threading.Thread(target=_run_collect, args=("full",), daemon=True).start()
    return {"started": True, "mode": "full"}


@router.get("/collect/status")
async def get_status():
    """Return current job state + recent log lines."""
    with _lock:
        return {
            "running":     _state["running"],
            "mode":        _state["mode"],
            "done":        _state["done"],
            "error":       _state["error"],
            "log":         list(_state["log"]),
            "started_at":  _state["started_at"],
            "finished_at": _state["finished_at"],
        }


@router.get("/collect/stats")
async def get_stats():
    """Return bar counts and date ranges per symbol×TF from SQLite."""
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute("""
            SELECT symbol, timeframe,
                   COUNT(*)   AS bars,
                   MIN(ts)    AS first_ts,
                   MAX(ts)    AS last_ts
            FROM ohlcv
            GROUP BY symbol, timeframe
            ORDER BY symbol, timeframe
        """).fetchall()
    finally:
        conn.close()

    return {
        "stats": [
            {
                "symbol":    r[0],
                "timeframe": r[1],
                "bars":      r[2],
                "first_ts":  r[3],
                "last_ts":   r[4],
            }
            for r in rows
        ]
    }