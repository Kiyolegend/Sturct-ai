import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMTFBias, type LatestStructureEvent, type MTFBiasResponse, type MTFBias } from "../hooks/use-trading-api";


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
  if (h >= 45) return "Average";
  if (h >= 25) return "Weak";
  return "Poor";
}

function bodyWord(b: number | null | undefined): string {
  if (b == null) return "";
  if (b >= 0.70) return "Strong commitment";
  if (b >= 0.45) return "Good commitment";
  if (b >= 0.25) return "Weak commitment";
  return "Mostly wicks";
}

function rowNote(
  trend: string | undefined,
  health: number | null | undefined,
  regime: string | undefined,
  body: number | null | undefined,
  hasBos: boolean,
  hasChoch: boolean,
  tf: string = "",           // ← add this parameter
): string {
  const h = health ?? 0;
  const b = body ?? 0;

  if (trend === "bullish") {
    if (h >= 75 && regime === "expanding"   && b >= 0.55) return "Bulls pushing hard with big committed candles. Strong buy environment.";
    if (h >= 75 && regime === "expanding"   && b <  0.45) return "Volatility expanding but candles are mostly wicks. Looks like a sweep, not a clean push.";
    if (h >= 75 && regime === "contracting" && b >= 0.45) return "Trend is healthy but taking a breath. Wait for volatility to return before entering.";
    if (h >= 75 && regime === "contracting" && b <  0.35) return "Very tight coil inside a clean bull. Big move building — favor upside.";
    if (h >= 65)                                          return "Clean healthy bull trend. Favor buys on pullbacks.";
    if (h <  45 && hasChoch)                              return "Fresh CHoCH is challenging this trend. Watch closely — may be turning.";
    if (h <  45)                                          return "Structure is technically bullish but weak and old. Low weight as confluence.";
    return "Bull trend present.";
  }

  if (trend === "bearish") {
    if (h >= 75 && regime === "expanding"   && b >= 0.55) return "Bears pushing hard with big committed candles. Strong sell environment.";
    if (h >= 75 && regime === "expanding"   && b <  0.45) return "Volatility expanding but mostly wicks. Looks like a sweep, not a clean push.";
    if (h >= 75 && regime === "contracting" && b >= 0.45) return "Bear trend healthy but pausing. Wait for volatility to return before selling.";
    if (h >= 75 && regime === "contracting" && b <  0.35) return "Very tight coil inside a clean bear. Favor next leg down.";
    if (h >= 65)                                          return "Clean healthy bear trend. Favor sells on bounces.";
    if (h <  45 && hasChoch)                              return "Fresh CHoCH challenging this trend. Possible reversal building.";
    if (h <  45)                                          return "Technically bearish but structure is weak and old. Low weight as confluence.";
    return "Bear trend present.";
  }

  // Consolidation — vary note by timeframe to avoid repetition
  if (hasBos && b < 0.40)
    return "A break appeared but candles aren't committing. Could be a false breakout. Wait for stronger candle closes.";
  if (regime === "expanding" && b >= 0.55)
    return "Breaking out with conviction — structural direction not confirmed yet.";
  if (regime === "expanding" && b <  0.45)
    return "Big ranges but mostly wicks. Looks like a liquidity grab, not a real breakout.";
  if (regime === "contracting" && b < 0.30)
    return "Market coiling very tightly. Big move coming — wait for the structural break.";
  if (regime === "contracting") {
    if (tf === "15M" || tf === "1H")
      return "Market is balanced. Neither side has gained control yet. Wait for a decisive break.";
    if (tf === "4H")
      return "The range is intact. Institutional direction not yet decided on this timeframe. Patience required.";
    return "Both sides active but no clear winner. Wait for one side to take control.";
  }
  if (h < 45) return "Weak structure with no direction. Avoid trading this timeframe.";
  return "Range market. No clear bias. Wait for structural confirmation before taking a side.";
}


function storySection(data: MTFBiasResponse | undefined): string {
  if (!data) return "";

  const tfs = [
    { label: "W1",  bias: data.bias_w1  ?? null },
    { label: "D1",  bias: data.bias_d1  ?? null },
    { label: "4H",  bias: data.bias_4h  ?? null },
    { label: "1H",  bias: data.bias_1h  ?? null },
    { label: "15M", bias: data.bias_15m ?? null },
  ];

  // ── Status list ─────────────────────────────
  const statusLines = tfs
    .filter(t => t.bias)
    .map(({ label, bias }) => {
      const icon = bias!.trend === "bullish" ? "✓" : bias!.trend === "bearish" ? "✗" : "•";
      const word = bias!.trend === "bullish" ? "Bullish" : bias!.trend === "bearish" ? "Bearish" : "Consolidating";
      return `${icon} ${label}: ${word}`;
    })
    .join("\n");

  // ── Key Driver ──────────────────────────────
  const driverCandidates = tfs
    .filter(t => t.bias && t.bias.trend !== "neutral" && t.bias.trend_health != null)
    .map(t => ({ label: t.label, bias: t.bias! }));
  const best = driverCandidates.length > 0
    ? driverCandidates.reduce((a, b) => a.bias.trend_health! >= b.bias.trend_health! ? a : b)
    : null;
  const keyDriverLine = best
    ? `Key Driver: ${best.label} ${best.bias.trend === "bullish" ? "Bull" : "Bear"} Trend (${best.bias.trend_health} · ${healthWord(best.bias.trend_health)})`
    : "";

  // ── Story logic ─────────────────────────────
  const htf = [data.bias_4h, data.bias_d1, data.bias_w1].filter(Boolean) as typeof data.bias_4h[];
  const ltf = [data.bias_1h, data.bias_15m].filter(Boolean) as typeof data.bias_1h[];
  const htfBull = htf.filter(b => b.trend === "bullish").length;
  const htfBear = htf.filter(b => b.trend === "bearish").length;
  const ltfBull = ltf.filter(b => b.trend === "bullish").length;
  const ltfBear = ltf.filter(b => b.trend === "bearish").length;
  const ltfCons = ltf.filter(b => b.trend === "neutral").length;

  let interpretation: string;
  let tradeBias: string;
  let confidence: number;
  let action: string;
  let actionReason: string;

  if (htfBull + ltfBull === 5) {
    interpretation = "Every timeframe is aligned bullish. This is a high-conviction environment. Favor buys on pullbacks to structure.";
    tradeBias = "🟢 Strongly Bullish"; confidence = 95;
    action = "✔ Look for Buy Setups";
    actionReason = "Full multi-timeframe alignment. Enter on the next 15M pullback to a structural level.";
  } else if (htfBear + ltfBear === 5) {
    interpretation = "Every timeframe is aligned bearish. This is a high-conviction environment. Favor sells on bounces to structure.";
    tradeBias = "🔴 Strongly Bearish"; confidence = 95;
    action = "✔ Look for Sell Setups";
    actionReason = "Full multi-timeframe alignment. Enter on the next 15M bounce to a structural level.";
  } else if (htfBull >= 2 && ltfBear >= 1) {
    interpretation = "Higher timeframes remain bullish but lower timeframes are pulling back. This looks like a retracement, not a reversal. The higher-probability play is to wait for lower timeframes to resume bullish structure before entering long.";
    tradeBias = "🟢 Moderately Bullish"; confidence = 78;
    action = "✔ Wait";
    actionReason = "LTF pullback in progress. Let 15M and 1H reclaim bullish structure first.";
  } else if (htfBear >= 2 && ltfBull >= 1) {
    interpretation = "Higher timeframes remain bearish but lower timeframes are bouncing. This looks like a correction inside the downtrend. Wait for the bounce to fade and lower timeframes to turn bearish again before selling.";
    tradeBias = "🔴 Moderately Bearish"; confidence = 78;
    action = "✔ Wait";
    actionReason = "LTF bounce in progress. Let 15M and 1H turn bearish again before selling.";
  } else if (htfBull >= 2 && ltfCons === 2) {
    interpretation = "The long-term trend is bullish but lower timeframes are resting inside a range. Current price action resembles a healthy pause rather than a reversal. Wait for the 15M and 1H to resume bullish structure before entering long positions.";
    tradeBias = "🟡 Cautiously Bullish"; confidence = 68;
    action = "✔ Wait";
    actionReason = "Higher timeframe trend bullish but entry not confirmed yet. Watch for LTF breakout upward.";
  } else if (htfBear >= 2 && ltfCons === 2) {
    interpretation = "The long-term trend is bearish but lower timeframes are ranging. Looks like a pause inside the downtrend. Wait for the 15M and 1H to break back bearish before looking for sells.";
    tradeBias = "🟡 Cautiously Bearish"; confidence = 68;
    action = "✔ Wait";
    actionReason = "Higher timeframe trend bearish but entry not confirmed yet. Watch for LTF breakdown lower.";
  } else if (htfBull >= 2 && ltfBull >= 1) {
    interpretation = "Higher and lower timeframes are aligning bullish. Confluence is building. Watch for remaining timeframes to confirm direction before committing.";
    tradeBias = "🟢 Building Bullish"; confidence = 72;
    action = "✔ Prepare for Buys";
    actionReason = "Alignment building. Wait for final timeframe confirmation before entering.";
  } else if (htfBear >= 2 && ltfBear >= 1) {
    interpretation = "Higher and lower timeframes are aligning bearish. Confluence is building. Watch for remaining timeframes to confirm before committing.";
    tradeBias = "🔴 Building Bearish"; confidence = 72;
    action = "✔ Prepare for Sells";
    actionReason = "Alignment building. Wait for final timeframe confirmation before entering.";
  } else if (htf.every(b => b.trend === "neutral") && ltf.every(b => b.trend === "neutral")) {
    interpretation = "No directional trend on any timeframe. The market is ranging at every level. Avoid directional trades entirely until structure forms.";
    tradeBias = "⚪ No Direction"; confidence = 20;
    action = "✔ Stay Flat";
    actionReason = "No directional structure anywhere. Wait for a trend to form.";
  } else {
    interpretation = "Timeframes are giving conflicting signals with no clear narrative. This is a low-quality environment for trend trades. The highest-probability action is to wait for alignment.";
    tradeBias = "⚫ Mixed — Avoid"; confidence = 35;
    action = "✔ Stay Flat";
    actionReason = "Conflicting signals across timeframes. No high-probability setup available.";
  }

  const stars =
    confidence >= 90 ? "★★★★★" :
    confidence >= 75 ? "★★★★☆" :
    confidence >= 60 ? "★★★☆☆" :
    confidence >= 40 ? "★★☆☆☆" : "★☆☆☆☆";

  return [
    `─────────────────────`,
    `Market Narrative`,
    statusLines,
    keyDriverLine,
    ``,
    interpretation,
    ``,
    `Trade Bias: ${tradeBias}`,
    `Confidence: ${stars} ${confidence}/100`,
    ``,
    `Suggested Action: ${action}`,
    `Reason: ${actionReason}`,
  ].join("\n");
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
  
  const tooltip = isLoading
    ? `${display}: loading…`
    : isError
      ? `${display}: data not yet available`
      : (() => {
          const rows: Array<{ label: string; bias: MTFBias | undefined; warn: boolean }> = [
            { label: "15M", bias: data!.bias_15m, warn: warn15 },
            { label: "1H",  bias: data!.bias_1h,  warn: warn1h  },
            { label: "4H",  bias: data!.bias_4h,  warn: warn4h  },
            { label: "D1",  bias: data!.bias_d1,  warn: warnd1  },
            { label: "W1",  bias: data!.bias_w1, warn: warnw1 },
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
            const note = `   → ${rowNote(bias.trend, h, reg, b, hasBos, hasChoch, label)}`;
            return `${dataLine}\n${note}`;
          });
          const summary = storySection(data);
          return `${display}\n${lines.join("\n")}\n${summary}`;
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