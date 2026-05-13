import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  Time,
  LineStyle,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  SeriesMarker,
  ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import type { TradingAnalysisResponse, SRLevel, SessionBox, BosChochResponse } from '@/hooks/use-trading-api';
import type { ToggleState } from '@/components/TopBar';

const SESSION_STYLE: Record<string, { bg: string; border: string; label: string; textColor: string }> = {
  asian:  { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.75)',  label: 'ASIA',   textColor: 'rgba(251,191,36,0.9)' },
  london: { bg: 'rgba(59,130,246,0.10)',  border: 'rgba(59,130,246,0.75)',  label: 'LONDON', textColor: 'rgba(59,130,246,0.9)' },
  ny:     { bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.75)',   label: 'NY',     textColor: 'rgba(34,197,94,0.9)' },
};

const ZONE_SUPPLY = { bg: 'rgba(239,83,80,0.10)', border: 'rgba(239,83,80,0.50)', label: 'S', textColor: 'rgba(239,83,80,0.8)' };
const ZONE_DEMAND = { bg: 'rgba(38,166,154,0.10)', border: 'rgba(38,166,154,0.50)', label: 'D', textColor: 'rgba(38,166,154,0.8)' };

const OB_BULLISH = { bg: 'rgba(163,230,53,0.15)',  border: 'rgba(163,230,53,0.80)', label: 'OB BULL', textColor: 'rgba(163,230,53,1.00)' };
const OB_BEARISH = { bg: 'rgba(192,132,252,0.15)', border: 'rgba(192,132,252,0.80)', label: 'OB BEAR', textColor: 'rgba(192,132,252,1.00)' };

const FVG_BULLISH = { bg: 'rgba(34,211,238,0.10)',  border: 'rgba(34,211,238,0.55)', label: 'FVG BULL', textColor: 'rgba(34,211,238,0.90)' };
const FVG_BEARISH = { bg: 'rgba(232,121,249,0.10)', border: 'rgba(232,121,249,0.55)', label: 'FVG BEAR', textColor: 'rgba(232,121,249,0.90)' };

interface TradingChartProps {
  data: TradingAnalysisResponse | undefined;
  srLevels: SRLevel[] | undefined;
  sessions?: SessionBox[];
  toggles: ToggleState;
  bosChochData?: BosChochResponse;
}

// ── Exported so TradeTeller can reuse them without duplicating logic ──────────
export interface OrderBlockData { type: 'bullish' | 'bearish'; top: number; bottom: number; time: number; }
export interface FVGData         { type: 'bullish' | 'bearish'; top: number; bottom: number; }

const SR_COLORS = {
  resistance: '#f1c40f',
  support:    '#9b59b6',
};

const BOS_COLORS = {
  bullish: '#26a69a',
  bearish: '#ef5350',
};
const CHOCH_COLOR = '#f59e0b';

const TF_LABEL: Record<string, string> = {
  "4h": "4H", "1h": "1H", "15m": "15M",
};

const SR_TF_CONFIG: Record<string, { proximity: number; maxEach: number }> = {
  '15m': { proximity: 0.012, maxEach: 2 },
  '1h':  { proximity: 0.018, maxEach: 2 },
  '4h':  { proximity: 0.025, maxEach: 2 },
};

// ── Exported: pip size helper ─────────────────────────────────────────────────
export function pipSize(price: number): number {
  return price > 50 ? 0.01 : 0.0001;
}

// ── Exported: Order Block detection ──────────────────────────────────────────
// ── Exported: Order Block detection ──────────────────────────────────────────
export function detectOrderBlocks(candles: any[], currentPrice: number): OrderBlockData[] {
  const n = candles.length;
  if (n < 10) return [];
  const pip     = pipSize(currentPrice);
  const minSize = 5 * pip;

  // PRIORITY 1 — cap proximity at 60 pips so JPY pairs don't get a 200+ pip window
  const proximity = Math.min(0.015, (60 * pip) / currentPrice);

  const results: (OrderBlockData & { dist: number })[] = [];

  for (let i = 1; i < n - 3; i++) {
    const c = candles[i];

    // PRIORITY 2 — pre-compute average candle range of the last 10 bars (impulse proxy)
    const lookback = candles.slice(Math.max(0, i - 10), i);
    const avgRange = lookback.length
      ? lookback.reduce((sum: number, x: any) => sum + (x.high - x.low), 0) / lookback.length
      : 0;

    // ── Bullish OB candidate: bearish candle (close < open) ───────────────
    if (c.close < c.open) {
      const slice      = candles.slice(i + 1, Math.min(i + 6, n));
      const futureHigh = Math.max(...slice.map((x: any) => x.close));

      if (futureHigh > c.high && c.high - c.low >= minSize) {
        // PRIORITY 2 — displacement: the break candle must be impulsive (≥ 1.5× avg range)
        const breakCandle = slice.reduce((best: any, x: any) =>
          (x.high - x.low) > (best.high - best.low) ? x : best, slice[0]);
        const hasDisplacement = avgRange > 0 && (breakCandle.high - breakCandle.low) >= 1.5 * avgRange;
        if (!hasDisplacement) continue;

        const center = (c.high + c.low) / 2;
        const dist   = Math.abs(center - currentPrice) / currentPrice;

        if (dist <= proximity) {
          // PRIORITY 3 — mitigation needs a clear close beyond boundary (2-pip buffer)
          //              prevents shallow wick sweeps from killing valid OBs
          const mitigated = candles.slice(i + 1).some((fc: any) => fc.close < c.low - 2 * pip);
          if (!mitigated) results.push({ type: 'bullish', top: c.high, bottom: c.low, dist, time: c.time });
        }
      }
    }

    // ── Bearish OB candidate: bullish candle (close > open) ───────────────
    if (c.close > c.open) {
      const slice     = candles.slice(i + 1, Math.min(i + 6, n));
      const futureLow = Math.min(...slice.map((x: any) => x.close));

      if (futureLow < c.low && c.high - c.low >= minSize) {
        // PRIORITY 2 — displacement check (same logic, symmetric)
        const breakCandle = slice.reduce((best: any, x: any) =>
          (x.high - x.low) > (best.high - best.low) ? x : best, slice[0]);
        const hasDisplacement = avgRange > 0 && (breakCandle.high - breakCandle.low) >= 1.5 * avgRange;
        if (!hasDisplacement) continue;

        const center = (c.high + c.low) / 2;
        const dist   = Math.abs(center - currentPrice) / currentPrice;

        if (dist <= proximity) {
          // PRIORITY 3 — mitigation with 2-pip buffer (symmetric)
          const mitigated = candles.slice(i + 1).some((fc: any) => fc.close > c.high + 2 * pip);
          if (!mitigated) results.push({ type: 'bearish', top: c.high, bottom: c.low, dist, time: c.time });
        }
      }
    }
  }

  const bull = results
    .filter(o => o.type === 'bullish' && (o.top + o.bottom) / 2 <= currentPrice)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 1);
  const bear = results
    .filter(o => o.type === 'bearish' && (o.top + o.bottom) / 2 >= currentPrice)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 1);

  return [...bull, ...bear].map(({ type, top, bottom, time }) => ({
  type,
  top:    Math.round(top    * 1e5) / 1e5,
  bottom: Math.round(bottom * 1e5) / 1e5,
  time,
}));
}


// ── Exported: Fair Value Gap detection ───────────────────────────────────────
export function detectFVGs(candles: any[], currentPrice: number): FVGData[] {
  const n = candles.length;
  if (n < 3) return [];
  const pip       = pipSize(currentPrice);
  const minGap    = 3 * pip;
  const proximity = Math.min(0.01, (100 * pip) / currentPrice);
  const results: (FVGData & { dist: number })[] = [];

  for (let i = 1; i < n - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];

    const bTop    = next.low;
    const bBottom = prev.high;
    if (bTop > bBottom && bTop - bBottom >= minGap) {
      const center = (bTop + bBottom) / 2;
      const dist   = Math.abs(center - currentPrice) / currentPrice;
      if (dist <= proximity) {
        const mitigated = candles.slice(i + 1).some((c: any) => c.low <= bTop);
        if (!mitigated) results.push({ type: 'bullish', top: bTop, bottom: bBottom, dist });
      }
    }

    const dTop    = prev.low;
    const dBottom = next.high;
    if (dTop > dBottom && dTop - dBottom >= minGap) {
      const center = (dTop + dBottom) / 2;
      const dist   = Math.abs(center - currentPrice) / currentPrice;
      if (dist <= proximity) {
        const mitigated = candles.slice(i + 1).some((c: any) => c.high >= dBottom);
        if (!mitigated) results.push({ type: 'bearish', top: dTop, bottom: dBottom, dist });
      }
    }
  }

  const bull = results
    .filter(f => f.type === 'bullish' && (f.top + f.bottom) / 2 <= currentPrice)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 1);
  const bear = results
    .filter(f => f.type === 'bearish' && (f.top + f.bottom) / 2 >= currentPrice)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 1);

  return [...bull, ...bear].map(({ type, top, bottom }) => ({
    type,
    top:    Math.round(top    * 1e5) / 1e5,
    bottom: Math.round(bottom * 1e5) / 1e5,
  }));
}

export function TradingChart({ data, srLevels, sessions, toggles, bosChochData }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const zigzagSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const trendlineSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const srPriceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const bosChochLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const currentPriceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [layoutTick, setLayoutTick] = useState(0);
  const tick = useCallback(() => setLayoutTick(t => t + 1), []);

  const sortedCandles = useMemo(() => {
    if (!data?.candles) return [];
    return Array.from(new Map(data.candles.map((c: any) => [c.time, c])).values())
      .sort((a: any, b: any) => a.time - b.time);
  }, [data?.candles]);

  const currentPrice = useMemo(() =>
    sortedCandles.length ? (sortedCandles[sortedCandles.length - 1] as any).close as number : null,
  [sortedCandles]);

  const computedOBs = useMemo((): OrderBlockData[] => {
    if (!toggles.ob || !sortedCandles.length || currentPrice === null) return [];
    return detectOrderBlocks(sortedCandles, currentPrice);
  }, [sortedCandles, currentPrice, toggles.ob]);

  const computedFVGs = useMemo((): FVGData[] => {
    if (!toggles.fvg || !sortedCandles.length || currentPrice === null) return [];
    return detectFVGs(sortedCandles, currentPrice);
  }, [sortedCandles, currentPrice, toggles.fvg]);

  // ── Effect 1: Create chart + series once ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: "'Roboto Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: 'rgba(255,255,255,0.2)', style: LineStyle.SparseDotted, labelBackgroundColor: '#2962ff' },
        horzLine: { width: 1, color: 'rgba(255,255,255,0.2)', style: LineStyle.SparseDotted, labelBackgroundColor: '#2962ff' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', autoScale: true },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false, rightOffset: 15 },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    candleSeriesRef.current = candleSeries;

    markersPluginRef.current = createSeriesMarkers(candleSeries, []);

    const zzSeries = chart.addSeries(LineSeries, {
      color: 'rgba(255,255,255,0.85)', lineWidth: 2,
      crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
    });
    zigzagSeriesRef.current = zzSeries;

    chart.timeScale().subscribeVisibleLogicalRangeChange(tick);

    const handleResize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      tick();
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => { window.removeEventListener('resize', handleResize); chart.remove(); };
  }, []);

  // ── Effect 2: Candles, zigzag, trendlines, structure markers ──────────────
  useEffect(() => {
    if (!data || !chartRef.current || !candleSeriesRef.current || !zigzagSeriesRef.current) return;

    const uniqueCandles = Array.from(new Map(data.candles.map(c => [c.time, c])).values())
      .sort((a, b) => a.time - b.time);
    candleSeriesRef.current.setData(uniqueCandles as any);

    if (uniqueCandles.length > 0) {
      const latestClose = (uniqueCandles[uniqueCandles.length - 1] as any).close as number;
      const pip = pipSize(latestClose);
      const isJpy = pip === 0.01;
      candleSeriesRef.current.applyOptions({
        priceFormat: {
          type: 'price',
          precision: isJpy ? 3 : 5,
          minMove:   isJpy ? 0.001 : 0.00001,
        },
      });
    }

    if (currentPriceLineRef.current) {
      try { candleSeriesRef.current.removePriceLine(currentPriceLineRef.current); } catch {}
      currentPriceLineRef.current = null;
    }
    if (uniqueCandles.length > 0) {
      const latest = uniqueCandles[uniqueCandles.length - 1].close;
      currentPriceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: latest, color: 'rgba(255,255,255,0.6)', lineWidth: 1,
        lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
      });
    }

    if (toggles.zigzag && data.swings.length > 0) {
      zigzagSeriesRef.current.setData(
        [...data.swings].sort((a, b) => a.time - b.time).map(s => ({ time: s.time as Time, value: s.price })) as any
      );
    } else {
      zigzagSeriesRef.current.setData([]);
    }

    trendlineSeriesRefs.current.forEach(s => { try { chartRef.current?.removeSeries(s); } catch {} });
    trendlineSeriesRefs.current = [];

    const addTrendlines = (lines: typeof data.trendlines.bullish, color: string) => {
      lines.forEach(line => {
        const s = chartRef.current!.addSeries(LineSeries, {
          color, lineWidth: 1, lineStyle: LineStyle.Solid,
          crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
        });
        s.setData([
          { time: line.from_time as Time, value: line.from_price },
          { time: line.to_time as Time, value: line.to_price },
        ] as any);
        trendlineSeriesRefs.current.push(s);
      });
    };
    addTrendlines(data.trendlines.bullish, 'rgba(38,166,154,0.65)');
    addTrendlines(data.trendlines.bearish, 'rgba(239,83,80,0.65)');

    if (markersPluginRef.current) {
      if (toggles.labels) {
        const markers: SeriesMarker<Time>[] = data.structure_labels.map(label => ({
          time: label.time as Time,
          position: label.kind === 'high' ? 'aboveBar' : 'belowBar',
          color: label.kind === 'high' ? '#ef5350' : '#26a69a',
          shape: label.kind === 'high' ? 'arrowDown' : 'arrowUp',
          text: label.label,
          size: 1.2,
        }));
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        markersPluginRef.current.setMarkers(markers);
      } else {
        markersPluginRef.current.setMarkers([]);
      }
    }

    setTimeout(tick, 80);
  }, [data, toggles.zigzag, toggles.labels]);

  useEffect(() => {
    setTimeout(tick, 50);
  }, [sessions, toggles.sessions, toggles.zones, toggles.ob, toggles.fvg, data, computedOBs, computedFVGs]);

  // ── Effect 3: S/R price lines ──────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    srPriceLinesRef.current.forEach(line => {
      try { candleSeriesRef.current?.removePriceLine(line); } catch {}
    });
    srPriceLinesRef.current = [];

    if (!srLevels?.length) return;

    const candles = data?.candles;
    const currentPrice = candles && candles.length > 0
      ? candles[candles.length - 1].close
      : null;

    if (!currentPrice) return;

    const tfEnabled: Record<string, boolean> = {
      '15m': toggles.sr15m,
      '1h':  toggles.sr1h,
      '4h':  toggles.sr4h,
    };

    (['15m', '1h', '4h'] as const).forEach(tf => {
      if (!tfEnabled[tf]) return;

      const cfg = SR_TF_CONFIG[tf];
      const tfLevels = srLevels.filter(l => l.timeframe === tf);

      const nearby = tfLevels.filter(l =>
        Math.abs(l.price - currentPrice) / currentPrice <= cfg.proximity
      );

      const resistance = nearby
        .filter(l => l.price >= currentPrice)
        .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
        .slice(0, cfg.maxEach);

      const support = nearby
        .filter(l => l.price < currentPrice)
        .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
        .slice(0, cfg.maxEach);

      [...resistance, ...support].forEach(level => {
        const line = candleSeriesRef.current!.createPriceLine({
          price: level.price,
          color: SR_COLORS[level.kind],
          lineWidth: tf === '4h' ? 2 : 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${TF_LABEL[tf]} ${level.kind === 'resistance' ? 'R' : 'S'}`,
        });
        srPriceLinesRef.current.push(line);
      });
    });
  }, [srLevels, data, toggles.sr15m, toggles.sr1h, toggles.sr4h]);

  // ── Effect 4: BOS / CHOCH lines ───────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    bosChochLinesRef.current.forEach(line => { try { candleSeriesRef.current?.removePriceLine(line); } catch {} });
    bosChochLinesRef.current = [];

    if (!toggles.bos || !bosChochData?.levels?.length) return;

    const levels = bosChochData.levels;
    const significantChoch = levels.filter(l => l.type === 'CHOCH').slice(-1);
    const significantBos   = levels.filter(l => l.type === 'BOS').slice(-2);

    [...significantBos, ...significantChoch].forEach(level => {
      const isChoch = level.type === 'CHOCH';
      const line = candleSeriesRef.current!.createPriceLine({
        price: level.price,
        color: isChoch ? CHOCH_COLOR : BOS_COLORS[level.direction],
        lineWidth: isChoch ? 2 : 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.type} ${level.direction === 'bullish' ? '↑' : '↓'}`,
      });
      bosChochLinesRef.current.push(line);
    });
  }, [bosChochData, toggles.bos]);

  // ── Effect 5: HTML overlays ────────────────────────────────────────────────
  const overlayElements = (() => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _dep = layoutTick;

    const timeScale = chartRef.current.timeScale();
    const priceSeries = candleSeriesRef.current;
    const elements: React.JSX.Element[] = [];

    if (toggles.sessions && sessions?.length) {
      sessions.forEach((session, idx) => {
        const style = SESSION_STYLE[session.session];
        if (!style) return;
        const x1 = timeScale.timeToCoordinate(session.start_time as Time);
        const x2 = timeScale.timeToCoordinate(session.end_time as Time);
        const y1 = priceSeries.priceToCoordinate(session.high);
        const y2 = priceSeries.priceToCoordinate(session.low);
        if (x1 === null || x2 === null || y1 === null || y2 === null) return;
        const left = Math.min(x1, x2), top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
        if (width < 2 || height < 2) return;
        elements.push(
          <div key={`session-${session.session}-${idx}`} style={{
            position: 'absolute', left, top, width, height,
            background: style.bg,
            borderTop: `2px solid ${style.border}`, borderBottom: `2px solid ${style.border}`,
            borderLeft: `1px solid ${style.border}`, borderRight: `1px solid ${style.border}`,
            boxSizing: 'border-box', pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', top: 3, left: 4, fontSize: '9px', fontWeight: 700,
              letterSpacing: '0.08em', color: style.textColor, fontFamily: 'monospace',
              lineHeight: 1, userSelect: 'none',
            }}>{style.label}</span>
          </div>
        );
      });
    }

    if (toggles.zones && data?.zones?.length) {
      const currentPrice = data.candles.length > 0
        ? data.candles[data.candles.length - 1].close
        : null;

      const STRENGTH_MIN  = 0.65;
      const MAX_TOUCHES   = 2;
      const PROXIMITY_PCT = 0.015;

      const filtered = currentPrice === null ? [] : data.zones.filter(z => {
        const withinProximity = Math.abs(z.center - currentPrice) / currentPrice <= PROXIMITY_PCT;
        return z.strength >= STRENGTH_MIN && z.touches <= MAX_TOUCHES && withinProximity;
      });

      const supplyZones = filtered
        .filter(z => z.center > (currentPrice ?? 0))
        .sort((a, b) => a.center - b.center)
        .slice(0, 2);

      const demandZones = filtered
        .filter(z => z.center <= (currentPrice ?? 0))
        .sort((a, b) => b.center - a.center)
        .slice(0, 2);

      [...supplyZones, ...demandZones].forEach((zone, idx) => {
        const isSupply = currentPrice === null || zone.center > currentPrice;
        const style = isSupply ? ZONE_SUPPLY : ZONE_DEMAND;

        const y1 = priceSeries.priceToCoordinate(zone.top);
        const y2 = priceSeries.priceToCoordinate(zone.bottom);
        if (y1 === null || y2 === null) return;

        const containerWidth = containerRef.current?.clientWidth ?? 0;
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        if (height < 2) return;

        elements.push(
          <div key={`zone-${idx}`} style={{
            position: 'absolute', left: 0, top,
            width: containerWidth,
            height: Math.max(height, 3),
            background: style.bg,
            borderTop: `1px solid ${style.border}`,
            borderBottom: `1px solid ${style.border}`,
            boxSizing: 'border-box', pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: 4, fontSize: '8px', fontWeight: 700,
              letterSpacing: '0.06em', color: style.textColor, fontFamily: 'monospace',
              lineHeight: 1, userSelect: 'none', opacity: 0.9,
            }}>
              {isSupply ? 'SUPPLY' : 'DEMAND'}
            </span>
          </div>
        );
      });
    }

    if (toggles.ob && computedOBs.length) {
      const containerWidth = containerRef.current?.clientWidth ?? 0;
      computedOBs.forEach((ob, idx) => {
        const style = ob.type === 'bullish' ? OB_BULLISH : OB_BEARISH;
        const y1 = priceSeries.priceToCoordinate(ob.top);
        const y2 = priceSeries.priceToCoordinate(ob.bottom);
        if (y1 === null || y2 === null) return;
        const top    = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        if (height < 2) return;
        elements.push(
          <div key={`ob-${ob.type}-${idx}`} style={{
            position: 'absolute', left: 0, top,
            width: containerWidth, height: Math.max(height, 4),
            background: style.bg,
            borderTop:    `1px solid ${style.border}`,
            borderBottom: `1px solid ${style.border}`,
            boxSizing: 'border-box', pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: 4, fontSize: '8px', fontWeight: 700,
              letterSpacing: '0.06em', color: style.textColor, fontFamily: 'monospace',
              lineHeight: 1, userSelect: 'none',
            }}>{style.label}</span>
          </div>
        );
      });
    }

    if (toggles.fvg && computedFVGs.length) {
      const containerWidth = containerRef.current?.clientWidth ?? 0;
      computedFVGs.forEach((fvg, idx) => {
        const style = fvg.type === 'bullish' ? FVG_BULLISH : FVG_BEARISH;
        const y1 = priceSeries.priceToCoordinate(fvg.top);
        const y2 = priceSeries.priceToCoordinate(fvg.bottom);
        if (y1 === null || y2 === null) return;
        const top    = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        if (height < 2) return;
        elements.push(
          <div key={`fvg-${fvg.type}-${idx}`} style={{
            position: 'absolute', left: 0, top,
            width: containerWidth, height: Math.max(height, 3),
            background: style.bg,
            borderTop:    `1px dashed ${style.border}`,
            borderBottom: `1px dashed ${style.border}`,
            boxSizing: 'border-box', pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: 4, fontSize: '8px', fontWeight: 700,
              letterSpacing: '0.06em', color: style.textColor, fontFamily: 'monospace',
              lineHeight: 1, userSelect: 'none',
            }}>{style.label}</span>
          </div>
        );
      });
    }

    return elements;
  })();

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#0a0e17' }}>
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 20 }}>
        {overlayElements}
      </div>
    </div>
  );
}
