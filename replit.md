# STRUCT.ai — AI-Powered Forex Trading Platform

## Project Overview

A professional-grade, multi-phase AI-powered USDJPY trading platform built with:
- **Python FastAPI** backend (trading logic, Twelve Data API integration)
- **React + Vite + TradingView Lightweight Charts v5** frontend
- **pnpm monorepo** workspace

---

## Phase 1 — Rule-Based Market Structure Dashboard ✅ COMPLETE

**Status:** Fully built, tested (29-step E2E + 7 backend logic suites), zero errors.

### Features
- Live USDJPY candlestick chart (5M / 15M / 1H / 4H timeframes)
- ZigZag swing detection with strict alternation guarantee
- Market structure labels: HH / LH / HL / LL (professional definition)
- MTF Bias badges in TopBar: 4H → 1H → 15M → [active TF] showing BULL / BEAR / CONS
- MTF S/R levels: 15M (100 pip range), 1H (200 pip range), 4H (300 pip range) — correctly labeled with S/R flip
- Session boxes: Asian (amber), London (blue), NY (green) with real overlaps
- API rate-limit protection: in-flight deduplication + retry backoff

### Key Correctness Properties
- ZigZag: strict high→low→high alternation enforced
- Structure labels: mathematically verified (HH = higher high vs prev, etc.)
- Trend engine: last confirmed HH/LH + last confirmed HL/LL → bullish/bearish/neutral (CONS)
- S/R: proximity-filtered + S/R flip applied (resistance always above price, support always below)
- Sessions: real Forex times (Asian 00-09, London 08-17, NY 13-22 UTC) with correct overlaps

### Architecture
```
artifacts/trading-api/          ← Python FastAPI (port 8000)
  services/
    data_service.py             ← Twelve Data API, 60s cache, dedup
    zigzag_engine.py            ← Swing detection
    structure_engine.py         ← HH/LH/HL/LL classification
    trend_engine.py             ← Trend detection (bullish/bearish/neutral)
    mtf_sr_engine.py            ← S/R levels with flip + proximity filter
    session_engine.py           ← Session boxes (Asian/London/NY)
  routers/structure.py          ← All API endpoints

artifacts/trading-dashboard/    ← React + Vite (port 24210)
  src/
    components/TradingChart.tsx ← Chart, ZigZag, S/R, sessions
    components/TopBar.tsx       ← Bias badges (BULL/BEAR/CONS), toggles
    hooks/use-trading-api.ts    ← React Query hooks
    pages/Dashboard.tsx         ← Main page
```

### API Endpoints
| Endpoint | Description |
|---|---|
| `GET /trading-api/analysis` | Candles + ZigZag + structure labels + trend |
| `GET /trading-api/sr-levels` | MTF S/R levels (15m/1h/4h) |
| `GET /trading-api/mtf-bias` | Trend bias per timeframe |
| `GET /trading-api/sessions` | Session boxes |

---

## Phase 2 — (Planned)

Next: MT5 integration → AI assistant → AI agent

---

## User Profile
- Instrument: USDJPY only
- Account: $110, goal $2-3/day, 2:1 R/R, ~1-2 trades/day
- Location: Islamabad, Pakistan (PKT = UTC+5)

## Environment
- `TWELVE_DATA_API_KEY` — market data API (8 credits/minute free tier)
- `SESSION_SECRET` — session management

## Monorepo
- pnpm workspaces
- Node.js 24, TypeScript 5.9
- `artifacts/api-server` — Express proxy server (port 8080)
- `artifacts/mockup-sandbox` — Component preview (port 8081)
