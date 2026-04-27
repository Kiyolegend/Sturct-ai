# STRUCT.ai — Full Technical Documentation

**Platform:** AI-Powered Multi-Symbol Forex Market Structure Analysis  
**Architecture:** pnpm Monorepo (React + Vite Frontend · Python FastAPI Backend · Windows MT5 Bridge)  
**Date Documented:** April 17, 2026  
**Last Verified Against Live System:** April 27, 2026

---

## ⚡ Live System Update (April 27, 2026)

The original document below was written when STRUCT.ai was a single‑pair (USDJPY) prototype. The system has since evolved. The information in this section **supersedes** the corresponding details in the rest of the document where they conflict. Everything else in the original document still applies as written.

### What changed since the original doc was written

| Topic | Original doc said | Live system today |
|---|---|---|
| **Tradable symbols** | USDJPY only | **All 8 symbols** — `USDJPYm`, `EURUSDm`, `GBPUSDm`, `EURJPYm`, `GBPJPYm`, `AUDUSDm`, `USDCADm`, `USDCHFm` (broker‑suffixed for Exness micro account) |
| **Timeframes pushed** | M15, H1, H4 (3 timeframes) | **5m, 15m, 1h, 4h** (4 timeframes) — adds 5‑minute data |
| **Bars per push** | 500 | 500 (unchanged) |
| **Push interval** | every 30 seconds | every 30 seconds (unchanged) |
| **Total payloads per cycle** | 3 (1 sym × 3 TF) | **32** (8 sym × 4 TF) — confirmed in bridge log: `Done: 32/32 timeframes pushed successfully` |
| **API server port** | 8000 | **8001** |
| **Push endpoint path** | `POST /trading-api/mt5/bars` | **`POST /trading-api/mt5/push`** |
| **Symbol param format** | `symbol=USDJPY` | **`symbol=USD%2FJPY`** (URL‑encoded slash form, e.g. `USD/JPY`, `EUR/USD`) |
| **Timeframe param name** | `timeframe=M15` | **`interval=5m`** (lowercase with units) |
| **Outputsize param name** | `count=500` | **`outputsize=500`** |
| **Analysis endpoints (URL prefix)** | `/trading-api/structure/*` | **`/trading-api/*`** (no `/structure/` segment) |
| **MT5 broker (verified)** | unspecified | Exness‑MT5Real2, account "Kyo", balance $134.03 USD |

### Real endpoint list (as observed on the live server)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/trading-api/analysis` | Full per‑symbol/per‑interval structure analysis |
| `GET`  | `/trading-api/sessions` | Session boxes (Asian, London, New York) |
| `GET`  | `/trading-api/sr-levels` | Multi‑timeframe S/R levels (15m + 1h + 4h aggregated) |
| `GET`  | `/trading-api/mtf-bias` | MTF directional bias for a symbol |
| `POST` | `/trading-api/mt5/push` | Receive bars from the MT5 bridge (HMAC signed) |
| `GET`  | `/trading-api/mt5/status` | MT5 data‑store status |

> The `/structure/zigzag`, `/structure/bos`, `/structure/choch`, `/structure/zones`, and `/structure/mtf-sr` endpoints listed later in this document **were never deployed on the live server**. The same data is available as nested fields inside `/analysis` and via `/sr-levels`.

### Sample real requests (from the live server log)

```
GET /trading-api/analysis?symbol=USD%2FJPY&interval=5m&outputsize=500   → 200
GET /trading-api/analysis?symbol=USD%2FJPY&interval=15m&outputsize=500  → 200
GET /trading-api/sessions?symbol=USD%2FJPY&interval=5m&outputsize=500   → 200
GET /trading-api/sr-levels?symbol=USD%2FJPY&outputsize=300              → 200
GET /trading-api/mtf-bias?symbol=USD%2FJPY                              → 200
GET /trading-api/mt5/status                                             → 200
POST /trading-api/mt5/push                                              → 200  (×32 per cycle)
```

### MT5 Bridge — actual configuration (multi‑symbol)

```python
TARGET   = "http://localhost:8001"
SYMBOLS  = ["USDJPYm", "EURUSDm", "GBPUSDm", "EURJPYm",
            "GBPJPYm", "AUDUSDm", "USDCADm", "USDCHFm"]
TIMEFRAMES = ["5m", "15m", "1h", "4h"]
INTERVAL  = 30   # seconds
CANDLES   = 500
```

The bridge prints `Connecting to MetaTrader 5...` → `Connected: Exness-MT5Real2 | Kyo | Balance: 134.03 USD`, then `✓ Symbol ready: <symbol>` for each of the 8 symbols, then enters the push loop. Each cycle takes ≈90 seconds and prints `Done: 32/32 timeframes pushed successfully`.

### Symbol naming convention (broker → API)

The Windows bridge uses **broker‑suffixed micro symbols** (`USDJPYm`, `EURUSDm`, …) because the connected Exness account is a micro‑lot account. The analysis endpoints, however, accept the **logical slash form** (`USD/JPY`, `EUR/USD`, URL‑encoded as `USD%2FJPY`). The `mt5_store` translates between the two — pushed bars stored under broker symbol, queries normalized to the slash form before lookup.

### Known live‑system issue: Twelve Data fallback is broken

The server log shows recurring 500 errors from `/sr-levels` and `/mtf-bias`:

```
ValueError: Twelve Data error: **apikey** parameter is incorrect or not specified
  File ".../services/data_service.py", line 59, in _fetch_from_api
```

**Root cause:** when `data_service.fetch_ohlc()` decides MT5 data is stale (>120 s) it falls back to the Twelve Data REST API, but `TWELVE_DATA_API_KEY` is missing or invalid. The fallback then crashes the request.

**Why it usually works:** the bridge pushes every 30 s, well under the 120 s staleness window, so the fallback rarely triggers. But it does trigger after MT5 reconnects, weekend gaps, or any pause >2 minutes.

**Two fixes (either is sufficient):**

1. Provide a valid `TWELVE_DATA_API_KEY` so the fallback path actually works.
2. Change `data_service.py` to **return whatever MT5 has** when the bridge has pushed at least once for the requested symbol/timeframe, even if the most recent bar is slightly stale — i.e. only fall back when the store is genuinely empty. With this change a missing `TWELVE_DATA_API_KEY` only matters at cold start.

### Why this matters for downstream consumers (e.g. the Scalping Engine)

A separate consumer app, the **STRUCT.ai Scalping Engine v3.1**, reads from this API to make trade decisions. Its expectations align with the **live system**, not with the older single‑pair documentation:

- It scans all 8 logical symbols (`USD/JPY`, `EUR/USD`, …) — supported.
- Strategy 1 (MTF Pullback) requires 5‑minute BOS confirmation — supported (5m is in the live timeframes).
- It calls `STRUCT_AI_BASE = "http://localhost:8001/trading-api"` — supported (port 8001 matches).
- It will occasionally hit the broken Twelve Data fallback path and silently skip a scan cycle when that happens.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Environment Variables & Secrets](#3-environment-variables--secrets)
4. [Python Trading API](#4-python-trading-api)
   - 4.1 [Entry Point — main.py](#41-entry-point--mainpy)
   - 4.2 [Data Service — data_service.py](#42-data-service--data_servicepy)
   - 4.3 [MT5 Store — mt5_store.py](#43-mt5-store--mt5_storepy)
   - 4.4 [ZigZag Engine — zigzag_engine.py](#44-zigzag-engine--zigzag_enginepy)
   - 4.5 [Structure Engine — structure_engine.py](#45-structure-engine--structure_enginepy)
   - 4.6 [Trend Engine — trend_engine.py](#46-trend-engine--trend_enginepy)
   - 4.7 [BOS Engine — bos_engine.py](#47-bos-engine--bos_enginepy)
   - 4.8 [CHOCH Engine — choch_engine.py](#48-choch-engine--choch_enginepy)
   - 4.9 [MTF S/R Engine — mtf_sr_engine.py](#49-mtf-sr-engine--mtf_sr_enginepy)
   - 4.10 [Session Engine — session_engine.py](#410-session-engine--session_enginepy)
   - 4.11 [Zones Engine — zones_engine.py](#411-zones-engine--zones_enginepy)
   - 4.12 [Router — structure.py](#412-router--structurepy)
   - 4.13 [pyproject.toml](#413-pyprojecttoml)
5. [MT5 Windows Bridge](#5-mt5-windows-bridge)
   - 5.1 [mt5_bridge.py](#51-mt5_bridgepy)
   - 5.2 [Windows .bat Launchers](#52-windows-bat-launchers)
6. [React Trading Dashboard](#6-react-trading-dashboard)
   - 6.1 [Vite Config — vite.config.ts](#61-vite-config--viteconfigts)
   - 6.2 [App Entry — App.tsx](#62-app-entry--apptsx)
   - 6.3 [Dashboard Page — Dashboard.tsx](#63-dashboard-page--dashboardtsx)
   - 6.4 [TopBar Component — TopBar.tsx](#64-topbar-component--topbartsx)
   - 6.5 [TradingChart Component — TradingChart.tsx](#65-tradingchart-component--tradingcharttsx)
   - 6.6 [API Hooks — use-trading-api.ts](#66-api-hooks--use-trading-apits)
   - 6.7 [Styling — index.css](#67-styling--indexcss)
   - 6.8 [package.json](#68-packagejson)
7. [Express API Server](#7-express-api-server)
8. [Shared Libraries](#8-shared-libraries)
   - 8.1 [api-zod](#81-api-zod)
   - 8.2 [api-client-react](#82-api-client-react)
   - 8.3 [db](#83-db)
9. [Mockup Sandbox](#9-mockup-sandbox)
10. [Root Monorepo Configuration](#10-root-monorepo-configuration)
11. [API Reference — All Endpoints](#11-api-reference--all-endpoints)
12. [Data Flow Diagram](#12-data-flow-diagram)
13. [Algorithm Deep Dives](#13-algorithm-deep-dives)
    - 13.1 [ZigZag Algorithm](#131-zigzag-algorithm)
    - 13.2 [Market Structure Algorithm](#132-market-structure-algorithm)
    - 13.3 [BOS Detection](#133-bos-detection)
    - 13.4 [CHOCH Detection](#134-choch-detection)
    - 13.5 [MTF S/R Level Detection](#135-mtf-sr-level-detection)
    - 13.6 [Session Box Detection](#136-session-box-detection)
    - 13.7 [Zone Detection](#137-zone-detection)
14. [Frontend Chart Rendering](#14-frontend-chart-rendering)
15. [Windows Setup & MT5 Integration](#15-windows-setup--mt5-integration)
16. [Deployment & Ports](#16-deployment--ports)
17. [File Index — All 221 Files](#17-file-index--all-221-files)

---

## 1. Project Overview

STRUCT.ai is a real-time USDJPY forex market structure analysis platform. It is not an automated trading bot — it is a **visual analysis dashboard** that applies rule-based algorithms to OHLCV candlestick data to detect:

- **ZigZag swing points** (pivot highs and pivot lows)
- **Market structure labels** (HH = Higher High, LH = Lower High, HL = Higher Low, LL = Lower Low)
- **BOS** (Break of Structure) — continuation signal when price breaks the last swing in trend direction
- **CHOCH** (Change of Character) — reversal signal when price breaks the last swing against trend direction
- **MTF S/R Levels** — Support and Resistance levels derived from 15-minute, 1-hour, and 4-hour timeframes simultaneously
- **Session Boxes** — Asian, London, and New York session high/low ranges drawn on the chart
- **MTF Bias** — Overall directional bias (Bullish / Bearish / Neutral) across 15M, 1H, and 4H simultaneously

**Primary currency pair:** USDJPY  
**Primary data source:** MetaTrader 5 (live, via a Windows MT5 bridge)  
**Fallback data source:** Twelve Data REST API (when MT5 data is absent or stale >120s)

---

## 2. Monorepo Structure

```
/ (workspace root)
├── pnpm-workspace.yaml          # Defines workspace packages
├── package.json                 # Root scripts (typecheck, format, etc.)
├── tsconfig.base.json           # Shared TypeScript base config
├── tsconfig.json                # Root TypeScript project references
├── .npmrc                       # pnpm settings
├── .gitignore
├── .replitignore
├── replit.md                    # Replit project documentation
├── pyproject.toml               # Python project config (uv)
├── uv.lock                      # Python lock file
├── pnpm-lock.yaml               # Node lock file
│
├── artifacts/
│   ├── trading-api/             # Python FastAPI — port 8000, /trading-api prefix
│   │   ├── main.py
│   │   ├── routers/
│   │   │   └── structure.py
│   │   ├── services/
│   │   │   ├── zigzag_engine.py
│   │   │   ├── structure_engine.py
│   │   │   ├── trend_engine.py
│   │   │   ├── bos_engine.py
│   │   │   ├── choch_engine.py
│   │   │   ├── mtf_sr_engine.py
│   │   │   ├── session_engine.py
│   │   │   ├── zones_engine.py
│   │   │   ├── mt5_store.py
│   │   │   └── data_service.py
│   │   └── mt5-bridge/
│   │       └── mt5_bridge.py
│   │
│   ├── trading-dashboard/       # React + Vite — port 24210, previewPath /
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── components.json      # shadcn/ui config
│   │   ├── public/
│   │   │   └── favicon.svg
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── index.css
│   │       ├── pages/
│   │       │   └── Dashboard.tsx
│   │       ├── components/
│   │       │   ├── TopBar.tsx
│   │       │   ├── TradingChart.tsx
│   │       │   └── ui/          # 70+ shadcn/ui components
│   │       ├── hooks/
│   │       │   ├── use-trading-api.ts
│   │       │   ├── use-toast.ts
│   │       │   └── use-mobile.tsx
│   │       └── lib/
│   │           └── utils.ts
│   │
│   ├── api-server/              # Express.js — TypeScript, general-purpose
│   │   ├── build.mjs
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts
│   │       ├── routes/
│   │       │   ├── index.ts
│   │       │   └── health.ts
│   │       └── lib/
│   │           └── logger.ts
│   │
│   └── mockup-sandbox/          # Vite React UI canvas previewer
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json
│       ├── tsconfig.json
│       ├── components.json
│       ├── mockupPreviewPlugin.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── index.css
│           ├── .generated/
│           │   └── mockup-components.ts
│           ├── components/
│           │   └── ui/          # Full shadcn/ui component library
│           ├── hooks/
│           │   ├── use-toast.ts
│           │   └── use-mobile.tsx
│           └── lib/
│               └── utils.ts
│
├── lib/
│   ├── api-zod/                 # Shared Zod validation schemas
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   ├── api-client-react/        # TanStack Query API client hooks
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── generated/
│   │       │   ├── api.ts
│   │       │   └── api.schemas.ts
│   │       └── custom-fetch.ts
│   └── db/                      # Drizzle ORM PostgreSQL client
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts
│           └── schema/
│               └── index.ts
│
└── scripts/
    ├── package.json
    ├── tsconfig.json
    ├── post-merge.sh
    └── src/
        └── hello.ts
```

**pnpm-workspace.yaml defines these packages:**
```yaml
packages:
  - "artifacts/*"
  - "lib/*"
  - "scripts"
```

---

## 3. Environment Variables & Secrets

| Variable | Where Used | Purpose |
|---|---|---|
| `TWELVE_DATA_API_KEY` | `data_service.py` | Fallback OHLCV data from Twelve Data REST API |
| `MT5_BRIDGE_SECRET` | `mt5_store.py`, `mt5_bridge.py` | HMAC-SHA256 authentication between MT5 bridge and API |
| `SESSION_SECRET` | Express API server | Session cookie signing |
| `DATABASE_URL` | `lib/db` | PostgreSQL connection string for Drizzle ORM |
| `PORT` | All Vite/Express artifacts | Dynamic port assigned by Replit per artifact |
| `BASE_PATH` | Vite artifacts | URL base path prefix for reverse proxy routing |
| `NODE_ENV` | Express, Vite | `development` or `production` |
| `LOG_LEVEL` | Express logger (pino) | Log verbosity level |

---

## 4. Python Trading API

**Location:** `artifacts/trading-api/`  
**Runtime:** Python (managed via `uv`)  
**Framework:** FastAPI with Uvicorn  
**Port:** 8000  
**URL prefix:** `/trading-api`  
**Artifact kind:** `api`

### 4.1 Entry Point — main.py

```
artifacts/trading-api/main.py
```

The FastAPI application is created with the prefix `/trading-api` applied to all routes. CORS is enabled for all origins (`allow_origins=["*"]`). The single router (`structure.py`) is mounted at `/trading-api`.

**Key setup:**
```python
app = FastAPI(title="STRUCT.ai Trading API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router, prefix="/trading-api")
```

The server runs on `host="0.0.0.0"`, port from `PORT` environment variable (defaulting to `8000`).

**Startup event:** On startup, `mt5_store.get_status()` is called to initialize the MT5 data store.

**Root health check:**
- `GET /trading-api/` → `{"status": "ok", "message": "STRUCT.ai Trading API"}`

---

### 4.2 Data Service — data_service.py

```
artifacts/trading-api/services/data_service.py
```

**Purpose:** Single source of truth for OHLCV data. Implements a two-tier data strategy:

**Tier 1 — MT5 Live Data:**
- Calls `mt5_store.get_bars(symbol, timeframe, count)` 
- Checks data freshness: if the most recent bar is older than **120 seconds**, the data is considered stale
- If data is fresh, returns it directly as a pandas DataFrame

**Tier 2 — Twelve Data Fallback:**
- If MT5 data is absent or stale, calls the Twelve Data REST API
- Endpoint: `https://api.twelvedata.com/time_series`
- Params: `symbol`, `interval`, `outputsize=5000`, `apikey=TWELVE_DATA_API_KEY`
- Converts the response to a pandas DataFrame with columns: `time`, `open`, `high`, `low`, `close`, `volume`
- Casts all OHLCV columns to float64

**Timeframe mapping (MT5 to Twelve Data):**
| MT5 Key | Twelve Data Interval |
|---|---|
| `M15` | `15min` |
| `H1` | `1h` |
| `H4` | `4h` |

**Primary function:**
```python
async def get_ohlcv(symbol: str, timeframe: str, count: int = 500) -> pd.DataFrame
```

Returns a DataFrame sorted ascending by time with columns: `time, open, high, low, close, volume`.

---

### 4.3 MT5 Store — mt5_store.py

```
artifacts/trading-api/services/mt5_store.py
```

**Purpose:** Thread-safe in-memory store for live MT5 bar data pushed from the Windows bridge.

**Storage:** `_store: Dict[str, List[Dict]]` — key is `"{symbol}_{timeframe}"`, value is a list of bar dicts.

**HMAC Authentication:**
Every push from the MT5 bridge must include an `X-MT5-Secret` header. The store validates it using:
```python
hmac.compare_digest(
    hmac.new(MT5_BRIDGE_SECRET.encode(), body, hashlib.sha256).hexdigest(),
    provided_secret
)
```
Returns `False` if secrets do not match.

**Thread safety:** A `threading.Lock()` protects all read/write operations on `_store`.

**Key functions:**
- `update_bars(symbol, timeframe, bars, secret)` → validates HMAC, stores bars, returns bool
- `get_bars(symbol, timeframe, count)` → returns most recent `count` bars as list of dicts
- `get_status()` → returns dict of all stored symbol/timeframe combos and their bar counts
- `get_latest_timestamp(symbol, timeframe)` → returns the most recent bar's timestamp (for staleness check)

---

### 4.4 ZigZag Engine — zigzag_engine.py

```
artifacts/trading-api/services/zigzag_engine.py
```

**Purpose:** Detects swing highs (pivot highs) and swing lows (pivot lows) in OHLCV data using a fractal-based algorithm with strict alternation enforcement.

**Constants:**
```python
FRACTAL_N = 5  # Number of bars on each side required to confirm a fractal
```

**Algorithm — `calculate_zigzag(df)`:**

1. **Fractal Detection:** For each bar `i` (where `i >= FRACTAL_N` and `i < len(df) - FRACTAL_N`):
   - It is a **pivot high** if `high[i]` is strictly greater than all highs in `[i-N..i-1]` and `[i+1..i+N]`
   - It is a **pivot low** if `low[i]` is strictly less than all lows in `[i-N..i-1]` and `[i+1..i+N]`

2. **Strict Alternation Enforcement:** The algorithm walks through all detected fractals in chronological order and enforces alternation (high → low → high → low ...). When two consecutive fractals of the same type appear:
   - For two highs: keeps the one with the higher value
   - For two lows: keeps the one with the lower value

3. **Output format:** Returns a list of dicts:
```python
[
  {"time": int_timestamp, "price": float, "type": "high" | "low"},
  ...
]
```

**Exported function:** `calculate_zigzag(df: pd.DataFrame) -> List[Dict]`

---

### 4.5 Structure Engine — structure_engine.py

```
artifacts/trading-api/services/structure_engine.py
```

**Purpose:** Labels each ZigZag pivot with a market structure classification: HH, LH, HL, or LL.

**Labels:**
- **HH (Higher High):** Pivot high that is above the previous pivot high
- **LH (Lower High):** Pivot high that is below the previous pivot high
- **HL (Higher Low):** Pivot low that is above the previous pivot low
- **LL (Lower Low):** Pivot low that is below the previous pivot low

**Algorithm — `label_structure(zigzag_points)`:**

Separates the zigzag points into two independent lists — highs and lows — and labels each relative to the prior point of the same type.

- First high is labeled HH by default (no prior high to compare)
- First low is labeled HL by default (no prior low to compare)
- Each subsequent high compares its price to the previous high's price
- Each subsequent low compares its price to the previous low's price

**Output format:** Returns a list of dicts with an added `label` field:
```python
[
  {"time": int_timestamp, "price": float, "type": "high" | "low", "label": "HH" | "LH" | "HL" | "LL"},
  ...
]
```

**Exported function:** `label_structure(zigzag_points: List[Dict]) -> List[Dict]`

---

### 4.6 Trend Engine — trend_engine.py

```
artifacts/trading-api/services/trend_engine.py
```

**Purpose:** Determines the current market trend direction based on the most recent market structure labels.

**Algorithm — `determine_trend(structure_points)`:**

Looks at the last 4 structure points (or fewer if not enough data). Counts:
- Bullish signals: HH or HL labels
- Bearish signals: LH or LL labels

**Decision logic:**
- If bullish count > bearish count → `"bullish"`
- If bearish count > bullish count → `"bearish"`
- Otherwise → `"neutral"`

Also extracts the most recent swing high price and swing low price for reference.

**Output format:**
```python
{
  "trend": "bullish" | "bearish" | "neutral",
  "last_high": float | None,
  "last_low": float | None
}
```

**Exported function:** `determine_trend(structure_points: List[Dict]) -> Dict`

---

### 4.7 BOS Engine — bos_engine.py

```
artifacts/trading-api/services/bos_engine.py
```

**Purpose:** Detects Break of Structure (BOS) events — a continuation signal where price breaks above a previous swing high (in an uptrend) or below a previous swing low (in a downtrend).

**Algorithm — `detect_bos(df, structure_points, trend_info)`:**

1. Gets the trend direction from `trend_info["trend"]`
2. In a **bullish trend**: watches for a candle's **close price** to break above the most recent swing high price
3. In a **bearish trend**: watches for a candle's **close price** to break below the most recent swing low price
4. Scans all candles after the last structure point for such a break
5. When found, records the event

**Output format:** Returns a list of BOS event dicts:
```python
[
  {
    "time": int_timestamp,
    "price": float,          # The broken level price
    "type": "bullish_bos" | "bearish_bos",
    "broken_level": float    # Same as price
  },
  ...
]
```

**Exported function:** `detect_bos(df: pd.DataFrame, structure_points: List[Dict], trend_info: Dict) -> List[Dict]`

---

### 4.8 CHOCH Engine — choch_engine.py

```
artifacts/trading-api/services/choch_engine.py
```

**Purpose:** Detects Change of Character (CHOCH) events — a reversal signal where price breaks against the current trend direction, suggesting a potential trend reversal.

**Algorithm — `detect_choch(df, structure_points, trend_info)`:**

1. Gets the trend direction from `trend_info["trend"]`
2. In a **bullish trend**: watches for a candle's **close price** to break **below** the most recent swing low (the opposite of BOS in a bullish trend)
3. In a **bearish trend**: watches for a candle's **close price** to break **above** the most recent swing high (the opposite of BOS in a bearish trend)
4. Scans all candles after the last structure point for such a break
5. When found, records the event

**Output format:**
```python
[
  {
    "time": int_timestamp,
    "price": float,
    "type": "bullish_choch" | "bearish_choch",
    "broken_level": float
  },
  ...
]
```

**Exported function:** `detect_choch(df: pd.DataFrame, structure_points: List[Dict], trend_info: Dict) -> List[Dict]`

---

### 4.9 MTF S/R Engine — mtf_sr_engine.py

```
artifacts/trading-api/services/mtf_sr_engine.py
```

**Purpose:** Calculates multi-timeframe Support and Resistance levels by applying the ZigZag algorithm to 15-minute, 1-hour, and 4-hour data and extracting significant swing levels.

**Timeframe configuration:**
```python
TF_CONFIG = {
    "15m": {"timeframe": "M15", "count": 500, "min_touches": 2, "tolerance": 0.0005},
    "1h":  {"timeframe": "H1",  "count": 300, "min_touches": 2, "tolerance": 0.001},
    "4h":  {"timeframe": "H4",  "count": 200, "min_touches": 2, "tolerance": 0.002},
}
```

**Algorithm — `calculate_mtf_sr(symbol)`:**

For each of the 3 timeframes:
1. Fetches OHLCV data via `data_service.get_ohlcv()`
2. Runs the ZigZag engine to get pivot points
3. For each pivot point, checks how many other pivot points are within the `tolerance` band (as a fraction of price)
4. If the touch count meets or exceeds `min_touches`, the level is promoted as a confirmed S/R level
5. Deduplicates levels that are within tolerance of each other (keeps the one with more touches)

**Output format:**
```python
{
  "15m": [{"price": float, "type": "resistance"|"support", "touches": int, "timeframe": "15m"}, ...],
  "1h":  [...],
  "4h":  [...]
}
```

**Exported function:** `calculate_mtf_sr(symbol: str) -> Dict`  
Note: This is an `async` function because it calls `data_service.get_ohlcv()`.

---

### 4.10 Session Engine — session_engine.py

```
artifacts/trading-api/services/session_engine.py
```

**Purpose:** Identifies Asian, London, and New York trading session high/low boxes on the chart based on UTC hour ranges.

**Session definitions (UTC):**
```python
SESSIONS = {
    "asian":  {"start": 0,  "end": 8,  "color": "#9B59B6"},  # Purple
    "london": {"start": 8,  "end": 16, "color": "#3498DB"},  # Blue
    "new_york": {"start": 13, "end": 21, "color": "#E74C3C"}, # Red
}
```

Note: London and New York sessions overlap from 13:00–16:00 UTC.

**Algorithm — `calculate_sessions(df)`:**

1. Converts all bar timestamps to UTC datetime objects
2. Groups bars by date and session
3. For each date+session group, finds the highest high and lowest low within that session's hour range
4. Returns a session box record if the group has at least 1 bar

**Output format:**
```python
[
  {
    "session": "asian" | "london" | "new_york",
    "date": "YYYY-MM-DD",
    "high": float,
    "low": float,
    "start_time": int_timestamp,
    "end_time": int_timestamp,
    "color": hex_color_string
  },
  ...
]
```

**Exported function:** `calculate_sessions(df: pd.DataFrame) -> List[Dict]`

---

### 4.11 Zones Engine — zones_engine.py

```
artifacts/trading-api/services/zones_engine.py
```

**Purpose:** Identifies supply and demand zones based on strong price movements away from consolidation areas (order blocks).

**Algorithm — `calculate_zones(df, structure_points)`:**

1. For each consecutive pair of ZigZag structure points (A → B):
   - Calculates the price move: `abs(B.price - A.price)`
   - Calculates move percentage: `move / A.price * 100`
2. If the move percentage exceeds **0.3%**, the area between A and B is classified as a significant zone:
   - If B is a high (move was upward): classified as a **demand zone** (price moved up strongly from this low)
   - If B is a low (move was downward): classified as a **supply zone** (price moved down strongly from this high)
3. Zone boundaries are `[min(A.price, B.price), max(A.price, B.price)]`

**Output format:**
```python
[
  {
    "type": "supply" | "demand",
    "top": float,
    "bottom": float,
    "time": int_timestamp,        # Start time of the zone
    "end_time": int_timestamp,    # End time of the zone
    "strength": float             # Move percentage (e.g. 0.45 for 0.45%)
  },
  ...
]
```

**Exported function:** `calculate_zones(df: pd.DataFrame, structure_points: List[Dict]) -> List[Dict]`

---

### 4.12 Router — structure.py

```
artifacts/trading-api/routers/structure.py
```

**Purpose:** Defines all HTTP endpoints for the trading API. All endpoints are async and return JSON.

**Full endpoint list** (see also [Section 11](#11-api-reference--all-endpoints)):

| Method | Path | Description |
|---|---|---|
| GET | `/trading-api/structure/analysis` | Full market structure analysis |
| GET | `/trading-api/structure/zigzag` | ZigZag pivot points only |
| GET | `/trading-api/structure/bos` | BOS events only |
| GET | `/trading-api/structure/choch` | CHOCH events only |
| GET | `/trading-api/structure/sessions` | Session boxes only |
| GET | `/trading-api/structure/mtf-sr` | MTF S/R levels only |
| GET | `/trading-api/structure/mtf-bias` | MTF directional bias |
| GET | `/trading-api/structure/zones` | Supply/demand zones only |
| POST | `/trading-api/mt5/bars` | Receive bars from MT5 bridge |
| GET | `/trading-api/mt5/status` | MT5 data store status |

**Common query parameters for GET endpoints:**
- `symbol` (str, default: `"USDJPY"`)
- `timeframe` (str, default: `"M15"`)
- `count` (int, default: `500`)

**POST `/trading-api/mt5/bars` body:**
```json
{
  "symbol": "USDJPY",
  "timeframe": "M15",
  "bars": [
    {"time": 1713360000, "open": 154.20, "high": 154.45, "low": 154.10, "close": 154.38, "volume": 1234}
  ]
}
```
Requires `X-MT5-Secret` header with correct HMAC value.

---

### 4.13 pyproject.toml

```
pyproject.toml (root)
```

**Python version:** `>=3.11`  
**Package manager:** `uv`

**Dependencies:**
```toml
fastapi = ">=0.115.0"
uvicorn = {extras = ["standard"], version = ">=0.30.0"}
pandas = ">=2.0.0"
numpy = ">=1.24.0"
httpx = ">=0.27.0"
websockets = ">=12.0"
python-dotenv = ">=1.0.0"
MetaTrader5 = ">=5.0.45"   # Windows only
requests = ">=2.31.0"
```

---

## 5. MT5 Windows Bridge

### 5.1 mt5_bridge.py

```
artifacts/trading-api/mt5-bridge/mt5_bridge.py
```

**Purpose:** A Python script that runs on a **Windows machine** with MetaTrader 5 installed. It polls MT5 for live OHLCV data and pushes it to the Trading API.

**How it works:**

1. Connects to MetaTrader 5 via the `MetaTrader5` Windows Python library
2. On a configurable interval (default: **30 seconds**), polls USDJPY bars for all three timeframes: M15, H1, H4
3. For each timeframe, requests the last **500 bars** via `mt5.copy_rates_from_pos()`
4. Converts bar data to a list of dicts with: `time, open, high, low, close, volume`
5. Computes HMAC-SHA256 signature of the JSON body using `MT5_BRIDGE_SECRET`
6. POSTs to `{API_URL}/trading-api/mt5/bars` with `X-MT5-Secret: {hmac_hex}` header

**Configuration (environment variables or defaults):**
```python
API_URL = os.getenv("API_URL", "http://localhost:8000")
MT5_BRIDGE_SECRET = os.getenv("MT5_BRIDGE_SECRET", "")
SYMBOL = "USDJPY"
TIMEFRAMES = ["M15", "H1", "H4"]
POLL_INTERVAL = 30  # seconds
```

**MT5 timeframe constants:**
```python
TIMEFRAME_MAP = {
    "M15": mt5.TIMEFRAME_M15,
    "H1":  mt5.TIMEFRAME_H1,
    "H4":  mt5.TIMEFRAME_H4,
}
```

**HMAC generation:**
```python
body_bytes = json.dumps(payload).encode("utf-8")
signature = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
headers = {"X-MT5-Secret": signature, "Content-Type": "application/json"}
```

**Error handling:** If MT5 connection fails, the bridge logs an error and exits. If individual push requests fail, they are logged but the bridge continues running.

---

### 5.2 Windows .bat Launchers

Multiple `.bat` files are provided for Windows users:

| File | Purpose |
|---|---|
| `START_HERE.bat` | Master launcher — runs everything |
| `start_api.bat` | Starts the Python Trading API only |
| `start_bridge.bat` | Starts the MT5 bridge only |
| `install_requirements.bat` | Installs Python dependencies via pip |
| `start-windows.bat` | Alternative start script |
| `STRUCT-AI.bat` | Branded launcher alias |

**`START_HERE.bat` logic:**
1. Checks for Python installation
2. Installs requirements from `requirements.txt` (equivalent to `pyproject.toml` deps)
3. Starts `uvicorn main:app` in the background
4. Starts `python mt5_bridge.py`
5. Opens the browser to the dashboard URL

---

## 6. React Trading Dashboard

**Location:** `artifacts/trading-dashboard/`  
**Framework:** React 18 + Vite 6  
**Port:** 24210  
**Preview Path:** `/`  
**CSS:** Tailwind CSS v4  
**Charting:** TradingView Lightweight Charts v5 (`lightweight-charts`)  
**State/Data:** TanStack Query v5 (`@tanstack/react-query`)  
**Routing:** Wouter  
**UI Components:** shadcn/ui (New York style, neutral base color)

---

### 6.1 Vite Config — vite.config.ts

```
artifacts/trading-dashboard/vite.config.ts
```

**Key settings:**
- `base`: Set from `BASE_PATH` environment variable (for reverse proxy path routing)
- `server.port`: Set from `PORT` environment variable
- `server.host`: `"0.0.0.0"` (required for Replit iframe proxy)
- `server.allowedHosts`: `true` (accepts all hosts)
- Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`, `@replit/vite-plugin-runtime-error-modal`
- In development with `REPL_ID` set: also loads `@replit/vite-plugin-cartographer`
- Path alias: `@` → `./src`

**Port validation:** Throws hard errors if `PORT` or `BASE_PATH` env vars are missing.

---

### 6.2 App Entry — App.tsx

```
artifacts/trading-dashboard/src/App.tsx
```

**Routing:** Uses Wouter's `Switch` and `Route` components.

**Routes defined:**
- `/` → `<Dashboard />`

**Providers wrapping the app:**
1. `QueryClientProvider` (TanStack Query) — `staleTime: 30_000` (30 seconds)
2. `Toaster` (sonner) — for toast notifications

**BASE_URL handling:** Reads `import.meta.env.BASE_URL` and strips trailing slash for Wouter's base path.

---

### 6.3 Dashboard Page — Dashboard.tsx

```
artifacts/trading-dashboard/src/pages/Dashboard.tsx
```

**Purpose:** Main page component — composes the TopBar and TradingChart with state management.

**State managed:**
- `symbol` (string, default `"USDJPY"`) — selected trading pair
- `timeframe` (string, default `"M15"`) — selected chart timeframe

**Layout:**
```
┌─────────────────────────────────────────┐
│              TopBar                      │
│  (symbol selector, timeframe selector)  │
├─────────────────────────────────────────┤
│                                          │
│           TradingChart                   │
│   (full height, takes remaining space)  │
│                                          │
└─────────────────────────────────────────┘
```

**Data fetching:** Calls `useFullAnalysis(symbol, timeframe)` hook from `use-trading-api.ts`. Passes the result down to `<TradingChart>`.

---

### 6.4 TopBar Component — TopBar.tsx

```
artifacts/trading-dashboard/src/components/TopBar.tsx
```

**Purpose:** Header bar with branding and controls.

**UI elements:**
- **Logo/Brand:** "STRUCT.ai" text with styled "AI" suffix
- **Symbol selector:** Dropdown (currently only USDJPY supported)
- **Timeframe selector:** Buttons for `M15`, `H1`, `H4`
- **Connection status indicator:** Shows `MT5 Live` (green dot) or `Twelve Data` (yellow dot) based on `dataSource` prop
- **Last update timestamp:** Displays human-readable time of the last data fetch

**Props interface:**
```typescript
interface TopBarProps {
  symbol: string;
  timeframe: string;
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: string) => void;
  dataSource: "mt5" | "twelve_data" | null;
  lastUpdate: Date | null;
}
```

---

### 6.5 TradingChart Component — TradingChart.tsx

```
artifacts/trading-dashboard/src/components/TradingChart.tsx
```

**Purpose:** The core chart rendering component. Uses TradingView Lightweight Charts v5 with the `createSeriesMarkers` plugin API.

**Chart series rendered:**
1. **Candlestick Series** — main OHLCV candles (white up, red down, dark theme colors)
2. **ZigZag Line Series** — connects swing highs and lows with a visible line
3. **Structure Labels** — HH, LH, HL, LL labels rendered as series markers on the candlestick series
4. **BOS Markers** — triangular markers (up/down arrows) at BOS events
5. **CHOCH Markers** — diamond markers at CHOCH events (different color from BOS)
6. **MTF S/R Levels** — horizontal price lines for 15m (yellow), 1h (orange), 4h (red) levels
7. **Session Boxes** — semi-transparent rectangle overlays for Asian, London, New York sessions
8. **Supply/Demand Zones** — semi-transparent rectangle overlays in red (supply) or green (demand)

**Chart configuration:**
```typescript
{
  layout: { background: { color: "#0d1117" }, textColor: "#e6edf3" },
  grid: { vertLines: { color: "#21262d" }, horzLines: { color: "#21262d" } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: "#30363d" },
  timeScale: { borderColor: "#30363d", timeVisible: true, secondsVisible: false }
}
```

**MTF Bias Panel:** Rendered as an absolutely-positioned overlay in the top-right corner of the chart. Displays three rows: `15M`, `1H`, `4H`, each with a color-coded pill showing Bullish (green), Bearish (red), or Neutral (gray).

**Props interface:**
```typescript
interface TradingChartProps {
  data: FullAnalysisResponse | undefined;
  isLoading: boolean;
  symbol: string;
  timeframe: string;
}
```

**Lifecycle:** 
- Creates the chart on mount using `useEffect` with a `useRef` container
- Cleans up chart on unmount (`chart.remove()`)
- Re-renders all series when `data`, `symbol`, or `timeframe` changes
- Subscribes to window resize events to call `chart.applyOptions({ width, height })`

**`createSeriesMarkers` usage:** Used for BOS/CHOCH markers and structure labels instead of the v4 `setMarkers` API, which is the correct v5 approach.

---

### 6.6 API Hooks — use-trading-api.ts

```
artifacts/trading-dashboard/src/hooks/use-trading-api.ts
```

**Purpose:** All TanStack Query hooks for communicating with the Python Trading API.

**Base URL resolution:**
```typescript
const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
function apiUrl(path: string): string {
  return `${BASE_URL}/trading-api${path}`;
}
```

**Defined hooks:**

| Hook | Endpoint | Refetch Interval |
|---|---|---|
| `useFullAnalysis(symbol, timeframe)` | `/structure/analysis` | 30s |
| `useZigzag(symbol, timeframe)` | `/structure/zigzag` | 30s |
| `useBos(symbol, timeframe)` | `/structure/bos` | 30s |
| `useChoch(symbol, timeframe)` | `/structure/choch` | 30s |
| `useSessions(symbol, timeframe)` | `/structure/sessions` | 60s |
| `useMtfSr(symbol)` | `/structure/mtf-sr` | 60s |
| `useMtfBias(symbol)` | `/structure/mtf-bias` | 30s |
| `useZones(symbol, timeframe)` | `/structure/zones` | 60s |
| `useMt5Status()` | `/mt5/status` | 10s |

**Query key pattern:** `["trading", endpointName, symbol, timeframe]`

**`useFullAnalysis` response shape:**
```typescript
interface FullAnalysisResponse {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  zigzag: ZigzagPoint[];
  structure: StructurePoint[];
  bos: BosEvent[];
  choch: ChochEvent[];
  sessions: SessionBox[];
  mtf_sr: MtfSrLevels;
  mtf_bias: MtfBias;
  zones: Zone[];
  trend: TrendInfo;
  data_source: "mt5" | "twelve_data";
  timestamp: string;
}
```

---

### 6.7 Styling — index.css

```
artifacts/trading-dashboard/src/index.css
```

**Tailwind v4 imports:**
```css
@import "tailwindcss";
@import "tw-animate-css";
```

**Custom theme:** Full CSS variable-based theming system using `@theme inline` directive. The dashboard uses a dark color scheme by default with variables set in the `.dark` class.

**Dark mode defaults (`:root`):**
- Background: `240 10% 3.9%` (near-black)
- Foreground: `0 0% 98%` (near-white)
- Primary: `0 0% 98%`
- Chart colors: blue, teal, orange, purple, pink

The chart-specific colors (candlestick up/down, line colors) are defined directly in `TradingChart.tsx` as hex strings, not CSS variables.

---

### 6.8 package.json

```
artifacts/trading-dashboard/package.json
```

**Name:** `@workspace/trading-dashboard`

**Key dependencies:**
```json
{
  "lightweight-charts": "^5.0.0",
  "@tanstack/react-query": "catalog:",
  "wouter": "^3.3.5",
  "lucide-react": "catalog:",
  "tailwind-merge": "catalog:",
  "clsx": "catalog:",
  "class-variance-authority": "catalog:"
}
```

**Key devDependencies:**
```json
{
  "@vitejs/plugin-react": "catalog:",
  "@tailwindcss/vite": "catalog:",
  "tailwindcss": "catalog:",
  "vite": "catalog:",
  "typescript": "catalog:"
}
```

**Scripts:**
- `dev`: `vite dev`
- `build`: `vite build`
- `preview`: `vite preview`
- `typecheck`: `tsc -p tsconfig.json --noEmit`

---

## 7. Express API Server

**Location:** `artifacts/api-server/`  
**Framework:** Express.js v5 (TypeScript)  
**Build:** esbuild (bundled to ESM `.mjs`)  
**Artifact kind:** `api`

**Purpose:** General-purpose Node.js API server. In the current codebase it serves only a health check endpoint. It is the scaffolded backend for future non-Python API routes.

**app.ts:**
- Mounts `pino-http` middleware (structured logging, redacts auth headers and cookies)
- Mounts `cors()` (open)
- Mounts `express.json()` and `express.urlencoded()`
- Mounts all routes under `/api`

**Health route:** `GET /api/healthz` → `{"status": "ok"}` (validated via Zod's `HealthCheckResponse` schema from `@workspace/api-zod`)

**Logger (logger.ts):**
- Uses `pino` with `pino-pretty` in development, plain JSON in production
- Redacts: `req.headers.authorization`, `req.headers.cookie`, `res.headers['set-cookie']`

**Build (build.mjs):**
- Uses esbuild to bundle to `dist/index.mjs`
- Extensive `external` list covers all unbundleable native modules (sharp, better-sqlite3, canvas, bcrypt, etc.)
- `esbuild-plugin-pino` handles pino's worker thread logging pattern
- Banner injects `require`, `__filename`, `__dirname` shims for CJS compatibility in ESM output

**Dependencies:** `express`, `cors`, `pino`, `pino-http`, `drizzle-orm`, `@workspace/api-zod`, `@workspace/db`

---

## 8. Shared Libraries

### 8.1 api-zod

**Package:** `@workspace/api-zod`  
**Location:** `lib/api-zod/`  
**Purpose:** Shared Zod v4 validation schemas used by both the Express API server and frontend.

**Currently exports:**
- `HealthCheckResponse` — `z.object({ status: z.literal("ok") })`

**TypeScript config:** `composite: true`, emits declarations only, no JS output.

---

### 8.2 api-client-react

**Package:** `@workspace/api-client-react`  
**Location:** `lib/api-client-react/`  
**Purpose:** Auto-generated TanStack Query API client hooks for the Express API server.

**Exports:**
- All generated hooks and types from `./generated/api.ts` and `./generated/api.schemas.ts`
- `setBaseUrl(url: string)` — configures the base URL for all requests
- `setAuthTokenGetter(fn: AuthTokenGetter)` — configures bearer token injection
- `AuthTokenGetter` type

**`custom-fetch.ts`:** A fetch wrapper that prepends `baseUrl` and injects `Authorization: Bearer {token}` if a token getter is set.

Note: The trading dashboard does **not** use this library — it has its own `use-trading-api.ts` hooks that call the Python API directly.

---

### 8.3 db

**Package:** `@workspace/db`  
**Location:** `lib/db/`  
**Purpose:** Drizzle ORM PostgreSQL database client for the Express API server.

**Setup:**
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

**Schema:** `lib/db/src/schema/index.ts` is currently empty (no tables defined yet — placeholder comments only).

**Drizzle config:** Uses `postgresql` dialect. Schema path: `./src/schema/index.ts`.

**Scripts:**
- `pnpm --filter db push` — applies schema to database
- `pnpm --filter db push-force` — force applies schema

Note: The trading dashboard and Python API do not use this database.

---

## 9. Mockup Sandbox

**Package:** `@workspace/mockup-sandbox`  
**Location:** `artifacts/mockup-sandbox/`  
**Purpose:** A Vite-powered React development server for previewing isolated UI components on the Replit canvas board.

**How it works:**
1. The `mockupPreviewPlugin.ts` Vite plugin scans `src/components/mockups/**/*.tsx` at startup
2. It auto-generates `src/.generated/mockup-components.ts` — a map of component paths to dynamic import functions
3. When a browser navigates to `/preview/ComponentName`, `App.tsx` dynamically imports and renders that component
4. The canvas embeds these `/preview/*` URLs in iframe shapes

**Plugin details (mockupPreviewPlugin.ts):**
- Uses `chokidar` to watch for new/deleted `.tsx` files in the mockups directory
- Regenerates the component map on file changes (with debouncing via `awaitWriteFinish`)
- Intercepts 404 responses on `/components/mockups/` and `/generated/mockup-components` URLs to trigger a rescan
- Files prefixed with `_` are excluded from the map (private/utility files)

**App.tsx routing:**
- Path `/preview/{componentPath}` → renders the component at that path
- Any other path → renders the Gallery page (shows the server info)

**Full shadcn/ui component library** is included (New York style, Tailwind v4), giving mockup components access to the same UI primitives as the main app.

**Currently:** No mockup components are registered (`mockup-components.ts` is empty).

---

## 10. Root Monorepo Configuration

### pnpm-workspace.yaml
```yaml
packages:
  - "artifacts/*"
  - "lib/*"
  - "scripts"
```

### tsconfig.base.json
Shared TypeScript settings for all packages:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

### tsconfig.json (root)
References all sub-packages for project-wide type-checking:
```json
{
  "references": [
    {"path": "lib/db"},
    {"path": "lib/api-zod"},
    {"path": "lib/api-client-react"},
    {"path": "artifacts/api-server"},
    {"path": "artifacts/trading-dashboard"},
    {"path": "artifacts/mockup-sandbox"}
  ]
}
```

### .npmrc
```
strict-peer-dependencies=false
shamefully-hoist=true
```

### package.json (root)
**Scripts:**
- `typecheck` — runs `tsc -b` across all project references
- `format` — runs Prettier on all TypeScript/JavaScript files

**Catalog dependencies** (shared versions pinned for all packages):
- `react` / `react-dom`: `^18.3.1`
- `typescript`: `^5.8.3`
- `vite`: `^6.3.2`
- `zod`: `^3.24.3`
- `drizzle-orm`: `^0.43.1`
- `@tanstack/react-query`: `^5.74.4`
- `tailwindcss`: `^4.1.4`
- `framer-motion`: `^12.7.4`
- `lucide-react`: `^0.507.0`
- `tsx`: `^4.19.3`
- `@types/node`: `^22.15.3`
- `@vitejs/plugin-react`: `^4.4.1`
- `@tailwindcss/vite`: `^4.1.4`
- `class-variance-authority`: `^0.7.1`
- `clsx`: `^2.1.1`
- `tailwind-merge`: `^3.2.0`

### scripts/post-merge.sh
Run automatically after task agent merges:
```bash
#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
```

---

## 11. API Reference — All Endpoints

### Trading API (Python FastAPI, prefix: `/trading-api`)

---

#### `GET /trading-api/`
**Health check**

Response:
```json
{"status": "ok", "message": "STRUCT.ai Trading API"}
```

---

#### `GET /trading-api/structure/analysis`
**Full market structure analysis — the primary endpoint used by the dashboard**

Query params:
- `symbol` (default: `"USDJPY"`)
- `timeframe` (default: `"M15"`)
- `count` (default: `500`)

Response:
```json
{
  "symbol": "USDJPY",
  "timeframe": "M15",
  "candles": [
    {"time": 1713360000, "open": 154.20, "high": 154.45, "low": 154.10, "close": 154.38, "volume": 1234}
  ],
  "zigzag": [
    {"time": 1713360000, "price": 154.45, "type": "high"}
  ],
  "structure": [
    {"time": 1713360000, "price": 154.45, "type": "high", "label": "HH"}
  ],
  "bos": [
    {"time": 1713363600, "price": 154.45, "type": "bullish_bos", "broken_level": 154.45}
  ],
  "choch": [],
  "sessions": [
    {"session": "asian", "date": "2025-01-15", "high": 154.60, "low": 154.10, "start_time": 1736899200, "end_time": 1736928000, "color": "#9B59B6"}
  ],
  "mtf_sr": {
    "15m": [{"price": 154.50, "type": "resistance", "touches": 3, "timeframe": "15m"}],
    "1h": [],
    "4h": []
  },
  "mtf_bias": {
    "M15": {"trend": "bullish", "last_high": 154.45, "last_low": 153.90},
    "H1":  {"trend": "neutral", "last_high": 155.00, "last_low": 153.50},
    "H4":  {"trend": "bearish", "last_high": 156.00, "last_low": 153.00}
  },
  "zones": [
    {"type": "demand", "top": 154.20, "bottom": 153.90, "time": 1713340000, "end_time": 1713360000, "strength": 0.45}
  ],
  "trend": {"trend": "bullish", "last_high": 154.45, "last_low": 153.90},
  "data_source": "twelve_data",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

#### `GET /trading-api/structure/zigzag`
Returns only the ZigZag points array. Same query params.

---

#### `GET /trading-api/structure/bos`
Returns only BOS events array. Same query params.

---

#### `GET /trading-api/structure/choch`
Returns only CHOCH events array. Same query params.

---

#### `GET /trading-api/structure/sessions`
Returns only session boxes array. Same query params.

---

#### `GET /trading-api/structure/mtf-sr`
Returns MTF S/R levels dict (`{15m: [...], 1h: [...], 4h: [...]}`). Only `symbol` param applies (always fetches all 3 timeframes).

---

#### `GET /trading-api/structure/mtf-bias`
Returns MTF bias dict (`{M15: {...}, H1: {...}, H4: {...}}`). Only `symbol` param applies.

---

#### `GET /trading-api/structure/zones`
Returns only zones array. Same query params.

---

#### `POST /trading-api/mt5/bars`
**Receive live bars from the MT5 Windows bridge**

Headers: `X-MT5-Secret: {hmac_sha256_hex}`, `Content-Type: application/json`

Body:
```json
{
  "symbol": "USDJPY",
  "timeframe": "M15",
  "bars": [
    {"time": 1713360000, "open": 154.20, "high": 154.45, "low": 154.10, "close": 154.38, "volume": 1234}
  ]
}
```

Response (200 on success):
```json
{"status": "ok", "bars_received": 500}
```

Response (401 on HMAC failure):
```json
{"detail": "Unauthorized"}
```

---

#### `GET /trading-api/mt5/status`
Returns the current MT5 data store status.

Response:
```json
{
  "USDJPY_M15": 500,
  "USDJPY_H1": 300,
  "USDJPY_H4": 200
}
```

---

### Express API Server (TypeScript, prefix: `/api`)

#### `GET /api/healthz`
```json
{"status": "ok"}
```

---

## 12. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    WINDOWS MACHINE (MT5)                         │
│                                                                   │
│  MetaTrader 5 ──► mt5_bridge.py ──► POST /trading-api/mt5/bars  │
│                    (every 30s)         (HMAC signed)              │
└─────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    REPLIT (Linux/NixOS)                           │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Python FastAPI  (port 8000)                  │    │
│  │                                                           │    │
│  │  mt5_store.py ──► stores bars in memory (thread-safe)   │    │
│  │       │                                                   │    │
│  │       ▼                                                   │    │
│  │  data_service.py                                         │    │
│  │    ├── if MT5 data fresh (<120s) → use mt5_store        │    │
│  │    └── else → Twelve Data REST API ──► HTTP GET         │    │
│  │       │                                                   │    │
│  │       ▼                                                   │    │
│  │  pandas DataFrame (OHLCV)                                │    │
│  │       │                                                   │    │
│  │       ▼                                                   │    │
│  │  zigzag_engine ──► structure_engine ──► trend_engine    │    │
│  │       │                    │                  │           │    │
│  │       ├── bos_engine ──────┘                  │           │    │
│  │       ├── choch_engine ────────────────────────┘          │    │
│  │       ├── mtf_sr_engine (runs 3x for M15/H1/H4)         │    │
│  │       ├── session_engine                                  │    │
│  │       └── zones_engine                                   │    │
│  │                    │                                      │    │
│  │                    ▼                                      │    │
│  │         JSON response via /trading-api/structure/*       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │            React Dashboard  (port 24210)                  │    │
│  │                                                           │    │
│  │  use-trading-api.ts (TanStack Query, refetch 30s)       │    │
│  │       │                                                   │    │
│  │       ▼                                                   │    │
│  │  TradingChart.tsx                                        │    │
│  │    ├── Candlestick series (lightweight-charts v5)        │    │
│  │    ├── ZigZag line series                               │    │
│  │    ├── Structure markers (HH/LH/HL/LL)                  │    │
│  │    ├── BOS/CHOCH markers (createSeriesMarkers)          │    │
│  │    ├── MTF S/R horizontal lines                         │    │
│  │    ├── Session boxes (Asian/London/NY)                   │    │
│  │    ├── Supply/Demand zone rectangles                    │    │
│  │    └── MTF Bias overlay panel (15M/1H/4H)              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    USER'S BROWSER (iframe)
```

---

## 13. Algorithm Deep Dives

### 13.1 ZigZag Algorithm

The ZigZag algorithm is the foundation of all other analyses. Every other engine depends on its output.

**Step 1 — Fractal identification:**

For each bar at index `i` (with `FRACTAL_N = 5` bars on each side):

```
Pivot High at i: high[i] > max(high[i-5..i-1]) AND high[i] > max(high[i+1..i+5])
Pivot Low  at i: low[i]  < min(low[i-5..i-1])  AND low[i]  < min(low[i+1..i+5])
```

A bar can be both a pivot high and pivot low simultaneously (though this is rare with FRACTAL_N=5).

**Step 2 — Strict alternation enforcement:**

The raw list of fractals may have consecutive highs or consecutive lows. The engine resolves conflicts:

```
raw_points = [H, H, L, H, L, L, H]
             ↑ conflict    ↑ conflict

Resolution:
  [H, H] → keep the higher H
  [L, L] → keep the lower L

final_points = [H(higher), L, H, L(lower), H]
```

This guarantees the final zigzag strictly alternates between highs and lows.

**Why FRACTAL_N=5?**

N=5 requires 11 bars total (5 before + bar + 5 after). This filters out noise while still being responsive on M15 charts. On H4 charts the same N=5 represents more calendar time, giving higher-significance pivots.

---

### 13.2 Market Structure Algorithm

Structure labels are applied to alternate zigzag points:

```
Highs sequence: H1 → H2 → H3 → H4
Labels:         HH   HH   LH   HH
               (default) (H2>H3) (H4>H3)

Lows sequence:  L1 → L2 → L3 → L4
Labels:         HL   HL   LL   HL
               (default) (L2>L3) (L4>L3)
```

The separation into two independent sequences (highs and lows) means each is compared only to the previous of the same type, not to the overall last pivot.

---

### 13.3 BOS Detection

```
Bullish trend example:
  Last swing high = 154.45
  Scanning candles after last structure point...
  Candle close = 154.47 → BULLISH BOS detected at time T, broken_level = 154.45
  ↑
  (close broke above last swing high → continuation signal)

Bearish trend example:
  Last swing low = 153.90
  Candle close = 153.88 → BEARISH BOS detected at time T, broken_level = 153.90
```

**Important:** Only the **close price** is checked, not the high or low wicks. This reduces false signals from wick-only breaks.

---

### 13.4 CHOCH Detection

```
Bullish trend example:
  Last swing low = 153.90
  Candle close = 153.88 → BULLISH CHOCH detected (price broke below swing low IN a bullish trend)
  ↑
  ("bullish_choch" = choch that occurs in a bullish trend, signaling potential reversal to bearish)

Bearish trend example:
  Last swing high = 154.45
  Candle close = 154.47 → BEARISH CHOCH detected
```

Note: The naming convention `bullish_choch`/`bearish_choch` refers to the current trend direction, not the direction of the anticipated reversal. A `bullish_choch` signals a potential reversal from bullish to bearish.

---

### 13.5 MTF S/R Level Detection

The algorithm avoids arbitrary fixed levels by deriving S/R levels from actual market pivots.

**Touch counting:**

For a given pivot at price P, scan all other pivots:
```
touches = sum(1 for other_pivot if abs(other_pivot.price - P) / P <= tolerance)
```

If `touches >= min_touches`, the level is confirmed.

**Deduplication:**

If two levels L1 and L2 are within tolerance of each other, merge them by keeping the one with more touches.

**Timeframe significance:**
- 15m levels: tightest tolerance (0.05%), more levels, shorter-term significance
- 1h levels: medium tolerance (0.1%), fewer levels, intraday significance
- 4h levels: widest tolerance (0.2%), fewest levels, highest significance

---

### 13.6 Session Box Detection

```
UTC Time   0    4    8   12   16   20   24
           │────────│         │         │
Asian:     0──────────────8
London:              8──────────────16
New York:                  13─────────────21
                       └──┘
                   London/NY overlap
                   (13:00-16:00 UTC)
```

The session boxes show the **range** (high to low) of each session on each calendar day. This is used by traders to identify:
- The Asian session range as a potential "liquidity pool"
- London and NY opening breaks as high-probability trade setups

---

### 13.7 Zone Detection

A zone is created between any two consecutive ZigZag pivots where the price move exceeds 0.3%:

```
ZigZag: L(153.90) → H(154.50)
Move: (154.50 - 153.90) / 153.90 * 100 = 0.39% > 0.3%
Zone type: "demand" (H is a high → the move was upward → the low area is demand)
Zone boundaries: bottom=153.90, top=154.50
```

**Zone interpretation:**
- **Demand zone:** Area from which price moved up strongly → buyers were active here → potential support
- **Supply zone:** Area from which price moved down strongly → sellers were active here → potential resistance

---

## 14. Frontend Chart Rendering

### TradingView Lightweight Charts v5 API Usage

The dashboard uses `lightweight-charts` v5, which introduced significant API changes from v4:

**v5 Series Markers API (correct usage in this codebase):**
```typescript
import { createSeriesMarkers } from "lightweight-charts";

const markersPrimitive = createSeriesMarkers(candleSeries, [
  {
    time: timestamp,
    position: "aboveBar" | "belowBar",
    color: "#color",
    shape: "arrowUp" | "arrowDown" | "circle" | "square",
    text: "HH" | "LH" | "HL" | "LL" | "BOS" | "CHOCH"
  }
]);
```

**ZigZag rendering:**
```typescript
const zigzagSeries = chart.addLineSeries({
  color: "#F59E0B",       // Amber
  lineWidth: 1,
  lineStyle: LineStyle.Dashed,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
});
zigzagSeries.setData(zigzagPoints.map(p => ({ time: p.time, value: p.price })));
```

**Horizontal S/R Lines:**
```typescript
const srColors = { "15m": "#FCD34D", "1h": "#FB923C", "4h": "#EF4444" };
srLevel.forEach(level => {
  const priceLine = series.createPriceLine({
    price: level.price,
    color: srColors[level.timeframe],
    lineWidth: 1,
    lineStyle: LineStyle.Dotted,
    axisLabelVisible: true,
    title: `${level.timeframe} ${level.type}`,
  });
});
```

**Session Boxes** and **Zone Rectangles** use the Lightweight Charts v5 primitive API (`ISeriesPrimitive`) for rendering rectangle overlays on the chart canvas.

---

## 15. Windows Setup & MT5 Integration

For users running MetaTrader 5 on Windows:

**Step 1:** Run `install_requirements.bat`
- Installs: fastapi, uvicorn, pandas, numpy, httpx, python-dotenv, MetaTrader5, requests

**Step 2:** Set environment variables
```bat
set TWELVE_DATA_API_KEY=your_key_here
set MT5_BRIDGE_SECRET=your_secret_here
set API_URL=http://your-replit-app-url.replit.app/
```

**Step 3:** Run `START_HERE.bat`
- Starts uvicorn on port 8000
- Starts mt5_bridge.py (connects to MT5, begins pushing bars every 30s)

**Step 4:** Open the dashboard in a browser

**MT5 requirements:**
- MetaTrader 5 must be running with an active broker account
- USDJPY symbol must be available in Market Watch
- Python `MetaTrader5` package requires the MT5 terminal to be on the same Windows machine

**Security:** The `MT5_BRIDGE_SECRET` must match between `mt5_bridge.py` (set as env var on Windows) and the API server (set as env var on Replit). HMAC-SHA256 is used to authenticate every push.

---

## 16. Deployment & Ports

| Artifact | Kind | Port | Preview Path | URL Prefix |
|---|---|---|---|---|
| trading-dashboard | frontend | 24210 | `/` | (root) |
| trading-api | api | 8000 | `/trading-api` | `/trading-api` |
| api-server | api | dynamic ($PORT) | `/api-server` | `/api` |
| mockup-sandbox | design | dynamic ($PORT) | `/canvas` | (canvas only) |

**Replit routing:** Replit's reverse proxy routes requests by path prefix to the correct artifact's local port.

**CORS:** The Python API has `allow_origins=["*"]` — suitable for development. For production, this should be restricted to the actual dashboard domain.

**Replit artifact registration:** As of the zip, `trading-api` and `trading-dashboard` have `artifact.toml` files but may not yet be registered in the workspace's `.replit` file. They need to be added as registered artifacts to get proper workflow management and URL routing.

---

## 17. File Index — All 221 Files

### Root Level (11 files)
```
.gitignore
.npmrc
.replitignore
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
pyproject.toml
replit.md
tsconfig.base.json
tsconfig.json
uv.lock
```

### artifacts/api-server/ (10 files)
```
artifacts/api-server/.replit-artifact/artifact.toml
artifacts/api-server/build.mjs
artifacts/api-server/package.json
artifacts/api-server/tsconfig.json
artifacts/api-server/src/app.ts
artifacts/api-server/src/index.ts
artifacts/api-server/src/lib/.gitkeep
artifacts/api-server/src/lib/logger.ts
artifacts/api-server/src/middlewares/.gitkeep
artifacts/api-server/src/routes/health.ts
artifacts/api-server/src/routes/index.ts
```

### artifacts/trading-api/ (17 files)
```
artifacts/trading-api/.replit-artifact/artifact.toml
artifacts/trading-api/main.py
artifacts/trading-api/routers/__init__.py
artifacts/trading-api/routers/structure.py
artifacts/trading-api/services/__init__.py
artifacts/trading-api/services/bos_engine.py
artifacts/trading-api/services/choch_engine.py
artifacts/trading-api/services/data_service.py
artifacts/trading-api/services/mt5_store.py
artifacts/trading-api/services/mtf_sr_engine.py
artifacts/trading-api/services/session_engine.py
artifacts/trading-api/services/structure_engine.py
artifacts/trading-api/services/trend_engine.py
artifacts/trading-api/services/zigzag_engine.py
artifacts/trading-api/services/zones_engine.py
artifacts/trading-api/mt5-bridge/mt5_bridge.py
artifacts/trading-api/mt5-bridge/requirements.txt
```

### artifacts/trading-dashboard/ (84 files)
```
artifacts/trading-dashboard/.replit-artifact/artifact.toml
artifacts/trading-dashboard/components.json
artifacts/trading-dashboard/index.html
artifacts/trading-dashboard/package.json
artifacts/trading-dashboard/tsconfig.json
artifacts/trading-dashboard/vite.config.ts
artifacts/trading-dashboard/public/favicon.svg
artifacts/trading-dashboard/src/App.tsx
artifacts/trading-dashboard/src/index.css
artifacts/trading-dashboard/src/main.tsx
artifacts/trading-dashboard/src/components/TopBar.tsx
artifacts/trading-dashboard/src/components/TradingChart.tsx
artifacts/trading-dashboard/src/components/ui/accordion.tsx
artifacts/trading-dashboard/src/components/ui/alert-dialog.tsx
artifacts/trading-dashboard/src/components/ui/alert.tsx
artifacts/trading-dashboard/src/components/ui/aspect-ratio.tsx
artifacts/trading-dashboard/src/components/ui/avatar.tsx
artifacts/trading-dashboard/src/components/ui/badge.tsx
artifacts/trading-dashboard/src/components/ui/breadcrumb.tsx
artifacts/trading-dashboard/src/components/ui/button.tsx
artifacts/trading-dashboard/src/components/ui/calendar.tsx
artifacts/trading-dashboard/src/components/ui/card.tsx
artifacts/trading-dashboard/src/components/ui/carousel.tsx
artifacts/trading-dashboard/src/components/ui/chart.tsx
artifacts/trading-dashboard/src/components/ui/checkbox.tsx
artifacts/trading-dashboard/src/components/ui/collapsible.tsx
artifacts/trading-dashboard/src/components/ui/command.tsx
artifacts/trading-dashboard/src/components/ui/context-menu.tsx
artifacts/trading-dashboard/src/components/ui/dialog.tsx
artifacts/trading-dashboard/src/components/ui/drawer.tsx
artifacts/trading-dashboard/src/components/ui/dropdown-menu.tsx
artifacts/trading-dashboard/src/components/ui/form.tsx
artifacts/trading-dashboard/src/components/ui/hover-card.tsx
artifacts/trading-dashboard/src/components/ui/input-otp.tsx
artifacts/trading-dashboard/src/components/ui/input.tsx
artifacts/trading-dashboard/src/components/ui/label.tsx
artifacts/trading-dashboard/src/components/ui/menubar.tsx
artifacts/trading-dashboard/src/components/ui/navigation-menu.tsx
artifacts/trading-dashboard/src/components/ui/pagination.tsx
artifacts/trading-dashboard/src/components/ui/popover.tsx
artifacts/trading-dashboard/src/components/ui/progress.tsx
artifacts/trading-dashboard/src/components/ui/radio-group.tsx
artifacts/trading-dashboard/src/components/ui/resizable.tsx
artifacts/trading-dashboard/src/components/ui/scroll-area.tsx
artifacts/trading-dashboard/src/components/ui/select.tsx
artifacts/trading-dashboard/src/components/ui/separator.tsx
artifacts/trading-dashboard/src/components/ui/sheet.tsx
artifacts/trading-dashboard/src/components/ui/sidebar.tsx
artifacts/trading-dashboard/src/components/ui/skeleton.tsx
artifacts/trading-dashboard/src/components/ui/slider.tsx
artifacts/trading-dashboard/src/components/ui/sonner.tsx
artifacts/trading-dashboard/src/components/ui/switch.tsx
artifacts/trading-dashboard/src/components/ui/table.tsx
artifacts/trading-dashboard/src/components/ui/tabs.tsx
artifacts/trading-dashboard/src/components/ui/textarea.tsx
artifacts/trading-dashboard/src/components/ui/toast.tsx
artifacts/trading-dashboard/src/components/ui/toaster.tsx
artifacts/trading-dashboard/src/components/ui/toggle-group.tsx
artifacts/trading-dashboard/src/components/ui/toggle.tsx
artifacts/trading-dashboard/src/components/ui/tooltip.tsx
artifacts/trading-dashboard/src/hooks/use-mobile.tsx
artifacts/trading-dashboard/src/hooks/use-toast.ts
artifacts/trading-dashboard/src/hooks/use-trading-api.ts
artifacts/trading-dashboard/src/lib/utils.ts
artifacts/trading-dashboard/src/pages/Dashboard.tsx
```

### artifacts/mockup-sandbox/ (84 files)
```
artifacts/mockup-sandbox/.replit-artifact/artifact.toml
artifacts/mockup-sandbox/components.json
artifacts/mockup-sandbox/index.html
artifacts/mockup-sandbox/mockupPreviewPlugin.ts
artifacts/mockup-sandbox/package.json
artifacts/mockup-sandbox/tsconfig.json
artifacts/mockup-sandbox/vite.config.ts
artifacts/mockup-sandbox/src/App.tsx
artifacts/mockup-sandbox/src/index.css
artifacts/mockup-sandbox/src/main.tsx
artifacts/mockup-sandbox/src/.generated/mockup-components.ts
artifacts/mockup-sandbox/src/lib/utils.ts
artifacts/mockup-sandbox/src/hooks/use-mobile.tsx
artifacts/mockup-sandbox/src/hooks/use-toast.ts
artifacts/mockup-sandbox/src/components/ui/ (70 shadcn/ui components identical to trading-dashboard's)
```

### lib/ (12 files)
```
lib/api-client-react/package.json
lib/api-client-react/tsconfig.json
lib/api-client-react/src/index.ts
lib/api-client-react/src/custom-fetch.ts
lib/api-client-react/src/generated/api.ts
lib/api-client-react/src/generated/api.schemas.ts
lib/api-zod/package.json
lib/api-zod/tsconfig.json
lib/api-zod/src/index.ts
lib/db/drizzle.config.ts
lib/db/package.json
lib/db/tsconfig.json
lib/db/src/index.ts
lib/db/src/schema/index.ts
```

### scripts/ (4 files)
```
scripts/package.json
scripts/post-merge.sh
scripts/tsconfig.json
scripts/src/hello.ts
```

### Other (2 files)
```
.upm/store.json
replit.md
```

---

*This document was generated from a full read of all 221 files in the STRUCT-AI-Updated_1776446411412.zip archive.*
