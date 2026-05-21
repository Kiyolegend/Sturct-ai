import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Minus, ChevronUp } from 'lucide-react';
import { useTradingAnalysis } from '@/hooks/use-trading-api';
import type {
  TradingAnalysisResponse,
  SRLevel,
  BosChochResponse,
  BosEvent,
  ChochEvent,
  StructureLabel,
  Zone,
} from '@/hooks/use-trading-api';
import { pipSize, detectOrderBlocks, detectFVGs } from '@/components/TradingChart';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BiasTimeframe {
  trend: 'bullish' | 'bearish' | 'neutral';
  current_price?: number;
  last_high_price?: number;
  last_low_price?: number;
}
interface BiasData {
  bias_15m?: BiasTimeframe;
  bias_1h?:  BiasTimeframe;
  bias_4h?:  BiasTimeframe;
}

type Direction   = 'long' | 'short';
type SignalState = 'active' | 'waiting' | 'no-signal';
type Confidence  = 'HIGH' | 'MED' | 'LOW';
type Mode        = 's1' | 's2' | 's3';

interface TradeSignal {
  state:         SignalState;
  direction?:    Direction;
  entry?:        number;
  sl?:           number;
  tp1?:          number;
  tp1Rr?:        number;
  tp1Label?:     string;
  slPips?:       number;
  confidence?:   Confidence;
  entrySource?:  string;
  priceInZone?:  boolean;
  score?:        number;
  reason:        string;
}

interface TradeTellerProps {
  symbol:       string;
  biasData:     BiasData | undefined;
  srLevels:     SRLevel[] | undefined;
  bosChochData: BosChochResponse | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtPrice(price: number, currentPrice: number): string {
  return pipSize(currentPrice) === 0.01 ? price.toFixed(3) : price.toFixed(5);
}

function round5(n: number): number { return Math.round(n * 1e5) / 1e5; }

/** London 07–16 UTC, NY 12–21 UTC → 10 pts; Asia (00–07 UTC) → 0 */
function sessionBonus(): number {
  const h = new Date().getUTCHours();
  return h >= 7 && h < 22 ? 10 : 0;
}

function candleBodyStrength(candle: any): number {
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  return Math.abs(candle.close - candle.open) / range;
}

function zoneNearPrice(zones: Zone[], price: number, currentPrice: number): boolean {
  return zones.some(z => {
    const spread = currentPrice * 0.005;
    return Math.abs(z.center - price) <= spread || (price >= z.bottom && price <= z.top);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — MTF Pullback Precision Scalping
// ─────────────────────────────────────────────────────────────────────────────
//
// Updates applied:
//  FIX 1 — BOS freshness window expanded from 1h to 2h (matches scalping engine)
//  FIX 2 — 15M bias counter check added (rejects if 15M opposes 4H+1H direction)
//  FIX 3 — Hard 15-pip distance post-filter added (matches scalping engine hard limit)
//
// Full logic:
//  1. 4H + 1H must agree (same non-neutral trend)
//  2. 15M must not oppose direction (FIX 2)
//  3. Find 15M pullback level: last HL (bullish) or LH (bearish), max 24h old
//  4. Distance to pullback ≤ 50p pre-filter, ≤ 15p hard post-filter (FIX 3)
//  5. Reject if counter CHoCH present on 15M within 4h
//  6. At least 1 5M BOS within 2h (FIX 1); if only 1, candle body ≥ 70%
//  7. Score 0-100: alignment(30) + pullback(20) + BOS quality(20) +
//                  distance(15) + session(10) + zone(5)
//  8. Entry = market, SL = pullback ± 5p, TP = 2R
// ─────────────────────────────────────────────────────────────────────────────

function s1FindPullback(
  labels: StructureLabel[],
  direction: Direction,
): { price: number; time: number } | null {
  const target = direction === 'long' ? 'HL' : 'LH';
  const sorted = [...labels].sort((a, b) => b.time - a.time);
  const found  = sorted.find(l => l.label === target);
  if (!found) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - found.time > 24 * 3600) return null;
  return { price: found.price, time: found.time };
}

function s1BosCheck(
  bosEvents: BosEvent[],
  candles5m: any[],
  direction: Direction,
): { count: number; strong: boolean } {
  const dir    = direction === 'long' ? 'bullish' : 'bearish';
  const nowSec = Math.floor(Date.now() / 1000);

  // FIX 1: filter ALL BOS events within 2h window (was: only checking most recent within 1h)
  const recent = [...bosEvents]
    .filter(b => b.direction === dir && (nowSec - b.time) <= 7200)
    .sort((a, b) => b.time - a.time)
    .slice(0, 3);

  if (!recent.length) return { count: 0, strong: false };

  const lastBos = recent[0];
  const candle  = candles5m.find(c => c.time === lastBos.time);
  const strong  = candle ? candleBodyStrength(candle) >= 0.70 : false;

  return { count: recent.length, strong };
}

function s1HasCounterChoch(chochEvents: ChochEvent[], direction: Direction): boolean {
  const counter = direction === 'long' ? 'bearish' : 'bullish';
  const nowSec  = Math.floor(Date.now() / 1000);
  const recent  = [...chochEvents]
    .filter(c => nowSec - c.time <= 4 * 3600)
    .sort((a, b) => b.time - a.time)
    .slice(0, 3);
  return recent.some(c => c.direction === counter);
}

function computeS1Signal(
  biasData:  BiasData | undefined,
  data15m:   TradingAnalysisResponse | undefined,
  candles5m: any[],
  data5m:    TradingAnalysisResponse | undefined,
  data1h:    TradingAnalysisResponse | undefined,
): TradeSignal {
  const bias4h = biasData?.bias_4h?.trend;
  const bias1h = biasData?.bias_1h?.trend;
  const cp     = biasData?.bias_1h?.current_price;

  if (!bias4h || !bias1h || !cp) {
    return { state: 'no-signal', score: 0, reason: 'Bias data loading…' };
  }
  if (bias4h === 'neutral' || bias1h === 'neutral') {
    return { state: 'no-signal', score: 0, reason: '4H or 1H is neutral — no trend to follow' };
  }
  if (bias4h !== bias1h) {
    const dir = bias4h === 'bullish' ? 'long' : 'short';
    return {
      state: 'waiting', score: 0, direction: dir,
      reason: `4H ${bias4h.toUpperCase()} · 1H ${bias1h.toUpperCase()} — MTF misaligned`,
    };
  }

  const direction: Direction = bias4h === 'bullish' ? 'long' : 'short';

  // FIX 2: 15M bias counter check — if 15M actively opposes direction, reject immediately
  const bias15m = biasData?.bias_15m?.trend;
  if (direction === 'long' && bias15m === 'bearish') {
    return {
      state: 'no-signal', score: 0, direction,
      reason: '15M bearish counters bullish 4H+1H — structure conflict',
    };
  }
  if (direction === 'short' && bias15m === 'bullish') {
    return {
      state: 'no-signal', score: 0, direction,
      reason: '15M bullish counters bearish 4H+1H — structure conflict',
    };
  }

  const pip = pipSize(cp);

  // Step 2 — 15M pullback
  const labels15m = data15m?.structure_labels ?? [];
  const pullback  = s1FindPullback(labels15m, direction);
  if (!pullback) {
    return {
      state: 'waiting', score: 30, direction,
      reason: `Aligned ${bias4h.toUpperCase()} — no 15M ${direction === 'long' ? 'HL' : 'LH'} pullback yet`,
    };
  }

  // Step 3 — pre-filter: within 50 pips
  const distPips = Math.abs(cp - pullback.price) / pip;
  if (distPips > 50) {
    return {
      state: 'waiting', score: 30, direction,
      reason: `${Math.round(distPips)}p from pullback — too far (max 50p)`,
    };
  }

  // Step 5 — counter CHoCH rejection (checked before BOS for early exit)
  const choch15m = data15m?.choch ?? [];
  if (s1HasCounterChoch(choch15m, direction)) {
    return {
      state: 'no-signal', score: 0, direction,
      reason: 'Counter CHoCH on 15M within 4h — reversal risk, strategy rejected',
    };
  }

  // Step 4 — 5M BOS (FIX 1: window is now 2h, all events counted)
  const bos5m     = data5m?.bos ?? [];
  const bosResult = s1BosCheck(bos5m, candles5m, direction);
  if (bosResult.count === 0) {
    return {
      state: 'waiting', score: 50, direction,
      reason: 'No 5M BOS in trend direction within 2h — wait for momentum',
    };
  }
  if (bosResult.count === 1 && !bosResult.strong) {
    return {
      state: 'waiting', score: 55, direction,
      reason: 'Weak 5M BOS (body < 70%) — needs stronger displacement candle',
    };
  }

  // Step 6 — Scoring
  let score = 30; // alignment (always 30 when 4H+1H agree)
  score += 20;    // pullback found and within age

  if (bosResult.count >= 2)                           score += 20;
  else if (bosResult.count === 1 && bosResult.strong) score += 20;
  else                                                score += 10;

  if (distPips <= 5)       score += 15;
  else if (distPips <= 10) score += 10;
  else if (distPips <= 15) score += 5;

  score += sessionBonus();

  const zones1h = data1h?.zones ?? [];
  if (zoneNearPrice(zones1h, pullback.price, cp)) score += 5;

  // FIX 3: Hard 15-pip distance post-filter — matches scalping engine hard limit
  // Applied after scoring so the score is computed correctly for the waiting message
  if (distPips > 15) {
    return {
      state: 'waiting', score, direction,
      reason: `${Math.round(distPips)}p from pullback — hard limit is 15p for entry (score: ${score})`,
    };
  }

  // Step 7 — Trade placement
  const slBuffer = 5 * pip;
  const entry    = cp;
  const sl       = direction === 'long'
    ? pullback.price - slBuffer
    : pullback.price + slBuffer;
  const slPips   = Math.round(Math.abs(entry - sl) / pip);

  if (direction === 'long' && sl >= entry) {
    return { state: 'waiting', score, direction, reason: 'Price below HL — wait for bounce back to pullback zone' };
  }
  if (direction === 'short' && sl <= entry) {
    return { state: 'waiting', score, direction, reason: 'Price above LH — wait for fade back to pullback zone' };
  }

  if (slPips < 7) {
    return {
      state: 'waiting', score, direction,
      reason: 'SL too tight (< 7p) — wait for pullback to deepen',
    };
  }

  const riskDist = Math.abs(entry - sl);
  const tp1      = direction === 'long'
    ? entry + riskDist * 2
    : entry - riskDist * 2;

  const confidence: Confidence = score >= 85 ? 'HIGH' : score >= 70 ? 'MED' : 'LOW';
  const state: SignalState     = score >= 70 ? 'active' : 'waiting';

  return {
    state,
    direction,
    score,
    entry:       round5(entry),
    sl:          round5(sl),
    tp1:         round5(tp1),
    tp1Rr:       2.0,
    tp1Label:    '2R Target',
    slPips,
    confidence,
    entrySource: `15M ${direction === 'long' ? 'HL' : 'LH'} Pullback`,
    priceInZone: distPips <= 5,
    reason:      state === 'active'
      ? `${bosResult.count} BOS confirmed · ${Math.round(distPips)}p from pullback · score ${score}/100`
      : `Score ${score}/100 — conditions not fully met`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S2 — Liquidity Sweep Reversal Scalping
// ─────────────────────────────────────────────────────────────────────────────
//
// Updates applied:
//  FIX 4 — Staleness window corrected from 12h to 24h (comment said 48h, code was 12h)
//  FIX 5 — Reversal confirmation window expanded from 1h to 2h (matches scalping engine)
//  FIX 6 — BOS+BOS rejection gate added (need at least one CHoCH on either side)
//  FIX 8 — HTF alignment bonus added (+5 per timeframe aligned with trade direction)
//  FIX 9 — S/R level proximity bonus added (+5 if S/R within 10 pips of sweep level)
//
// Full logic:
//  1. Market must NOT be strongly trending (4H + 1H both same) → regime(15)
//  2. Detect 1H sweep: CHOCH(25) or BOS(10) from bosChochData, max 24h old
//  3. Price within 25p of sweep level
//  4. 5M reversal confirmation within 2h: CHoCH body≥50%(25) or BOS body≥70%(10)
//  5. BOS+BOS rejected — at least one CHoCH required (FIX 6)
//  6. Zone(10) + HTF alignment bonus(+5/tf, max +10) + S/R bonus(+5)
//  7. Minimum total score: 80 | Max possible: ~115
//  8. Entry = market, SL = beyond sweep ± 5p, TP = 2R
// ─────────────────────────────────────────────────────────────────────────────

function computeS2Signal(
  biasData:     BiasData | undefined,
  bosChochData: BosChochResponse | undefined,
  candles5m:    any[],
  data5m:       TradingAnalysisResponse | undefined,
  data1h:       TradingAnalysisResponse | undefined,
  srLevels:     SRLevel[] | undefined,
): TradeSignal {
  const bias4h = biasData?.bias_4h?.trend;
  const bias1h = biasData?.bias_1h?.trend;
  const cp     = biasData?.bias_1h?.current_price;

  if (!cp) {
    return { state: 'no-signal', score: 0, reason: 'Price data loading…' };
  }

  // Step 1 — market regime (strongly trending = S1 territory, not S2)
  const stronglyTrending =
    bias4h && bias1h &&
    bias4h !== 'neutral' && bias1h !== 'neutral' &&
    bias4h === bias1h;
  if (stronglyTrending) {
    return { state: 'no-signal', score: 0, reason: `4H+1H both ${bias4h?.toUpperCase()} — trending market, S2 not valid` };
  }
  const regimeScore = 15;

  // Step 2 — detect 1H sweep (CHoCH preferred over BOS)
  const levels = bosChochData?.levels ?? [];
  const sorted = [...levels].sort((a, b) => b.time - a.time);
  const recentChoch = sorted.find(l => l.type === 'CHOCH');
  const recentBos   = sorted.find(l => l.type === 'BOS');
  const sweep = (() => {
    if (recentChoch && recentBos) {
      return recentChoch.time >= recentBos.time - 12 * 3600 ? recentChoch : recentBos;
    }
    return recentChoch ?? recentBos;
  })();

  if (!sweep) {
    return { state: 'no-signal', score: 0, reason: 'No 1H liquidity sweep detected' };
  }

  // FIX 4: Staleness guard corrected to 24h (was 12h; comment incorrectly said 48h)
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - sweep.time > 24 * 3600) {
    return {
      state: 'no-signal',
      score: 0,
      reason: 'No recent 1H sweep — last event is stale (>24h ago)',
    };
  }

  // S2 direction = same as the CHOCH/BOS direction
  // (bearish CHOCH = swept above highs → price going short now)
  const direction: Direction = sweep.direction === 'bearish' ? 'short' : 'long';
  const sweepScore           = sweep.type === 'CHOCH' ? 25 : 10;
  const pip                  = pipSize(cp);

  // Step 4 — distance from sweep level
  const distPips = Math.abs(cp - sweep.price) / pip;
  if (distPips > 25) {
    return {
      state: 'no-signal',
      score: sweepScore + regimeScore,
      direction,
      reason: `${Math.round(distPips)}p from sweep — too far (max 25p)`,
    };
  }
  const distScore = distPips <= 5 ? 15 : distPips <= 15 ? 10 : 5;

  // FIX 5: Reversal confirmation window expanded from 1h to 2h
  const bos5m   = data5m?.bos   ?? [];
  const choch5m = data5m?.choch ?? [];

  const nowSec5m   = Math.floor(Date.now() / 1000);
  const rev5mChoch = [...choch5m]
    .sort((a, b) => b.time - a.time)
    .find(c => c.direction === sweep.direction && nowSec5m - c.time <= 7200);
  const rev5mBos = [...bos5m]
    .sort((a, b) => b.time - a.time)
    .find(b => b.direction === sweep.direction && nowSec5m - b.time <= 7200);

  let reversalScore  = 0;
  let isChochConfirm = false;

  if (rev5mChoch) {
    const candle = candles5m.find(c => c.time === rev5mChoch.time);
    if (!candle || candleBodyStrength(candle) >= 0.50) {
      reversalScore  = 25;
      isChochConfirm = true;
    }
  } else if (rev5mBos) {
    const candle = candles5m.find(c => c.time === rev5mBos.time);
    if (!candle || candleBodyStrength(candle) >= 0.70) {
      reversalScore = 10;
    }
  }

  // FIX 6: BOS+BOS rejection gate — at least one side must be CHoCH
  // A BOS sweep + BOS confirmation is the lowest quality combination and is rejected
  const isSweepChoch = sweep.type === 'CHOCH';
  if (reversalScore > 0 && !isSweepChoch && !isChochConfirm) {
    return {
      state: 'waiting',
      score: sweepScore + regimeScore + distScore,
      direction,
      reason: 'BOS sweep + BOS confirm only — at least one CHoCH required for quality',
    };
  }

  const runningScore = sweepScore + reversalScore + regimeScore + distScore + sessionBonus();

  if (reversalScore === 0) {
    return {
      state: 'waiting',
      score: runningScore,
      direction,
      reason: `${sweep.type} sweep found — waiting for 5M reversal ${direction === 'long' ? '↑' : '↓'} within 2h`,
    };
  }

  // Minimum reversal distance: price must have moved at least 5p away from sweep level
  const reversalPips = direction === 'long'
    ? (cp - sweep.price) / pip
    : (sweep.price - cp) / pip;
  if (reversalPips < 5) {
    return {
      state: 'waiting',
      score: runningScore,
      direction,
      reason: `Reversal confirmed but only ${Math.round(reversalPips)}p from sweep — wait for 5p clearance`,
    };
  }

  // Zone confluence bonus (10 pts)
  const zones1h   = data1h?.zones ?? [];
  const zoneScore = zoneNearPrice(zones1h, sweep.price, cp) ? 10 : 0;

  // FIX 8: HTF alignment bonus — +5 per timeframe that aligns with the trade direction
  // Matches scalping engine htf_bonus: awards setups where HTF confirms the sweep reversal
  const sweepDir = direction === 'long' ? 'bullish' : 'bearish';
  let htfBonus   = 0;
  if (bias1h === sweepDir) htfBonus += 5;
  if (bias4h === sweepDir) htfBonus += 5;

  // FIX 9: S/R level proximity bonus — +5 if any S/R level within 10 pips of sweep
  // Matches scalping engine sr_bonus: structural confluence at the sweep level adds quality
  let srBonus      = 0;
  const srThresh   = 10 * pip;
  if (srLevels) {
    for (const lvl of srLevels) {
      if (typeof lvl.price === 'number' && Math.abs(sweep.price - lvl.price) <= srThresh) {
        srBonus = 5;
        break;
      }
    }
  }

  const totalScore = sweepScore + reversalScore + regimeScore + distScore +
                     sessionBonus() + zoneScore + htfBonus + srBonus;

  // Minimum 80 required
  if (totalScore < 80) {
    return {
      state: 'waiting',
      score: totalScore,
      direction,
      reason: `Score ${totalScore}/115 — min 80 required (add zone/HTF/S/R confluence)`,
    };
  }

  // Trade placement
  const slBuffer = 5 * pip;
  const entry    = cp;
  const sl       = direction === 'long'
    ? sweep.price - slBuffer
    : sweep.price + slBuffer;
  const slPips   = Math.round(Math.abs(entry - sl) / pip);

  if (direction === 'long' && sl >= entry) {
    return { state: 'waiting', score: totalScore, direction, reason: 'Price below sweep — wait for bounce confirmation' };
  }
  if (direction === 'short' && sl <= entry) {
    return { state: 'waiting', score: totalScore, direction, reason: 'Price above sweep — wait for fade confirmation' };
  }

  if (slPips < 7) {
    return {
      state: 'waiting', score: totalScore, direction,
      reason: 'SL too tight (< 7p) — wait for more distance from sweep level',
    };
  }

  const riskDist = Math.abs(entry - sl);
  const tp1      = direction === 'long'
    ? entry + riskDist * 2
    : entry - riskDist * 2;

  const confidence: Confidence = totalScore >= 95 ? 'HIGH' : 'MED';
  const revType                = isChochConfirm ? 'CHoCH' : 'BOS';

  return {
    state:       'active',
    direction,
    score:       totalScore,
    entry:       round5(entry),
    sl:          round5(sl),
    tp1:         round5(tp1),
    tp1Rr:       2.0,
    tp1Label:    `${sweep.type} Reversal 2R`,
    slPips,
    confidence,
    entrySource: `1H ${sweep.type} → 5M ${revType}`,
    priceInZone: distPips <= 10,
    reason:      `${sweep.type} sweep · ${revType} confirm · zone:${zoneScore > 0 ? '✓' : '✗'} htf:+${htfBonus} sr:+${srBonus} · score ${totalScore}/115`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 — ICT Order Block / FVG Zone Reaction
// ─────────────────────────────────────────────────────────────────────────────
//
// Updates applied:
//  FIX 7 — Candle-not-found now rejects body check (was: free pass if candle missing)
//           Matches the same fix applied to S6 in the scalping engine
//
// Full logic:
//  1. HTF alignment: 4H + 1H both agree non-neutral → direction (15pts)
//     4H alone clear, 1H neutral → partial alignment (8pts)
//     Both neutral or conflicting → no signal
//  2. 1H unmitigated OB in bias direction, max 48h old (25pts)
//  3. 4H OB stacking bonus when 4H OB overlaps 1H OB (15pts)
//  4. 5M FVG overlapping the OB — confluence zone (10pts)
//  5. Price inside OB (20pts) or within 10p of center (10pts), else wait
//  6. Session: London/NY (10pts)
//  7. 5M confirmation: CHoCH body≥50%(20pts) or BOS body≥60%(10pts)
//     Unverified candle is now rejected — not a free pass (FIX 7)
//  Minimum score: 75 | Max possible: ~115
//  Entry = market, SL = beyond OB edge ± 5p, TP = 2R
// ─────────────────────────────────────────────────────────────────────────────

function computeS3Signal(
  biasData:  BiasData | undefined,
  candles4h: any[],
  candles1h: any[],
  candles5m: any[],
  data5m:    TradingAnalysisResponse | undefined,
): TradeSignal {
  const bias4h = biasData?.bias_4h?.trend;
  const bias1h = biasData?.bias_1h?.trend;
  const cp     = biasData?.bias_1h?.current_price;

  if (!cp) {
    return { state: 'no-signal', score: 0, reason: 'Price data loading…' };
  }

  if (!candles1h.length) {
    return { state: 'no-signal', score: 0, reason: '1H candles loading…' };
  }

  // Step 1 — HTF direction
  let direction: Direction;
  let alignScore: number;

  if (bias4h && bias4h !== 'neutral' && bias1h && bias1h !== 'neutral') {
    if (bias4h !== bias1h) {
      return {
        state: 'no-signal', score: 0,
        reason: `4H ${bias4h.toUpperCase()} vs 1H ${bias1h.toUpperCase()} — conflicting, no OB trade`,
      };
    }
    direction  = bias4h === 'bullish' ? 'long' : 'short';
    alignScore = 15;
  } else if (bias4h && bias4h !== 'neutral') {
    direction  = bias4h === 'bullish' ? 'long' : 'short';
    alignScore = 8;
  } else {
    return {
      state: 'no-signal', score: 0,
      reason: 'No clear 4H bias — S3 needs directional context',
    };
  }

  const pip = pipSize(cp);

  // Step 2 — 1H unmitigated OB in bias direction (within 48h)
  const nowSecOb = Math.floor(Date.now() / 1000);
  const obs1h    = detectOrderBlocks(candles1h, cp)
    .filter(o => nowSecOb - o.time <= 48 * 3600);
  const ob       = direction === 'long'
    ? obs1h.find(o => o.type === 'bullish')
    : obs1h.find(o => o.type === 'bearish');

  if (!ob) {
    return {
      state: 'waiting', score: alignScore, direction,
      reason: `${bias4h?.toUpperCase()} bias — no unmitigated 1H ${direction === 'long' ? 'bullish' : 'bearish'} OB near price`,
    };
  }

  const obScore = 25;

  // Step 2b — 4H OB stacking bonus (confluence: 4H OB overlaps 1H OB)
  const obs4h = candles4h.length ? detectOrderBlocks(candles4h, cp) : [];
  const ob4h  = direction === 'long'
    ? obs4h.find(o => o.type === 'bullish')
    : obs4h.find(o => o.type === 'bearish');

  const ob4hOverlaps = ob4h ? (ob4h.bottom < ob.top && ob4h.top > ob.bottom) : false;
  const ob4hScore    = ob4hOverlaps ? 15 : 0;

  // Step 3 — 5M FVG overlapping the OB (confluence)
  const fvgs5m      = detectFVGs(candles5m, cp);
  const fvg         = direction === 'long'
    ? fvgs5m.find(f => f.type === 'bullish')
    : fvgs5m.find(f => f.type === 'bearish');
  const fvgOverlaps = fvg ? (fvg.bottom < ob.top && fvg.top > ob.bottom) : false;
  const fvgScore    = fvgOverlaps ? 10 : 0;

  // Step 4 — Price position relative to OB
  const insideOB     = cp >= ob.bottom && cp <= ob.top;
  const obCenter     = (ob.top + ob.bottom) / 2;
  const distToCenter = Math.abs(cp - obCenter) / pip;
  const zoneScore    = insideOB ? 20 : distToCenter <= 10 ? 10 : 0;

  if (zoneScore === 0) {
    const obEdge = direction === 'long' ? ob.top : ob.bottom;
    return {
      state: 'waiting',
      score: alignScore + obScore + fvgScore,
      direction,
      reason: `OB at ${fmtPrice(obEdge, cp)} — price not in zone yet (${Math.round(distToCenter)}p from center)`,
    };
  }

  // Step 5 — Session timing
  const sessScore = sessionBonus();

  // Step 6 — 5M confirmation in OB direction
  const bos5m   = data5m?.bos   ?? [];
  const choch5m = data5m?.choch ?? [];
  const confDir = direction === 'long' ? 'bullish' : 'bearish';

  const nowSec3     = Math.floor(Date.now() / 1000);
  const conf5mChoch = [...choch5m]
    .sort((a, b) => b.time - a.time)
    .find(c => c.direction === confDir && nowSec3 - c.time <= 3600);
  const conf5mBos = [...bos5m]
    .sort((a, b) => b.time - a.time)
    .find(b => b.direction === confDir && nowSec3 - b.time <= 3600);

  let confirmScore = 0;
  let confirmType  = '';

  // FIX 7: Candle not found now rejects body check — same fix as S6 in scalping engine
  // Previously: !candle || bodyStrength >= threshold (free pass if candle missing)
  // Now:        candle && bodyStrength >= threshold  (reject if candle missing)
  if (conf5mChoch) {
    const candle = candles5m.find(c => c.time === conf5mChoch.time);
    if (candle && candleBodyStrength(candle) >= 0.50) {
      confirmScore = 20;
      confirmType  = 'CHoCH';
    }
  }

  if (confirmScore === 0 && conf5mBos) {
    const candle = candles5m.find(c => c.time === conf5mBos.time);
    if (candle && candleBodyStrength(candle) >= 0.60) {
      confirmScore = 10;
      confirmType  = 'BOS';
    }
  }

  const runningScore = alignScore + obScore + ob4hScore + fvgScore + zoneScore + sessScore;

  if (confirmScore === 0) {
    return {
      state: 'waiting',
      score: runningScore,
      direction,
      reason: `${insideOB ? 'Inside' : 'Near'} OB${fvgOverlaps ? ' + FVG' : ''} — waiting 5M ${direction === 'long' ? '↑' : '↓'} confirmation (body≥50% CHoCH or ≥60% BOS)`,
    };
  }

  const totalScore = runningScore + confirmScore;

  // Minimum 75 required (S3 uses 75, not 80 — it's the rarest, highest-quality setup)
  if (totalScore < 75) {
    return {
      state: 'waiting',
      score: totalScore,
      direction,
      reason: `Score ${totalScore}/115 — min 75 required`,
    };
  }

  // Trade placement — SL beyond OB edge + 5p buffer
  const slBuffer = 5 * pip;
  const entry    = cp;
  const sl       = direction === 'long'
    ? ob.bottom - slBuffer
    : ob.top    + slBuffer;
  const slPips   = Math.round(Math.abs(entry - sl) / pip);

  if (slPips < 7) {
    return {
      state: 'waiting', score: totalScore, direction,
      reason: 'SL too tight (< 7p) — wait for price to move deeper into OB',
    };
  }

  const riskDist = Math.abs(entry - sl);
  const tp1      = direction === 'long'
    ? entry + riskDist * 2
    : entry - riskDist * 2;

  const confidence: Confidence = totalScore >= 95 ? 'HIGH' : totalScore >= 80 ? 'MED' : 'LOW';

  return {
    state:       'active',
    direction,
    score:       totalScore,
    entry:       round5(entry),
    sl:          round5(sl),
    tp1:         round5(tp1),
    tp1Rr:       2.0,
    tp1Label:    'OB Reaction 2R',
    slPips,
    confidence,
    entrySource: `${ob4hOverlaps ? '4H+1H OB' : '1H OB'}${fvgOverlaps ? ' + FVG' : ''} → 5M ${confirmType}`,
    priceInZone: insideOB,
    reason:      `${insideOB ? 'Inside' : 'Near'} ${ob4hOverlaps ? '4H+1H stacked OB' : '1H OB'}${fvgOverlaps ? ' · FVG' : ''} · 5M ${confirmType} · score ${totalScore}/115`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Score bar — visual indicator 0–max
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct   = Math.min(100, Math.max(0, Math.round((score / max) * 100)));
  const color = pct >= 85 ? '#4ade80' : pct >= 70 ? '#fbbf24' : pct >= 50 ? '#f97316' : '#475569';
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 7, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Score</span>
        <span style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: '0.05em' }}>{score}/{max}</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.4s ease',
          boxShadow: `0 0 6px ${color}66`,
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode tab
// ─────────────────────────────────────────────────────────────────────────────

function ModeTab({
  label, sub, active, onClick,
}: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '4px 0',
        background:   active ? 'rgba(41,98,255,0.18)' : 'transparent',
        border:       active ? '1px solid rgba(41,98,255,0.40)' : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 4,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        transition: 'all 0.15s',
      }}
    >
      <span style={{
        fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
        color: active ? '#93c5fd' : '#475569',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 6.5, letterSpacing: '0.06em',
        color: active ? '#60a5fa' : '#334155',
        textTransform: 'uppercase',
      }}>
        {sub}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TradeTeller
// ─────────────────────────────────────────────────────────────────────────────

export function TradeTeller({ symbol, biasData, srLevels, bosChochData }: TradeTellerProps) {
  const [minimized, setMinimized] = useState(false);
  const [mode, setMode]           = useState<Mode>('s1');

  const { data: data4h  } = useTradingAnalysis(symbol, '4h',  100);
  const { data: data1h  } = useTradingAnalysis(symbol, '1h',  200);
  const { data: data15m } = useTradingAnalysis(symbol, '15m', 150);
  const { data: data5m  } = useTradingAnalysis(symbol, '5m',  200);

  const candles5m = useMemo(() => {
    if (!data5m?.candles) return [];
    return Array.from(new Map(data5m.candles.map((c: any) => [c.time, c])).values())
      .sort((a: any, b: any) => a.time - b.time);
  }, [data5m?.candles]);

  const candles4h = useMemo(() => {
    if (!data4h?.candles) return [];
    return Array.from(new Map(data4h.candles.map((c: any) => [c.time, c])).values())
      .sort((a: any, b: any) => a.time - b.time);
  }, [data4h?.candles]);

  const candles1h = useMemo(() => {
    if (!data1h?.candles) return [];
    return Array.from(new Map(data1h.candles.map((c: any) => [c.time, c])).values())
      .sort((a: any, b: any) => a.time - b.time);
  }, [data1h?.candles]);

  const signal = useMemo(() => {
    if (mode === 's1') return computeS1Signal(biasData, data15m, candles5m, data5m, data1h);
    // FIX 9 wiring: srLevels passed to S2 for S/R proximity bonus
    if (mode === 's2') return computeS2Signal(biasData, bosChochData, candles5m, data5m, data1h, srLevels);
    return computeS3Signal(biasData, candles4h, candles1h, candles5m, data5m);
  }, [mode, biasData, data15m, candles5m, candles4h, candles1h, data5m, data1h, bosChochData, srLevels]);

  // ── Signal change tracking ────────────────────────────────────────────────
  const sigKey     = `${mode}-${signal.direction ?? 'n'}-${signal.state}-${signal.entry?.toFixed(5) ?? ''}`;
  const prevKeyRef = useRef('');
  const prevStateRef   = useRef<SignalState>('no-signal');
  const [activeSince, setActiveSince] = useState<Date | null>(null);
  const [isNew, setIsNew]             = useState(false);
  const isNewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sigKey === prevKeyRef.current) return;
    if (signal.state === 'active') {
      setActiveSince(new Date());
      setIsNew(true);
      if (isNewTimer.current) clearTimeout(isNewTimer.current);
      isNewTimer.current = setTimeout(() => setIsNew(false), 8000);
    } else {
      setActiveSince(null);
    }
    prevStateRef.current = signal.state;
    prevKeyRef.current   = sigKey;
  }, [sigKey, signal.state]);

  useEffect(() => () => { if (isNewTimer.current) clearTimeout(isNewTimer.current); }, []);

  // ── Formatting ────────────────────────────────────────────────────────────
  const cp    = biasData?.bias_1h?.current_price;
  const fmtP  = (p: number) => cp ? fmtPrice(p, cp) : p.toFixed(5);
  const fmtRr = (rr: number) => rr.toFixed(1) + 'R';
  const fmtTime = (d: Date) => {
    const h  = d.getHours();
    const m  = d.getMinutes().toString().padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ap}`;
  };

  const displaySymbol = symbol.replace('/', '');
  const dirColor      = signal.direction === 'long' ? '#26a69a' : '#ef5350';
  const dirLabel      = signal.direction === 'long' ? '▲ LONG' : '▼ SHORT';
  const confColor     = signal.confidence === 'HIGH' ? '#4ade80' : signal.confidence === 'MED' ? '#fbbf24' : '#94a3b8';
  const panelBorder   = signal.state === 'active' && signal.confidence === 'HIGH'
    ? `1px solid ${dirColor}44`
    : '1px solid rgba(255,255,255,0.08)';

  // Score max is mode-aware: S1 max 100, S2 max 115, S3 max 115
  const scoreMax = mode === 's1' ? 100 : 115;

  return (
    <div style={{
      width: '100%', background: 'rgba(8,12,20,0.96)',
      border: panelBorder, fontFamily: "'Roboto Mono', monospace", overflow: 'hidden',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 9px',
        borderBottom: minimized ? 'none' : '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.14em', color: '#334155', textTransform: 'uppercase', flexShrink: 0 }}>
            Trade Teller
          </span>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', flexShrink: 0, color: signal.state === 'active' ? dirColor : '#4b5563' }}>
            {displaySymbol}
          </span>
          {isNew && (
            <span style={{ fontSize: 6.5, fontWeight: 700, color: '#0f172a', background: dirColor, borderRadius: 3, padding: '1px 4px', flexShrink: 0, letterSpacing: '0.10em' }}>
              NEW
            </span>
          )}
          {activeSince && !isNew && (
            <span style={{ fontSize: 6.5, color: '#374151', letterSpacing: '0.04em', flexShrink: 0 }}>
              {fmtTime(activeSince)}
            </span>
          )}
        </div>
        <button
          onClick={() => setMinimized(m => !m)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#374151', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          {minimized ? <ChevronUp size={11} /> : <Minus size={11} />}
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {!minimized && (
        <div style={{ padding: '8px 10px' }}>

          {/* Mode selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <ModeTab label="S1" sub="Pullback" active={mode === 's1'} onClick={() => setMode('s1')} />
            <ModeTab label="S2" sub="Sweep"    active={mode === 's2'} onClick={() => setMode('s2')} />
            <ModeTab label="S3" sub="OB/FVG"   active={mode === 's3'} onClick={() => setMode('s3')} />
          </div>

          {/* ── NO SIGNAL ── */}
          {signal.state === 'no-signal' && (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: 9.5, color: '#374151', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 5 }}>
                ⊘ NO SIGNAL
              </div>
              <div style={{ fontSize: 7.5, color: '#1f2937', lineHeight: 1.6 }}>
                {signal.reason}
              </div>
              {signal.score !== undefined && signal.score > 0 && (
                <ScoreBar score={signal.score} max={scoreMax} />
              )}
            </div>
          )}

          {/* ── WAITING ── */}
          {signal.state === 'waiting' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {signal.direction && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: dirColor, letterSpacing: '0.05em' }}>
                    ◌ {dirLabel}
                  </span>
                )}
                <span style={{ fontSize: 6.5, color: '#374151', letterSpacing: '0.10em', textTransform: 'uppercase', border: '1px solid #1f2937', borderRadius: 3, padding: '1px 4px' }}>
                  WAITING
                </span>
              </div>
              <div style={{ fontSize: 7.5, color: '#1f2937', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 6 }}>
                {signal.reason}
              </div>
              {signal.score !== undefined && (
                <ScoreBar score={signal.score} max={scoreMax} />
              )}
            </>
          )}

          {/* ── ACTIVE ── */}
          {signal.state === 'active' && signal.entry !== undefined && signal.sl !== undefined && (
            <>
              {/* Direction */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: dirColor, letterSpacing: '0.05em' }}>
                  {dirLabel}
                </span>
                <span style={{ fontSize: 6.5, color: '#374151', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {signal.entrySource}
                </span>
              </div>

              {/* Price in zone alert */}
              {signal.priceInZone && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: `${dirColor}18`, border: `1px solid ${dirColor}55`,
                  borderRadius: 4, padding: '3px 6px', marginBottom: 6,
                }}>
                  <span style={{ fontSize: 9 }}>⚡</span>
                  <span style={{ fontSize: 7.5, fontWeight: 700, color: dirColor, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {mode === 's1' ? 'Near pullback — execute now' : mode === 's2' ? 'Near sweep — execute now' : 'Inside OB — execute now'}
                  </span>
                </div>
              )}

              {/* Price table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 7.5, color: '#4b5563', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Entry</span>
                  <span style={{ fontSize: 9.5, color: '#e2e8f0', fontWeight: 700 }}>{fmtP(signal.entry)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 7.5, color: '#4b5563', letterSpacing: '0.07em', textTransform: 'uppercase' }}>SL</span>
                  <span style={{ fontSize: 9.5, color: '#ef5350', fontWeight: 600 }}>
                    {fmtP(signal.sl)}
                    <span style={{ fontSize: 7, color: '#374151', marginLeft: 4 }}>−{signal.slPips}p</span>
                  </span>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '1px 0' }} />
                {signal.tp1 !== undefined && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 7.5, color: '#4b5563', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                      TP &nbsp;<span style={{ color: '#1f2937', fontWeight: 400 }}>{signal.tp1Label}</span>
                    </span>
                    <span style={{ fontSize: 9.5, color: '#4ade80', fontWeight: 600 }}>
                      {fmtP(signal.tp1)}
                      <span style={{ fontSize: 7, color: '#374151', marginLeft: 4 }}>{fmtRr(signal.tp1Rr!)}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Confidence */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: confColor, flexShrink: 0, boxShadow: `0 0 5px 2px ${confColor}55` }} />
                <span style={{ fontSize: 8, fontWeight: 700, color: confColor, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                  {signal.confidence} CONFIDENCE
                </span>
              </div>

              {signal.score !== undefined && (
                <ScoreBar score={signal.score} max={scoreMax} />
              )}

              {/* Footer reason */}
              <div style={{ fontSize: 6.5, color: '#1f2937', marginTop: 4, letterSpacing: '0.04em', lineHeight: 1.5 }}>
                {signal.reason}
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
