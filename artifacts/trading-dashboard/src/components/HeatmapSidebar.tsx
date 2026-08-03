import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMTFBias, type LatestStructureEvent, type MTFBiasResponse } from "../hooks/use-trading-api";


function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOLS = [
  { display: "USDJPY", api: "USD/JPY" },
  { display: "EURUSD", api: "EUR/USD" },
  { display: "GBPUSD", api: "GBP/USD" },
  { display: "EURJPY", api: "EUR/JPY" },
  { display: "GBPJPY", api: "GBP/JPY" },
  { display: "AUDUSD", api: "AUD/USD" },
  { display: "USDCAD", api: "USD/CAD" },
  { display: "USDCHF", api: "USD/CHF" },
  { display: "NZDUSD", api: "NZD/USD" },   
  { display: "AUDJPY", api: "AUD/JPY" },   
  { display: "CADJPY", api: "CAD/JPY" }, 
  { display: "XAUUSD", api: "XAU/USD" },
  { display: "BTCUSD", api: "BTC/USD" },

];

type TrendDir = "bullish" | "bearish" | "neutral";

// ATR multiplier for warning threshold — tune this one number to adjust all 13 pairs at once
const WARNING_ATR_MULTIPLIER = 0.25;
// Timeframe-aware amber window: how many bars after a fresh opposing CHoCH
// the dot shows amber. 3 bars on 15M = 45 min (too tight). 3 bars on W1 = 3 weeks (fine).
const CHOCH_TRANSITION_BARS: Record<string, number> = {
  "15m": 8,   // 2 hours
  "1h":  6,   // 6 hours
  "4h":  6,   // 24 hours
  "d1":  5,   // 5 days
  "w1":  3,   // 3 weeks
};

function isChochTransition(
  trend: TrendDir | undefined,
  choch: LatestStructureEvent | null | undefined,
  timeframe: string,
): boolean {
  if (!trend || trend === "neutral" || !choch) return false;
  const window = CHOCH_TRANSITION_BARS[timeframe] ?? 6;
  return choch.age_bars <= window;
}

function dotColor(trend?: TrendDir, isLoading?: boolean, transition?: boolean) {
  if (isLoading) return "bg-white/30 animate-pulse";
  if (transition) return "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.7)]";
  if (trend === "bullish") return "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]";
  if (trend === "bearish") return "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.6)]";
  if (trend === "neutral") return "bg-orange-400 shadow-[0_0_4px_rgba(251,146,60,0.5)]";
  return "bg-white/20";
}

function trendLabel(trend?: TrendDir) {
  if (trend === "bullish") return "BULL";
  if (trend === "bearish") return "BEAR";
  if (trend === "neutral") return "CONS";
  return "—";
}

// ATR-based warning: fires when price moved more than 0.25×ATR beyond the last
// confirmed structural level — naturally scales across FX, JPY, Gold, BTC.
function isWarning(
  trend: TrendDir | undefined,
  currentPrice: number | null | undefined,
  lastHighPrice: number | null | undefined,
  lastLowPrice: number | null | undefined,
  atr14: number | null | undefined,
): boolean {
  if (!currentPrice) return false;
  // No false positives when ATR not yet available from backend
  if (!atr14 || atr14 <= 0) return false;
  const threshold = WARNING_ATR_MULTIPLIER * atr14;
  if (trend === "bullish" && lastLowPrice != null) {
    return (lastLowPrice - currentPrice) > threshold;
  }
  if (trend === "bearish" && lastHighPrice != null) {
    return (currentPrice - lastHighPrice) > threshold;
  }
  return false;
}

// Maps trend_health (0–100) to a Tailwind opacity class
function dotOpacity(health: number | null | undefined): string {
  if (health == null) return "";
  if (health >= 80)   return "";
  if (health >= 60)   return "opacity-75";
  if (health >= 40)   return "opacity-50";
  return "opacity-30";
}

// Tooltip helpers for new structural event fields
function healthTag(h: number | null | undefined): string {
  return h != null ? ` [${h}]` : "";
}
function eventTag(ev: LatestStructureEvent | null | undefined): string {
  if (!ev) return "";
  return ` ${ev.direction === "bullish" ? "↑" : "↓"}BOS(${ev.age_hours}h)`;
}
function chochTag(ev: LatestStructureEvent | null | undefined): string {
  if (!ev) return "";
  return ` ${ev.direction === "bullish" ? "↑" : "↓"}CHoCH(${ev.age_hours}h)`;
}
function momentumTag(m?: { atr_regime: string; body_ratio: number; impulse_ratio: number } | null): string {
  if (!m) return "";
  const regime = m.atr_regime === "expanding" ? "📈XPND" : m.atr_regime === "contracting" ? "📉CONT" : "NORM";
  return ` ${regime} b:${m.body_ratio}`;
}

// ── Tooltip interpretation helpers ────────────────────────────────────────────

function healthWord(h: number | null | undefined): string {
  if (h == null) return "";
  if (h >= 85) return "Excellent";
  if (h >= 65) return "Good";
  if (h >= 45) return "Fair";
  if (h >= 25) return "Weak";
  return "Poor";
}

function bodyWord(b: number | null | undefined): string {
  if (b == null) return "";
  if (b >= 0.70) return "Strong conv.";
  if (b >= 0.45) return "Good conv.";
  if (b >= 0.25) return "Weak conv.";
  return "Mostly wicks";
}

function rowNote(
  trend: string | undefined,
  health: number | null | undefined,
  regime: string | undefined,
  body: number | null | undefined,
  hasBos: boolean,
  hasChoch: boolean,
): string {
  const h = health ?? 0;
  const b = body ?? 0;

  if (trend === "bullish") {
    if (h >= 75 && regime === "expanding"    && b >= 0.55) return "Strong bull push — high conviction";
    if (h >= 75 && regime === "expanding"    && b <  0.45) return "Bull expanding but wicks dominate — possible sweep";
    if (h >= 75 && regime === "contracting"  && b >= 0.45) return "Bull pausing/coiling — healthy, wait for expansion";
    if (h >= 75 && regime === "contracting"  && b <  0.35) return "Bull compressing hard — energy building";
    if (h >= 65)                                           return "Steady bull — normal conditions";
    if (h <  45 && hasChoch)                               return "Bull weakening — fresh CHoCH is a real warning";
    if (h <  45)                                           return "Bull degraded — old structure, low conviction";
    return "Bull trend present";
  }

  if (trend === "bearish") {
    if (h >= 75 && regime === "expanding"    && b >= 0.55) return "Strong bear push — high conviction";
    if (h >= 75 && regime === "expanding"    && b <  0.45) return "Bear expanding but wicks dominate — possible sweep";
    if (h >= 75 && regime === "contracting"  && b >= 0.45) return "Bear pausing/coiling — healthy, watch for continuation";
    if (h >= 75 && regime === "contracting"  && b <  0.35) return "Bear compressing — coiling before next leg";
    if (h >= 65)                                           return "Steady bear — normal conditions";
    if (h <  45 && hasChoch)                               return "Bear weakening — fresh CHoCH is a real warning";
    if (h <  45)                                           return "Bear degraded — old structure, low conviction";
    return "Bear trend present";
  }

  // neutral / consolidation
  if (hasBos && b < 0.40)   return "BOS printed but candle conviction low — wait for follow-through";
  if (regime === "expanding" && b >= 0.55) return "Breakout in progress — direction unconfirmed yet";
  if (regime === "expanding" && b <  0.45) return "Volatile, wicks everywhere — likely stop hunt";
  if (regime === "contracting" && b < 0.30) return "Compressing hard — coiling for big move";
  if (regime === "contracting")             return "Range contracting — two sides, nobody winning";
  if (h < 45)                               return "Weak structure — candles indecisive, avoid";
  return "Consolidation — wait for direction";
}

function pairSummary(data: MTFBiasResponse | undefined): string {
  if (!data) return "";
  const trends = [
    data.bias_15m?.trend,
    data.bias_1h?.trend,
    data.bias_4h?.trend,
    data.bias_d1?.trend,
    data.bias_w1?.trend,
  ];
  const ltf = trends.slice(0, 2);
  const htf = trends.slice(2).filter(Boolean) as string[];
  const ltfBull  = ltf.filter(t => t === "bullish").length;
  const ltfBear  = ltf.filter(t => t === "bearish").length;
  const htfBull  = htf.filter(t => t === "bullish").length;
  const htfBear  = htf.filter(t => t === "bearish").length;
  const allBull  = ltfBull === 2 && htfBull === htf.length;
  const allBear  = ltfBear === 2 && htfBear === htf.length;
  const allCons  = trends.every(t => t === "neutral");

  if (allBull)                          return "FULL BULL ALIGNMENT — strong buy confluence";
  if (allBear)                          return "FULL BEAR ALIGNMENT — strong sell confluence";
  if (htfBull >= 2 && ltfBear >= 1)    return "LTF pullback in HTF bull → wait for LTF to realign, then buy";
  if (htfBear >= 2 && ltfBull >= 1)    return "LTF bounce in HTF bear → wait for LTF to realign, then sell";
  if (htfBull >= 2 && ltfBull >= 1)    return "HTF + LTF bullish aligning → buy confluence building";
  if (htfBear >= 2 && ltfBear >= 1)    return "HTF + LTF bearish aligning → sell confluence building";
  if (allCons)                          return "All timeframes ranging — no direction, avoid";
  return "Mixed signals — no clear multi-TF bias";
}

const WARNING_CLASS = "ring-2 ring-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]";



// ── Heatmap row ───────────────────────────────────────────────────────────────

function HeatmapRow({
  display,
  api,
  active,
  onSelect,
}: {
  display: string;
  api: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { data, isLoading, isError } = useMTFBias(api);

  const warn15  = isWarning(data?.bias_15m.trend, data?.bias_15m.current_price, data?.bias_15m.last_high_price, data?.bias_15m.last_low_price, data?.bias_15m.atr_14);
  const warn1h  = isWarning(data?.bias_1h.trend,  data?.bias_1h.current_price,  data?.bias_1h.last_high_price,  data?.bias_1h.last_low_price,  data?.bias_1h.atr_14);
  const warn4h  = isWarning(data?.bias_4h.trend,  data?.bias_4h.current_price,  data?.bias_4h.last_high_price,  data?.bias_4h.last_low_price,  data?.bias_4h.atr_14);
  const warnd1  = isWarning(data?.bias_d1?.trend,  data?.bias_d1?.current_price,  data?.bias_d1?.last_high_price,  data?.bias_d1?.last_low_price,  data?.bias_d1?.atr_14);
  const warnw1  = isWarning(data?.bias_w1?.trend, data?.bias_w1?.current_price, data?.bias_w1?.last_high_price, data?.bias_w1?.last_low_price, data?.bias_w1?.atr_14);
  const trans15m = isChochTransition(data?.bias_15m.trend, data?.bias_15m.latest_choch, "15m");
  const trans1h  = isChochTransition(data?.bias_1h.trend,  data?.bias_1h.latest_choch,  "1h");
  const trans4h  = isChochTransition(data?.bias_4h.trend,  data?.bias_4h.latest_choch,  "4h");
  const transd1  = isChochTransition(data?.bias_d1?.trend, data?.bias_d1?.latest_choch, "d1");
  const transw1  = isChochTransition(data?.bias_w1?.trend, data?.bias_w1?.latest_choch, "w1");
  const warnTag = (w: boolean) => (w ? " ⚠" : "");
  const tooltip = isLoading
    ? `${display}: loading…`
    : isError
      ? `${display}: data not yet available`
      : (() => {
          const rows: Array<{ label: string; bias: typeof data.bias_15m; warn: boolean }> = [
            { label: "15M", bias: data!.bias_15m, warn: warn15 },
            { label: "1H",  bias: data!.bias_1h,  warn: warn1h  },
            { label: "4H",  bias: data!.bias_4h,  warn: warn4h  },
            { label: "D1",  bias: data!.bias_d1,  warn: warnd1  },
            { label: "W1",  bias: data!.bias_w1 ?? data!.bias_d1, warn: warnw1 },
          ];
          const lines = rows.map(({ label, bias, warn }) => {
            if (!bias) return "";
            const h    = bias.trend_health;
            const b    = bias.momentum?.body_ratio;
            const reg  = bias.momentum?.atr_regime;
            const hasBos   = !!bias.latest_bos;
            const hasChoch = !!bias.latest_choch;
            const dataLine =
              `${label}: ${trendLabel(bias.trend)} [${h ?? "—"}·${healthWord(h)}]` +
              `${momentumTag(bias.momentum)}·${bodyWord(b)}` +
              `${eventTag(bias.latest_bos)}${chochTag(bias.latest_choch)}` +
              `${warn ? " ⚠" : ""}`;
            const note = `   → ${rowNote(bias.trend, h, reg, b, hasBos, hasChoch)}`;
            return `${dataLine}\n${note}`;
          });
          const summary = pairSummary(data);
          return `${display}\n${lines.join("\n")}\n─────────────────────\n${summary}`;
        })();
  return (
    <button
      onClick={onSelect}
      title={tooltip}
      className={cn(
        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors text-left",
        active
          ? "bg-primary/15 border border-primary/30"
          : "border border-transparent hover:bg-white/5"
      )}
    >
      {/* Left: pair name + S1/S2/S3 dots stacked */}
      <div className="flex flex-col items-start">
        <span
          className={cn(
            "font-mono text-xs font-bold tracking-tight",
            active ? "text-primary" : "text-white/80"
          )}
        >
          {display}
        </span>
        
      </div>

      {/* Right: 15M / 1H / 4H bias dots */}
      <div className="flex items-center gap-1 self-start mt-0.5">
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_15m.trend, isLoading,trans15m), dotOpacity(data?.bias_15m.trend_health), warn15 && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_1h.trend,  isLoading,trans1h), dotOpacity(data?.bias_1h.trend_health),  warn1h  && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_4h.trend,  isLoading,trans4h), dotOpacity(data?.bias_4h.trend_health),  warn4h  && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_d1?.trend, isLoading,transd1), dotOpacity(data?.bias_d1?.trend_health), warnd1  && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_w1?.trend, isLoading,transw1), dotOpacity(data?.bias_w1?.trend_health), warnw1  && WARNING_CLASS)} />
      </div>
    </button>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function HeatmapSidebar({
  activeSymbol,
  onSelectSymbol,
  children,
  forceVisible = false,
}: {
  activeSymbol: string;
  onSelectSymbol: (s: string) => void;
  children?: React.ReactNode;
  forceVisible?: boolean;
}) {
  

  return (
    <aside className={cn(forceVisible ? "flex w-full" : "hidden lg:flex w-44", "flex-col shrink-0 border-r border-white/5 bg-[#0a0e17] overflow-hidden")}>
      {/* Pairs list — scrollable */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        <div className="px-2 pt-1 pb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
            Pairs
          </span>
          <div className="flex items-center gap-1.5 pr-0.5">
            <span className="text-[8px] font-mono text-white/30 w-2 text-center">15</span>
            <span className="text-[8px] font-mono text-white/30 w-2 text-center">1H</span>
            <span className="text-[8px] font-mono text-white/30 w-2 text-center">4H</span>
            <span className="text-[8px] font-mono text-white/30 w-2 text-center">D1</span>
            <span className="text-[8px] font-mono text-white/30 w-2 text-center">W1</span>
          </div>
        </div>

        {SYMBOLS.map((s) => (
          <HeatmapRow
            key={s.api}
            display={s.display}
            api={s.api}
            active={activeSymbol === s.api}
            onSelect={() => onSelectSymbol(s.api)}
            
          />
        ))}
      </div>

      {/* Trade Teller slot — pinned below pairs */}
      {children && (
        <div className="border-t border-white/5 shrink-0">
          {children}
        </div>
      )}
    </aside>
  );
}