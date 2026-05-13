import { useQuery } from "@tanstack/react-query";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
}

export interface ZigZagLine {
  from_time: number;
  from_price: number;
  to_time: number;
  to_price: number;
}

export interface StructureLabel {
  time: number;
  price: number;
  label: "HH" | "HL" | "LH" | "LL";
  kind: "high" | "low";
  index: number;
}

export interface TrendData {
  trend: "bullish" | "bearish" | "neutral";
  confidence: number;
  last_labels: string[];
}

export interface BosEvent {
  time: number;
  price: number;
  direction: "bullish" | "bearish";
  label: string;
  level_broken: number;
}

export interface ChochEvent {
  time: number;
  price: number;
  direction: "bullish" | "bearish";
  label: string;
  broken_label: string;
}

export interface TrendlineSegment {
  from_time: number;
  from_price: number;
  to_time: number;
  to_price: number;
  kind: "bullish" | "bearish";
}

export interface TrendlinesData {
  bullish: TrendlineSegment[];
  bearish: TrendlineSegment[];
}

export interface Zone {
  top: number;
  bottom: number;
  center: number;
  touches: number;
  strength: number;
  timeframe: string;
  start_time: number;
  end_time: number;
}

export interface TradingAnalysisResponse {
  symbol: string;
  interval: string;
  candles: Candle[];
  swings: SwingPoint[];
  zigzag_lines: ZigZagLine[];
  structure_labels: StructureLabel[];
  trend: TrendData;
  bos: BosEvent[];
  choch: ChochEvent[];
  trendlines: TrendlinesData;
  zones: Zone[];
}

export interface SRLevel {
  price: number;
  kind: "support" | "resistance";
  timeframe: "15m" | "1h" | "4h";
  touches: number;
}

export interface SRLevelsResponse {
  symbol: string;
  count: number;
  levels: SRLevel[];
}

// Patient retry: keeps trying for ~15s during bridge warmup on first app open
const PATIENT_RETRY = 12;
const patientRetryDelay = (attemptIndex: number) =>
  Math.min(1000 * 2 ** attemptIndex, 15000);

export function useSRLevels(symbol: string = "USD/JPY") {
  return useQuery<SRLevelsResponse, Error>({
    queryKey: ["sr-levels", symbol],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol, outputsize: "300" });
      const res = await fetch(`/trading-api/sr-levels?${params.toString()}`);
      if (!res.ok) throw new Error(`SR levels API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    retry: PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 4 * 60 * 1000,
  });
}

export interface BosChochLevel {
  type: "BOS" | "CHOCH";
  direction: "bullish" | "bearish";
  price: number;
  time: number;
  label: string;
}

export interface BosChochResponse {
  symbol: string;
  timeframe: string;
  levels: BosChochLevel[];
}

export interface MTFBias {
  trend: "bullish" | "bearish" | "neutral";
  confidence: number;
  current_price: number | null;
  last_high_price: number | null;
  last_low_price: number | null;
}

export interface MTFBiasResponse {
  symbol: string;
  bias_15m: MTFBias;
  bias_1h: MTFBias;
  bias_4h: MTFBias;
}

export function useMTFBias(symbol: string = "USD/JPY") {
  return useQuery<MTFBiasResponse, Error>({
    queryKey: ["mtf-bias", symbol],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol });
      const res = await fetch(`/trading-api/mtf-bias?${params.toString()}`);
      if (!res.ok) throw new Error(`MTF bias API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 4 * 60 * 1000,
  });
}

export function useBosChoch(symbol: string = "USD/JPY") {
  return useQuery<BosChochResponse, Error>({
    queryKey: ["bos-choch", symbol],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol, outputsize: "300" });
      const res = await fetch(`/trading-api/bos-choch?${params.toString()}`);
      if (!res.ok) throw new Error(`BOS/CHOCH API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    retry: PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 4 * 60 * 1000,
  });
}

export interface SessionBox {
  session: "asian" | "london" | "ny";
  start_time: number;
  end_time: number;
  high: number;
  low: number;
}

export interface SessionsResponse {
  symbol: string;
  interval: string;
  sessions: SessionBox[];
}

export function useSessions(symbol: string = "USD/JPY", interval: string = "5m") {
  return useQuery<SessionsResponse, Error>({
    queryKey: ["sessions", symbol, interval],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol, interval, outputsize: "500" });
      const res = await fetch(`/trading-api/sessions?${params.toString()}`);
      if (!res.ok) throw new Error(`Sessions API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 55 * 1000,
  });
}

export interface MT5StatusResponse {
  online: boolean;
  last_contact_secs_ago: number | null;
  frames: Record<string, number>;
}

export function useMT5Status() {
  return useQuery<MT5StatusResponse, Error>({
    queryKey: ["mt5-status"],
    queryFn: async () => {
      const res = await fetch("/trading-api/mt5/status");
      if (!res.ok) throw new Error("MT5 status error");
      return res.json();
    },
    refetchInterval: 15 * 1000,
    retry: 1,
    staleTime: 10 * 1000,
  });
}

export function useTradingAnalysis(symbol: string = "USD/JPY", interval: string = "5m", outputsize: number = 500) {
  return useQuery<TradingAnalysisResponse, Error>({
    queryKey: ["trading-analysis", symbol, interval, outputsize],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol,
        interval,
        outputsize: outputsize.toString(),
      });

      const res = await fetch(`/trading-api/analysis?${params.toString()}`);

      if (!res.ok) {
        if (res.status === 404) throw new Error("Endpoint not found. Make sure the Trading API is running.");
        const err = await res.text();
        throw new Error(`API Error: ${err}`);
      }

      return res.json();
    },
    refetchInterval: 60000,
    retry: PATIENT_RETRY,
    retryDelay: patientRetryDelay,
  });
}
// ── Alerts (multi-pair signal badge system) ───────────────────────────────────

export type AlertState = "active" | "waiting" | "no-signal";

export interface PairAlerts {
  s1: AlertState;
  s2: AlertState;
  s3: AlertState;
}

export interface AlertsResponse {
  alerts: Record<string, PairAlerts>;
}

export function useAlerts() {
  return useQuery<AlertsResponse, Error>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const res = await fetch("/trading-api/alerts");
      if (!res.ok) throw new Error(`Alerts API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,  // refresh every 60 seconds
    retry: PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 55 * 1000,
  });
}