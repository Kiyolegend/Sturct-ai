import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMTFBias } from "../hooks/use-trading-api";

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
];

type TrendDir = "bullish" | "bearish" | "neutral";

const WARNING_THRESHOLDS = { "15m": 0.003, "1h": 0.005, "4h": 0.008 };

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

function isWarning(
  trend: TrendDir | undefined,
  currentPrice: number | null | undefined,
  lastHighPrice: number | null | undefined,
  lastLowPrice: number | null | undefined,
  thresholdPct: number,
): boolean {
  if (!currentPrice) return false;
  if (trend === "bullish" && lastLowPrice != null) {
    const distance = lastLowPrice - currentPrice;
    return distance > currentPrice * thresholdPct;
  }
  if (trend === "bearish" && lastHighPrice != null) {
    const distance = currentPrice - lastHighPrice;
    return distance > currentPrice * thresholdPct;
  }
  return false;
}

const WARNING_CLASS = "ring-2 ring-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]";

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

  const warn15 = isWarning(
    data?.bias_15m.trend,
    data?.bias_15m.current_price,
    data?.bias_15m.last_high_price,
    data?.bias_15m.last_low_price,
    WARNING_THRESHOLDS["15m"],
  );
  const warn1h = isWarning(
    data?.bias_1h.trend,
    data?.bias_1h.current_price,
    data?.bias_1h.last_high_price,
    data?.bias_1h.last_low_price,
    WARNING_THRESHOLDS["1h"],
  );
  const warn4h = isWarning(
    data?.bias_4h.trend,
    data?.bias_4h.current_price,
    data?.bias_4h.last_high_price,
    data?.bias_4h.last_low_price,
    WARNING_THRESHOLDS["4h"],
  );

  const warnTag = (w: boolean) => (w ? " ⚠" : "");
  const tooltip = isLoading
    ? `${display}: loading…`
    : isError
      ? `${display}: data not yet available`
      : `${display}\n15M: ${trendLabel(data?.bias_15m.trend)}${warnTag(warn15)}   1H: ${trendLabel(data?.bias_1h.trend)}${warnTag(warn1h)}   4H: ${trendLabel(data?.bias_4h.trend)}${warnTag(warn4h)}`;

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
      <span
        className={cn(
          "font-mono text-xs font-bold tracking-tight",
          active ? "text-primary" : "text-white/80"
        )}
      >
        {display}
      </span>
      <div className="flex items-center gap-1">
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_15m.trend, isLoading), warn15 && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_1h.trend, isLoading), warn1h && WARNING_CLASS)} />
        <span className={cn("w-2 h-2 rounded-full", dotColor(data?.bias_4h.trend, isLoading), warn4h && WARNING_CLASS)} />
      </div>
    </button>
  );
}

export function HeatmapSidebar({
  activeSymbol,
  onSelectSymbol,
  children,
}: {
  activeSymbol: string;
  onSelectSymbol: (s: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <aside className="hidden lg:flex flex-col w-44 shrink-0 border-r border-white/5 bg-[#0a0e17] overflow-hidden">
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