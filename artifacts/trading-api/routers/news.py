"""
Proxy router — fetches news impact data from struct-news-impact (Repo 3)
and exposes it to the React dashboard via /trading-api/news-status.
"""

import os
import requests
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

NEWS_SERVICE_URL = os.environ.get("NEWS_SERVICE_URL", "http://localhost:5003")


def _call_news(path: str, params: dict | None = None) -> dict | list | None:
    """Call Repo 3. Returns None on any connection/timeout error."""
    try:
        resp = requests.get(f"{NEWS_SERVICE_URL}{path}", params=params, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


@router.get("/news-status")
def news_status():
    """
    Combined news status for the dashboard.
    Calls Repo 3 /api/impact/now and /api/impact/upcoming, merges into one response.
    """
    now_data     = _call_news("/api/impact/now")
    upcoming_raw = _call_news("/api/impact/upcoming", params={"hours": 4})

    service_ok = now_data is not None

    per_pair: dict = {}
    if now_data:
        for pair, info in now_data.items():
            penalty = info.get("confidence_penalty", 0)
            level   = info.get("impact_level", 0)
            blocked = info.get("blocked", False)
            reason  = info.get("reason", "")

            if blocked or penalty >= 100:
                status = "BLOCKED"
            elif penalty >= 30:
                status = "CAUTION"
            else:
                status = "CLEAR"

            per_pair[pair] = {
                "status":             status,
                "impact_level":       level,
                "confidence_penalty": penalty,
                "reason":             reason,
                "blocked":            blocked,
            }

    upcoming: list = []
    if upcoming_raw:
        upcoming = upcoming_raw.get("events", [])

    return JSONResponse(content={
        "service_ok": service_ok,
        "per_pair":   per_pair,
        "upcoming":   upcoming,
    })