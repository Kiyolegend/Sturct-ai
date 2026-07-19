"""
Session Engine.

Identifies Asian, London, and New York trading sessions from OHLC candle data.
Uses real Forex market open/close times (UTC):

  Asian (Tokyo) →  00:00 – 09:00 UTC  (PKT: 05:00 – 14:00)
  London        →  08:00 – 17:00 UTC  (PKT: 13:00 – 22:00)
  New York      →  13:00 – 22:00 UTC  (PKT: 18:00 – 03:00)

Natural overlaps this creates:
  Asian / London overlap  →  08:00 – 09:00 UTC  (1 hour)
  London / NY overlap     →  13:00 – 17:00 UTC  (4 hours)

For each session found in the candle data, returns:
  {session, start_time, end_time, high, low}

The high/low is computed from the actual candle wicks within the session hours.
Both complete (past) and the current in-progress session are returned.
NOTE: DST is handled per-day via _session_hours_for_ts(). Session attribution
near a DST boundary may be off by ±1 hour — negligible for live scalping but
relevant for historical backtesting.
"""

import pandas as pd
from zoneinfo import ZoneInfo
from datetime import datetime as _dt


def _session_hours_for_ts(ts) -> list[tuple]:
    """
    Return (session_name, start_hour_utc, end_hour_utc) tuples for the day
    that contains `ts`, adjusted for US DST so NY open/close are correct.
    """
    try:
        ny_offset = ts.astimezone(ZoneInfo("America/New_York")).utcoffset().total_seconds() / 3600
    except Exception:
        ny_offset = -5  # fallback to EST (winter)

    # EST (winter, UTC-5): NY opens 13:00 UTC, closes 22:00 UTC
    # EDT (summer, UTC-4): NY opens 12:00 UTC, closes 21:00 UTC
    ny_start = 13 if ny_offset == -5 else 12
    ny_end   = 22 if ny_offset == -5 else 21

    return [
        ("asian",  0,        9      ),
        ("london", 8,        17     ),
        ("ny",     ny_start, ny_end ),
    ]


def compute_sessions(df: pd.DataFrame, max_per_session: int = 5) -> list[dict]:
    times = pd.to_datetime(df["time"], utc=True)
    df = df.copy()
    df["_utc_time"] = times
    df["_date"]     = times.dt.date

    all_sessions: list[dict] = []

    for date, day_group in df.groupby("_date"):
        representative_ts = day_group["_utc_time"].iloc[0]
        sessions = _session_hours_for_ts(representative_ts)

        for session_name, start_h, end_h in sessions:
            mask  = (day_group["_utc_time"].dt.hour >= start_h) & \
                    (day_group["_utc_time"].dt.hour <  end_h)
            group = day_group[mask]
            if len(group) < 2:
                continue
            g_times = group["_utc_time"]
            all_sessions.append({
                "session":    session_name,
                "start_time": int(g_times.min().timestamp()),
                "end_time":   int(g_times.max().timestamp()),
                "high":       round(float(group["high"].max()), 5),
                "low":        round(float(group["low"].min()),  5),
            })

    all_sessions.sort(key=lambda x: x["start_time"])

    per_type: dict[str, list] = {"asian": [], "london": [], "ny": []}
    for row in reversed(all_sessions):
        stype = row["session"]
        if len(per_type[stype]) < max_per_session:
            per_type[stype].append(row)

    merged = []
    for lst in per_type.values():
        merged.extend(lst)
    return sorted(merged, key=lambda x: x["start_time"])