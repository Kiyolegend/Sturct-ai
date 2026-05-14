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
"""

import pandas as pd
from zoneinfo import ZoneInfo          
from datetime import datetime as _dt   


# (session_name, start_hour_utc_inclusive, end_hour_utc_exclusive)
def _live_sessions():
    """Return session UTC hours adjusted for live DST offsets."""
    lo = int(_dt.now(ZoneInfo("Europe/London")).utcoffset().total_seconds() // 3600)
    ny = int(_dt.now(ZoneInfo("America/New_York")).utcoffset().total_seconds() // 3600)
    return [
        ("asian",  0,       9      ),
        ("london", 8  - lo, 17 - lo),
        ("ny",     8  - ny, 17 - ny),
    ]


def compute_sessions(df: pd.DataFrame, max_per_session: int = 5) -> list[dict]:
    """
    Given an OHLC DataFrame with UTC timestamps, return the most recent
    completed and in-progress trading sessions.

    Each returned dict:
      session    : "asian" | "london" | "ny"
      start_time : unix timestamp of first candle in session
      end_time   : unix timestamp of last candle in session (or current if ongoing)
      high       : highest wick price within the session
      low        : lowest  wick price within the session
    """
    times = pd.to_datetime(df["time"], utc=True)

    all_sessions: list[dict] = []

    for session_name, start_h, end_h in _live_sessions():
        mask = (times.dt.hour >= start_h) & (times.dt.hour < end_h)
        session_df = df[mask].copy()
        session_times = times[mask]

        if session_df.empty:
            continue

        session_df["_date"] = session_times.dt.date

        for date, group in session_df.groupby("_date"):
            if len(group) < 2:
                continue

            g_times = session_times[group.index]

            all_sessions.append({
                "session":    session_name,
                "start_time": int(g_times.min().timestamp()),
                "end_time":   int(g_times.max().timestamp()),
                "high":       round(float(group["high"].max()), 5),
                "low":        round(float(group["low"].min()),  5),
            })

    # Sort chronologically
    all_sessions.sort(key=lambda x: x["start_time"])

    # Keep most recent max_per_session per session type
    per_type: dict[str, list] = {"asian": [], "london": [], "ny": []}
    for row in reversed(all_sessions):
        stype = row["session"]
        if len(per_type[stype]) < max_per_session:
            per_type[stype].append(row)

    merged = []
    for lst in per_type.values():
        merged.extend(lst)

    return sorted(merged, key=lambda x: x["start_time"])
