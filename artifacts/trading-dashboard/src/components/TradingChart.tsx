import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import type { TradingAnalysisResponse, SRLevel, SessionBox } from '@/hooks/use-trading-api';
import type { ToggleState } from '@/components/TopBar';

// Session box visual config
const SESSION_STYLE: Record<string, { bg: string; border: string; label: string; textColor: string }> = {
  asian:  { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.75)',  label: 'ASIA',   textColor: 'rgba(251,191,36,0.9)' },
  london: { bg: 'rgba(59,130,246,0.10)',  border: 'rgba(59,130,246,0.75)',  label: 'LONDON', textColor: 'rgba(59,130,246,0.9)' },
  ny:     { bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.75)',   label: 'NY',     textColor: 'rgba(34,197,94,0.9)' },
};

interface TradingChartProps {
  data: TradingAnalysisResponse | undefined;
  srLevels: SRLevel[] | undefined;
  sessions?: SessionBox[];
  toggles: ToggleState;
}

// Colours per kind
const SR_COLORS = {
  resistance: '#f1c40f', // yellow
  support:    '#9b59b6', // purple
};

// Label shown on the price axis per level
const TF_LABEL: Record<string, string> = {
  "4h": "4H", "1h": "1H", "15m": "15M",
};

export function TradingChart({ data, srLevels, sessions, toggles }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const zigzagSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const trendlineSeriesRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const srPriceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const currentPriceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  // Store the markers plugin (ISeriesMarkersPluginApi), created once
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [layoutTick, setLayoutTick] = useState(0);
  const tick = useCallback(() => setLayoutTick(t => t + 1), []);

  // 1. Create chart + series once
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
        vertLine: {
          width: 1,
          color: 'rgba(255,255,255,0.2)',
          style: LineStyle.SparseDotted,
          labelBackgroundColor: '#2962ff',
        },
        horzLine: {
          width: 1,
          color: 'rgba(255,255,255,0.2)',
          style: LineStyle.SparseDotted,
          labelBackgroundColor: '#2962ff',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 15,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeriesRef.current = candleSeries;

    // Create markers plugin ONCE attached to candleSeries
    const markersPlugin = createSeriesMarkers(candleSeries, []);
    markersPluginRef.current = markersPlugin;

    // ZigZag line series
    const zzSeries = chart.addSeries(LineSeries, {
      color: 'rgba(255,255,255,0.85)',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    zigzagSeriesRef.current = zzSeries;

    chart.timeScale().subscribeVisibleLogicalRangeChange(tick);

    const handleResize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      tick();
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // 2. Update data whenever data/toggles change
  useEffect(() => {
    if (!data || !chartRef.current || !candleSeriesRef.current || !zigzagSeriesRef.current) return;

    // Deduplicate + sort candles
    const uniqueCandles = Array.from(
      new Map(data.candles.map(c => [c.time, c])).values()
    ).sort((a, b) => a.time - b.time);

    candleSeriesRef.current.setData(uniqueCandles as any);

    // Current price line — remove old one first to prevent stacking
    if (currentPriceLineRef.current) {
      try { candleSeriesRef.current.removePriceLine(currentPriceLineRef.current); } catch {}
      currentPriceLineRef.current = null;
    }
    if (uniqueCandles.length > 0) {
      const latest = uniqueCandles[uniqueCandles.length - 1].close;
      currentPriceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: latest,
        color: 'rgba(255,255,255,0.6)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
      });
    }

    // ZigZag
    if (toggles.zigzag && data.swings.length > 0) {
      const zzData = [...data.swings]
        .sort((a, b) => a.time - b.time)
        .map(s => ({ time: s.time as Time, value: s.price }));
      zigzagSeriesRef.current.setData(zzData as any);
    } else {
      zigzagSeriesRef.current.setData([]);
    }

    // Remove old trendlines
    trendlineSeriesRefs.current.forEach(s => {
      try { chartRef.current?.removeSeries(s); } catch {}
    });
    trendlineSeriesRefs.current = [];

    const addTrendlines = (lines: typeof data.trendlines.bullish, color: string) => {
      lines.forEach(line => {
        const s = chartRef.current!.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
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

    // --- Markers (via persistent plugin — just call setMarkers) ---
    if (markersPluginRef.current) {
      if (toggles.labels) {
        const markers: SeriesMarker<Time>[] = [];

        data.structure_labels.forEach(label => {
          markers.push({
            time: label.time as Time,
            position: label.kind === 'high' ? 'aboveBar' : 'belowBar',
            color: label.kind === 'high' ? '#ef5350' : '#26a69a',
            shape: label.kind === 'high' ? 'arrowDown' : 'arrowUp',
            text: label.label,
            size: 1.2,
          });
        });

        // Must be sorted by time for lightweight-charts
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        markersPluginRef.current.setMarkers(markers);
      } else {
        markersPluginRef.current.setMarkers([]);
      }
    }

    setTimeout(tick, 80);
  }, [data, toggles.zigzag, toggles.labels]);

  // Trigger overlay re-render when sessions data or toggle changes
  useEffect(() => {
    setTimeout(tick, 50);
  }, [sessions, toggles.sessions]);

  // 3. SR level horizontal price lines — redrawn whenever srLevels changes
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remove all existing SR price lines
    srPriceLinesRef.current.forEach(line => {
      try { candleSeriesRef.current?.removePriceLine(line); } catch {}
    });
    srPriceLinesRef.current = [];

    if (!srLevels || srLevels.length === 0) return;

    const tfEnabled: Record<string, boolean> = {
      '15m': toggles.sr15m,
      '1h':  toggles.sr1h,
      '4h':  toggles.sr4h,
    };

    const visibleLevels = srLevels.filter(l => tfEnabled[l.timeframe] !== false);

    visibleLevels.forEach(level => {
      const color = SR_COLORS[level.kind];
      const label = `${TF_LABEL[level.timeframe] ?? level.timeframe} ${level.kind === 'resistance' ? 'R' : 'S'}`;
      const line = candleSeriesRef.current!.createPriceLine({
        price: level.price,
        color,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: label,
      });
      srPriceLinesRef.current.push(line);
    });
  }, [srLevels, toggles.sr15m, toggles.sr1h, toggles.sr4h]);

  // 4. HTML overlay elements — recomputed on layoutTick
  const overlayElements = (() => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _dep = layoutTick;

    const timeScale = chartRef.current.timeScale();
    const priceSeries = candleSeriesRef.current;
    const elements: React.JSX.Element[] = [];

    // Session boxes
    if (toggles.sessions && sessions && sessions.length > 0) {
      sessions.forEach((session, idx) => {
        const style = SESSION_STYLE[session.session];
        if (!style) return;

        const x1 = timeScale.timeToCoordinate(session.start_time as Time);
        const x2 = timeScale.timeToCoordinate(session.end_time as Time);
        const y1 = priceSeries.priceToCoordinate(session.high);
        const y2 = priceSeries.priceToCoordinate(session.low);

        if (x1 === null || x2 === null || y1 === null || y2 === null) return;

        const left   = Math.min(x1, x2);
        const top    = Math.min(y1, y2);
        const width  = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);

        if (width < 2 || height < 2) return;

        elements.push(
          <div
            key={`session-${session.session}-${idx}`}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              background: style.bg,
              borderTop:    `2px solid ${style.border}`,
              borderBottom: `2px solid ${style.border}`,
              borderLeft:   `1px solid ${style.border}`,
              borderRight:  `1px solid ${style.border}`,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          >
            {/* Session label in top-left of box */}
            <span style={{
              position: 'absolute',
              top: 3,
              left: 4,
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: style.textColor,
              fontFamily: 'monospace',
              lineHeight: 1,
              userSelect: 'none',
            }}>
              {style.label}
            </span>
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
