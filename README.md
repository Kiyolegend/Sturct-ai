# STRUCT.ai

> Real-time forex trading copilot — Smart Money Concepts analysis across 8 currency pairs and 4 timeframes, streaming live from MetaTrader 5 to a FastAPI backend and a React dashboard.

![STRUCT.ai dashboard](docs/screenshots/dashboard.png)

---

## What it does

STRUCT.ai is a **manual-trading copilot**. It does not place orders for you. Instead, it watches the market in real time and shows the structural information you would otherwise have to draw by hand — swing points, market structure (HH / LH / HL / LL), break-of-structure events, multi-timeframe support and resistance, trading sessions, and trend bias on every timeframe at once.

Built for a discretionary intraday workflow on USD/JPY, GBP/USD, EUR/USD, EUR/JPY and GBP/JPY, on the 5M / 15M / 1H / 4H timeframes simultaneously.

---

## Architecture

```
                    ┌──────────────────────────┐
                    │   MetaTrader 5 Terminal   │
                    │   (your broker, Windows)  │
                    └─────────────┬────────────┘
                                  │  reads OHLC every 30s
                                  ▼
                    ┌──────────────────────────┐
                    │      MT5 Bridge           │
                    │   Python script (local)   │
                    └─────────────┬────────────┘
                                  │  HTTP POST  /trading-api/mt5/push
                                  ▼
        ┌────────────────────────────────────────────────┐
        │              FastAPI Backend                    │
        │   ┌──────────┐  ┌──────────┐  ┌──────────┐    │
        │   │ ZigZag   │  │ Structure│  │  Trend   │    │
        │   │  engine  │  │  engine  │  │  engine  │    │
        │   └──────────┘  └──────────┘  └──────────┘    │
        │   ┌──────────┐  ┌──────────┐  ┌──────────┐    │
        │   │   BOS    │  │  CHOCH   │  │ MTF S/R  │    │
        │   │  engine  │  │  engine  │  │  engine  │    │
        │   └──────────┘  └──────────┘  └──────────┘    │
        │   ┌──────────┐  ┌──────────┐  ┌──────────┐    │
        │   │ Sessions │  │  Zones   │  │Trendline │    │
        │   └──────────┘  └──────────┘  └──────────┘    │
        │                                                 │
        │     Twelve Data API ← fallback if MT5 offline   │
        └─────────────────────┬──────────────────────────┘
                              │  REST + WebSocket
                              ▼
                ┌────────────────────────────┐
                │     React Dashboard         │
                │  TradingView Lightweight    │
                │       Charts v5             │
                └────────────────────────────┘
```

---

## Tech stack

| Layer | Stack |
|---|---|
| **Backend** | Python 3.11, FastAPI, Pandas, NumPy, httpx, WebSockets |
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, TradingView Lightweight Charts v5, TanStack Query |
| **Bridge** | Python, MetaTrader5 SDK, requests |
| **Data sources** | MetaTrader 5 (primary), Twelve Data API (fallback) |
| **Tooling** | pnpm (frontend), pip (backend), Windows .bat one-click launcher |

---

## Screenshots

| | |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Launcher console](docs/screenshots/launcher.png) |
| Main dashboard with multi-timeframe bias and S/R | One-click Windows launcher |
| ![MT5 bridge log](docs/screenshots/mt5-bridge.png) | ![API server log](docs/screenshots/api-server.png) |
| MT5 bridge pushing 5 symbols × 4 timeframes | FastAPI server processing structure analysis |

---

## Quick start (Windows)

**Prerequisites:**
- Windows 10 or 11
- Python 3.11 or higher
- Node.js 20 or higher
- pnpm (`npm install -g pnpm`)
- MetaTrader 5 installed and logged in to your broker (live or demo)

**Steps:**

1. Clone the repo
   ```
   git clone https://github.com/<your-username>/struct-ai.git
   cd struct-ai
   ```

2. Copy the env template and add your Twelve Data API key (free tier works)
   ```
   copy .env.example .env
   notepad .env
   ```

3. Open MetaTrader 5 and log in to your account. Make sure the symbols you want (USD/JPY, EUR/USD, etc.) are visible in the Market Watch panel.

4. Double-click `launcher/STRUCT-AI.bat`

   This installs everything and starts three windows:
   - The FastAPI backend (`http://localhost:8001`)
   - The MT5 bridge (pushing candles every 30 seconds)
   - The React dashboard (`http://localhost:5173`)

5. The dashboard opens automatically in your default browser.

To stop everything, close the three black console windows.

---

## Project structure

```
struct-ai/
├── backend/                    Python FastAPI
│   ├── main.py                 App entry, CORS, routers, WebSocket
│   ├── requirements.txt
│   ├── routers/                HTTP endpoints
│   │   ├── data.py             Raw OHLC
│   │   ├── mt5.py              MT5 bridge push + status
│   │   └── structure.py        Analysis endpoints (bias, S/R, sessions)
│   ├── services/               Analysis engines
│   │   ├── data_service.py     MT5-primary, Twelve Data fallback
│   │   ├── mt5_store.py        In-memory candle store
│   │   ├── zigzag_engine.py    Strict-alternation swing detection
│   │   ├── structure_engine.py HH / LH / HL / LL classification
│   │   ├── trend_engine.py     Per-timeframe trend bias
│   │   ├── trendline_engine.py Diagonal trendlines
│   │   ├── bos_engine.py       Break of Structure
│   │   ├── choch_engine.py     Change of Character
│   │   ├── mtf_sr_engine.py    Multi-timeframe S/R with flip
│   │   ├── session_engine.py   Asian / London / NY session boxes
│   │   └── zones_engine.py     Demand / supply zones
│   └── mt5-bridge/
│       └── mt5_bridge.py       Windows-only MT5 → API push script
│
├── frontend/                   React + Vite dashboard
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── pages/Dashboard.tsx
│       ├── components/
│       │   ├── TradingChart.tsx       Candlestick + ZigZag + S/R + sessions
│       │   ├── TopBar.tsx             Bias chips, symbol/timeframe selector
│       │   └── ui/                    shadcn/ui primitives
│       └── hooks/
│           └── use-trading-api.ts     TanStack Query hooks
│
├── launcher/                   Windows .bat one-click scripts
│   ├── STRUCT-AI.bat           Main launcher (installs + starts everything)
│   ├── start_api.bat           Backend only
│   ├── start_bridge.bat        MT5 bridge only
│   └── install_requirements.bat
│
├── docs/
│   ├── STRUCT-AI-Full-Documentation.md
│   └── screenshots/
│
├── ARCHITECTURE.md
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

---

## API endpoints

All endpoints are mounted under the `/trading-api` prefix.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/analysis` | Candles + ZigZag swings + structure labels + trend |
| GET | `/sr-levels` | Multi-timeframe support / resistance levels |
| GET | `/mtf-bias` | Trend bias per timeframe (BULL / BEAR / CONS) |
| GET | `/sessions` | Asian / London / NY session boxes |
| GET | `/mt5/status` | Whether the MT5 bridge is currently online |
| POST | `/mt5/push` | Bridge endpoint — receives OHLC candles from MT5 |
| WS | `/ws` | Live price stream over WebSocket |

---

## How the engines work (short version)

- **ZigZag engine** — detects swing highs and lows with strict high → low → high alternation, so the structure is always clean.
- **Structure engine** — labels each swing as HH (higher high), LH (lower high), HL (higher low), or LL (lower low) using the standard market-structure definition.
- **Trend engine** — looks at the last confirmed HH/LH and HL/LL pair to decide bullish, bearish, or consolidation per timeframe.
- **MTF S/R engine** — extracts support and resistance from 15M, 1H and 4H, applies the S/R flip rule (resistance is always above price, support always below), and filters by proximity.
- **BOS / CHOCH engines** — detect break-of-structure and change-of-character events that signal trend continuation or reversal.
- **Session engine** — overlays the Asian (00–09 UTC), London (08–17 UTC), and New York (13–22 UTC) sessions, including their natural overlap windows.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `TWELVE_DATA_API_KEY` | recommended | Fallback market data when MT5 is offline. Free tier: 8 credits/min |
| `MT5_BRIDGE_SECRET` | optional | Shared secret between bridge and API. If empty, validation is skipped (dev mode) |
| `TRADING_API_PORT` | optional | Defaults to `8001` |

Copy `.env.example` to `.env` and fill in the values. The launcher loads them automatically.

---

## Status and roadmap

**Phase 1 — Rule-based market structure dashboard — ✅ Complete**
- Live candles across 5 pairs × 4 timeframes
- ZigZag swings with strict alternation
- HH / LH / HL / LL structure labels
- Multi-timeframe trend bias chips
- Multi-timeframe S/R with flip and proximity filtering
- Session overlays
- MT5 primary data source with Twelve Data fallback
- Rate-limit protection (in-flight deduplication + retry backoff)
- One-click Windows launcher

**Known issues** — see [docs/STRUCT-AI-Full-Documentation.md](docs/STRUCT-AI-Full-Documentation.md) for the full list and recommended fixes.

**Phase 2 (planned)** — AI assistant layer, signal scoring, trade-setup suggestions.

---

## A note on origin

This project was built in roughly 3 days as an AI-assisted prototype to explore what a personal trading copilot could look like. The architecture, engine logic, and integration design are documented above; the implementation was iterated heavily with AI tooling. It is shared publicly for transparency, learning, and as a working reference for anyone building similar Smart Money Concepts tools.

The code is not production trading infrastructure. It is a research and learning artifact. Use it accordingly.

---

## License

MIT — see [LICENSE](LICENSE).

## Contact

Built by Azaan Ul Haq — Software Engineering student, International Islamic University Islamabad.

If you're using STRUCT.ai or building something similar, I'd love to hear about it.
