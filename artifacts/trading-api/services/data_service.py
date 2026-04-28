import pandas as pd

from services.mt5_store import get_candles as mt5_get_candles


async def fetch_ohlc(symbol: str = "USD/JPY", interval: str = "5m", outputsize: int = 200) -> pd.DataFrame:
    """Return OHLC candles from the MT5 store.

    Raises ValueError if no MT5 data is available yet (bridge still warming up).
    """
    mt5_df = mt5_get_candles(symbol, interval)
    if mt5_df is not None and len(mt5_df) >= 10:
        return mt5_df.tail(outputsize).reset_index(drop=True)

    raise ValueError(
        f"MT5 data not available for {symbol} {interval}. "
        f"The bridge may still be warming up — try again in a few seconds."
    )


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