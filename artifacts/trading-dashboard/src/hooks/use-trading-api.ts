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
  label: "HH" | "HL" | "LH" | "LL" | "EQH" | "EQL";
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
  current_price?: number | null;
}

export interface SRLevel {
  price: number;
  kind: "support" | "resistance";
  timeframe: "15m" | "1h" | "4h"| "d1";
  touches: number;
  score?: number;
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
      if (!res.ok) throw new Error(`${res.status}: SR levels API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
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
  bias_d1: MTFBias;
  bias_w1?: MTFBias;
}

export function useMTFBias(symbol: string = "USD/JPY") {
  return useQuery<MTFBiasResponse, Error>({
    queryKey: ["mtf-bias", symbol],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol });
      const res = await fetch(`/trading-api/mtf-bias?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}: MTF bias API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 4 * 60 * 1000,
  });
}


export interface CandlePattern {
  time: number;
  index: number;
  pattern: "pin_bar_rejection" | "engulfing" | "liquidity_sweep" | "displacement" | "inside_bar";
  direction: "bullish" | "bearish" | "neutral";
  price: number;
  context: string;
}

export interface PatternSummaryResponse {
  symbol: string;
  pattern_15m: CandlePattern | null;
  pattern_1h: CandlePattern | null;
  pattern_4h: CandlePattern | null;
  pattern_d1: CandlePattern | null;
  pattern_w1?: CandlePattern | null;
}

export function usePatternSummary(symbol: string = "USD/JPY") {
  return useQuery<PatternSummaryResponse, Error>({
    queryKey: ["pattern-summary", symbol],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol });
      const res = await fetch(`/trading-api/pattern-summary?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}: Pattern summary API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
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
      if (!res.ok) throw new Error(`${res.status}: BOS/CHOCH API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 4 * 60 * 1000,
  });
}

export interface ChochResponse {
  symbol: string;
  interval: string;
  choch: ChochEvent[];
}

export function useChoch(symbol: string, interval: "1h" | "4h") {
  return useQuery<ChochResponse, Error>({
    queryKey: ["choch", symbol, interval],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol, interval, outputsize: "300" });
      const res = await fetch(`/trading-api/choch?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}: CHoCH API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    staleTime: 55 * 1000,
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
      if (!res.ok) throw new Error(`${res.status}: Sessions API error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
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
      if (!res.ok) throw new Error(`${res.status}: MT5 status error`);
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

      const res = await fetch(`/trading-api/analysis?${params.toString()}`, { cache: "no-store" });

      if (!res.ok) {
        if (res.status === 404) throw new Error("404: Endpoint not found. Make sure the Trading API is running.");
        const err = await res.text();
        throw new Error(`${res.status}: API Error: ${err}`);
      }

      return res.json();
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
    retry: (failureCount, error) =>
      !String((error as Error)?.message).includes("401") && failureCount < PATIENT_RETRY,
    retryDelay: patientRetryDelay,
    placeholderData: (prev) => prev,
    structuralSharing: false,
  });
}


// ── News Impact ───────────────────────────────────────────────────────────────

export type NewsStatus = "BLOCKED" | "CAUTION" | "CLEAR";

export interface PairNewsInfo {
  status:             NewsStatus;
  impact_level:       number;
  confidence_penalty: number;
  reason:             string;
  blocked:            boolean;
}

export interface UpcomingEvent {
  event:              string;
  country:            string;
  impact_level:       number;
  scheduled_utc:      string;
  minutes_away:       number | null;
  confidence_penalty: number;
  block_window:       string;
  affects_pairs:      string[];
  window_active?:     boolean;
  actual?:            string;
  estimate?:          string;
  prev?:              string;
  unit?:              string;
}

export interface NewsStatusResponse {
  service_ok: boolean;
  per_pair:   Record<string, PairNewsInfo>;
  upcoming:   UpcomingEvent[];
}

export function useNewsStatus() {
  return useQuery<NewsStatusResponse, Error>({
    queryKey: ["news-status"],
    queryFn: async () => {
      const res = await fetch("/trading-api/news-status");
      if (!res.ok) throw new Error(`${res.status}: News status error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 60 * 1000,
    retry: 1,
    staleTime: 55 * 1000,
  });
}

// ── Pair Sweep ────────────────────────────────────────────────────────────────
export type EnvRating = "Favorable" | "Mixed" | "Unfavorable";
export interface PairEnvironment {
  scalp:         EnvRating;
  scalp_reason:  string;
  limit:         EnvRating;
  limit_reason:  string;
  level_warning: string | null;
  price?:        number;
  error?:        string;
}
export interface EnvShift {
  symbol:    string;
  type:      "scalp" | "limit";
  from:      EnvRating;
  to:        EnvRating;
  reason:    string;
  timestamp: number;
}
export interface PairSweepResponse {
  pairs:     Record<string, PairEnvironment>;
  shifts:    EnvShift[];
  timestamp: number;
}
export function usePairSweep(intervalMs = 20000) {
  return useQuery<PairSweepResponse, Error>({
    queryKey: ["pair-sweep"],
    queryFn: async () => {
      const res = await fetch("/trading-api/pair-sweep");
      if (!res.ok) throw new Error(`${res.status}: Pair sweep error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: intervalMs,
    retry: 1,
    staleTime: 15_000,
  });
}

export interface BrokerTimeResponse {
  broker_time: number;
}

export function useBrokerTime() {
  return useQuery<BrokerTimeResponse, Error>({
    queryKey: ["broker-time"],
    queryFn: async () => {
      const res = await fetch("/trading-api/mt5/server-time");
      if (!res.ok) throw new Error(`${res.status}: Broker time error`);
      return res.json();
    },
    refetchInterval: 30 * 1000,
    retry: 1,
    staleTime: 25 * 1000,
  });
}

// ── Framework Status (notification monitor) ───────────────────────────────────

export interface PairFrameworkStatus {
  scalp_ready:      boolean;
  limit_ready:      boolean;
  direction:        "bullish" | "bearish" | "neutral";
  scalp_rr:         number;
  limit_rr:         number;
  phase_good:       boolean;
  has_1h_zone:      boolean;
  has_15m_confirm:  boolean;
  has_5m_trigger:   boolean;
  news_blocked:     boolean;
  price:            number;
  scalp_entry?:     number | null;
  scalp_sl?:        number | null;
  scalp_tp?:        number | null;
  limit_entry?:     number | null;
  limit_sl?:        number | null;
  limit_tp?:        number | null;
  broker_time?:     number;
  error?:           string;
}

export interface FrameworkStatusResponse {
  pairs:       Record<string, PairFrameworkStatus>;
  broker_time: number;
}

export interface ActiveSetup {
  pair:      string;
  mode:      "scalp" | "limit";
  direction: string;
  rr:        number;
  firedAt:   number;
  entry?:    number | null;
  tp?:       number | null;
  sl?:       number | null;
}

export function useFrameworkStatus(intervalMs = 30_000) {
  return useQuery<FrameworkStatusResponse, Error>({
    queryKey: ["framework-status"],
    queryFn: async () => {
      const res = await fetch("/trading-api/framework-status");
      if (!res.ok) throw new Error(`${res.status}: Framework status error: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: intervalMs,
    retry: 1,
    staleTime: 25_000,
  });
}
// ── Auto Trade Engine ─────────────────────────────────────────────────────────

export interface AutoTradePairStatus {
  status:            "READY" | "WATCHING" | "WAITING" | "NEUTRAL" | "ERROR";
  reason:            string;
  symbol:            string;
  d1?:               string;
  direction?:        "BUY" | "SELL";
  entry?:            number;
  sl?:               number;
  tp?:               number;
  rr?:               number;
  entry_source?:     string;
  price?:            number;
  evaluated_at?:     number;
  fired_at?:         number;
  paper_mode?:       boolean;
  order_id?:         string;
  exhaustion_score?:  number;
  exhaustion_signal?: boolean;
  exhaustion_detail?: string;
}

export interface AutoTradeStateResponse {
  enabled:    boolean;
  paper_mode: boolean;
  pairs:      Record<string, AutoTradePairStatus>;
  log_count:  number;
}

export interface AutoTradeLogResponse {
  log: AutoTradePairStatus[];
}

export function useAutoTradeStatus() {
  return useQuery<AutoTradeStateResponse, Error>({
    queryKey: ["auto-trade-status"],
    queryFn: async () => {
      const res = await fetch("/trading-api/auto-trade/status");
      if (!res.ok) throw new Error(`${res.status}: Auto trade status: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 5_000,
    retry: 1,
    staleTime: 4_000,
  });
}

export function useAutoTradeLog() {
  return useQuery<AutoTradeLogResponse, Error>({
    queryKey: ["auto-trade-log"],
    queryFn: async () => {
      const res = await fetch("/trading-api/auto-trade/log");
      if (!res.ok) throw new Error(`${res.status}: Auto trade log: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: 10_000,
    retry: 1,
    staleTime: 9_000,
  });
}