import os
import asyncio
import httpx
import pandas as pd
import time

from services.mt5_store import get_candles as mt5_get_candles

TWELVE_DATA_BASE = "https://api.twelvedata.com"
TWELVE_DATA_KEY = os.environ.get("TWELVE_DATA_API_KEY", "")

INTERVAL_MAP = {
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
    "4h": "4h",
}

_cache: dict = {}
CACHE_TTL = 60  # seconds

# In-flight deduplication: if a fetch for the same key is already running,
# new callers await the same Future instead of firing duplicate API calls.
_inflight: dict[str, asyncio.Future] = {}

# Global semaphore: never fire more than 2 concurrent Twelve Data requests.
_td_semaphore = asyncio.Semaphore(2)


async def _fetch_from_api(symbol: str, td_interval: str, outputsize: int) -> pd.DataFrame:
    """Single Twelve Data request with retry on rate-limit errors."""
    params = {
        "symbol": symbol,
        "interval": td_interval,
        "outputsize": outputsize,
        "apikey": TWELVE_DATA_KEY,
        "format": "JSON",
    }

    max_attempts = 3
    for attempt in range(max_attempts):
        async with _td_semaphore:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(f"{TWELVE_DATA_BASE}/time_series", params=params)
                resp.raise_for_status()
                data = resp.json()

        if "values" in data:
            break

        msg = data.get("message", str(data))
        is_rate_limit = "run out of API credits" in msg or "Too Many Requests" in msg

        if is_rate_limit and attempt < max_attempts - 1:
            wait = 15 * (attempt + 1)  # 15s, 30s
            await asyncio.sleep(wait)
            continue

        raise ValueError(f"Twelve Data error: {msg}")

    rows = data["values"]
    df = pd.DataFrame(rows)
    df.rename(columns={"datetime": "time"}, inplace=True)
    df["time"] = pd.to_datetime(df["time"])
    df[["open", "high", "low", "close"]] = df[["open", "high", "low", "close"]].astype(float)
    df = df.iloc[::-1].reset_index(drop=True)
    return df


async def fetch_ohlc(symbol: str = "USD/JPY", interval: str = "5m", outputsize: int = 200) -> pd.DataFrame:
    # ── MT5 primary source ──────────────────────────────────────────────────
    mt5_df = mt5_get_candles(symbol, interval)
    if mt5_df is not None and len(mt5_df) >= 10:
        # Trim to the requested outputsize from the tail (most recent candles)
        return mt5_df.tail(outputsize).reset_index(drop=True)

    # ── Twelve Data fallback ────────────────────────────────────────────────
    cache_key = f"{symbol}_{interval}_{outputsize}"
    now = time.time()

    # Cache hit
    if cache_key in _cache:
        ts, df = _cache[cache_key]
        if now - ts < CACHE_TTL:
            return df

    # In-flight deduplication: if another coroutine is already fetching
    # this exact key, wait for it rather than firing a second API call.
    if cache_key in _inflight:
        return await asyncio.shield(_inflight[cache_key])

    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()
    _inflight[cache_key] = future

    try:
        td_interval = INTERVAL_MAP.get(interval, "5min")
        df = await _fetch_from_api(symbol, td_interval, outputsize)
        _cache[cache_key] = (time.time(), df)
        future.set_result(df)
        return df
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        _inflight.pop(cache_key, None)


def candles_to_dict(df: pd.DataFrame) -> list[dict]:
    result = []
    for _, row in df.iterrows():
        result.append({
            "time": int(row["time"].timestamp()),
            "open": round(float(row["open"]), 5),
            "high": round(float(row["high"]), 5),
            "low": round(float(row["low"]), 5),
            "close": round(float(row["close"]), 5),
        })
    return result
