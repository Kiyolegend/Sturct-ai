import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMTFBias, type LatestStructureEvent } from "../hooks/use-trading-api";


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

function dotColor(trend?: TrendDir, isLoading?: boolean) {
  if (trend === "bullish") return "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]";
  if (trend === "bearish") return "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.6)]";
  if (trend === "neutral") return "bg-orange-400 shadow-[0_0_4px_rgba(251,146,60,0.5)]";
  if (isLoading) return "bg-white/30 animate-pulse";
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
  const warnTag = (w: boolean) => (w ? " ⚠" : "");
  const tooltip = isLoading
    ? `${display}: loading…`
    : isError
      ? `${display}: data not yet available`
      : `${display}\n15M: ${trendLabel(data?.bias_15m.trend)}${healthTag(data?.bias_15m.trend_health)}${eventTag(data?.bias_15m.latest_bos)}${chochTag(data?.bias_15m.latest_choch)}${warnTag(warn15)}\n1H: ${trendLabel(data?.bias_1h.trend)}${healthTag(data?.bias_1h.trend_health)}${eventTag(data?.bias_1h.latest_bos)}${chochTag(data?.bias_1h.latest_choch)}${warnTag(warn1h)}\n4H: ${trendLabel(data?.bias_4h.trend)}${healthTag(data?.bias_4h.trend_health)}${eventTag(data?.bias_4h.latest_bos)}${chochTag(data?.bias_4h.latest_choch)}${warnTag(warn4h)}\nD1: ${trendLabel(data?.bias_d1?.trend)}${healthTag(data?.bias_d1?.trend_health)}${eventTag(data?.bias_d1?.latest_bos)}${chochTag(data?.bias_d1?.latest_choch)}${warnTag(warnd1)}\nW1: ${trendLabel(data?.bias_w1?.trend)}${healthTag(data?.bias_w1?.trend_health)}${eventTag(data?.bias_w1?.latest_bos)}${chochTag(data?.bias_w1?.latest_choch)}${warnTag(warnw1)}`;

  // Flash ring when any strategy is active
  

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
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_15m.trend, isLoading), dotOpacity(data?.bias_15m.trend_health), warn15 && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_1h.trend,  isLoading), dotOpacity(data?.bias_1h.trend_health),  warn1h  && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_4h.trend,  isLoading), dotOpacity(data?.bias_4h.trend_health),  warn4h  && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_d1?.trend, isLoading), dotOpacity(data?.bias_d1?.trend_health), warnd1  && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_w1?.trend, isLoading), dotOpacity(data?.bias_w1?.trend_health), warnw1  && WARNING_CLASS)} />
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