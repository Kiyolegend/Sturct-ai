import React, { useState, useRef, useEffect } from "react";
import { Activity, BarChart2, ChevronDown } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useMT5Status } from "../hooks/use-trading-api";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ToggleState {
  zigzag: boolean;
  labels: boolean;
  zones: boolean;
  sr15m: boolean;
  sr1h: boolean;
  sr4h: boolean;
  sessions: boolean;
}

type TrendDir = "bullish" | "bearish" | "neutral";

interface TopBarProps {
  timeframe: string;
  setTimeframe: (tf: string) => void;
  toggles: ToggleState;
  setToggles: React.Dispatch<React.SetStateAction<ToggleState>>;
  symbol?: string;
  setSymbol?: (s: string) => void;
  trend?: TrendDir;
  bias15m?: TrendDir;
  bias1h?: TrendDir;
  bias4h?: TrendDir;
}

const SYMBOLS = [
  { display: "USDJPY",  api: "USD/JPY" },
  { display: "EURUSD",  api: "EUR/USD" },
  { display: "GBPUSD",  api: "GBP/USD" },
  { display: "EURJPY",  api: "EUR/JPY" },
  { display: "GBPJPY",  api: "GBP/JPY" },
  { display: "AUDUSD",  api: "AUD/USD" },
  { display: "USDCAD",  api: "USD/CAD" },
  { display: "USDCHF",  api: "USD/CHF" },
];

function BiasBadge({ label, trend }: { label: string; trend?: TrendDir }) {
  if (!trend) return null;
  const bull = trend === "bullish";
  const neutral = trend === "neutral";
  return (
    <div className={cn(
      "flex flex-col items-center px-2 py-1 rounded border text-center",
      neutral ? "bg-orange-500/10 border-orange-500/30"
        : bull ? "bg-teal-500/10 border-teal-500/30"
        : "bg-red-500/10 border-red-500/30"
    )}>
      <span className="text-[8px] font-semibold tracking-widest uppercase text-white/40">{label}</span>
      <span className={cn(
        "text-[10px] font-bold uppercase leading-none mt-0.5",
        neutral ? "text-orange-400" : bull ? "text-teal-400" : "text-red-400"
      )}>
        {neutral ? "CONS" : bull ? "BULL" : "BEAR"}
      </span>
    </div>
  );
}

function MT5Badge() {
  const { data } = useMT5Status();
  const online = data?.online ?? false;
  const age = data?.last_contact_secs_ago;
  const label = online ? "MT5 ● Live" : "API ● Backup";
  const tooltip = online
    ? `MT5 connected — last push ${age}s ago`
    : age != null ? `MT5 offline ${age}s ago — using Twelve Data` : "MT5 not connected — using Twelve Data";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider cursor-default select-none",
        online ? "bg-green-500/10 border-green-500/30 text-green-400"
               : "bg-orange-500/10 border-orange-500/30 text-orange-400"
      )}
      title={tooltip}
    >
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        online ? "bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.5)]"
               : "bg-orange-400 shadow-[0_0_6px_2px_rgba(251,146,60,0.4)]"
      )} />
      {label}
    </div>
  );
}

function SymbolSelector({ symbol, setSymbol }: { symbol: string; setSymbol: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = SYMBOLS.find(s => s.display === symbol) ?? SYMBOLS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#161e2c] border border-white/10 rounded-lg text-sm font-bold text-white hover:border-primary/40 transition-all"
      >
        <span className="text-primary text-xs font-mono">▣</span>
        {current.display}
        <ChevronDown className={cn("w-3.5 h-3.5 text-white/40 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-36 bg-[#0f1825] border border-white/10 rounded-lg shadow-2xl z-[999] overflow-hidden">
          {SYMBOLS.map(s => (
            <button
              key={s.api}
              onClick={() => { setSymbol(s.api); setOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-2 text-sm font-mono transition-colors",
                s.display === symbol
                  ? "bg-primary/20 text-primary font-bold"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              {s.display}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ timeframe, setTimeframe, toggles, setToggles, symbol = "USDJPY", setSymbol, trend, bias15m, bias1h, bias4h }: TopBarProps) {
  const timeframes = ["5M", "15M", "1H", "4H"];

  const toggleLayer = (key: keyof ToggleState) => {
    setToggles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="h-16 w-full border-b border-white/5 bg-[#0a0e17]/95 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 z-50 shrink-0">

      {/* LEFT: Logo + Symbol + Timeframes */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        <div className="hidden sm:flex items-center mr-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mr-3 border border-primary/20">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <span className="font-bold text-white tracking-tight text-lg">STRUCT<span className="text-primary">.ai</span></span>
        </div>

        {setSymbol && <SymbolSelector symbol={symbol} setSymbol={setSymbol} />}

        <div className="flex bg-[#161e2c] rounded-lg p-1 border border-white/5">
          {timeframes.map((tf) => {
            const apiTf = tf.toLowerCase();
            const isActive = timeframe === apiTf;
            return (
              <button
                key={tf}
                onClick={() => setTimeframe(apiTf)}
                className={cn(
                  "px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200",
                  isActive ? "bg-primary text-white shadow-md"
                           : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                {tf}
              </button>
            );
          })}
        </div>
      </div>

      {/* CENTER: Toggles */}
      <div className="hidden md:flex items-center gap-3">
        <div className="flex items-center gap-1 bg-[#161e2c] rounded-lg p-1 border border-white/5">
          <button onClick={() => toggleLayer('zigzag')} aria-pressed={toggles.zigzag}
            className={cn("p-2 rounded-md transition-colors", toggles.zigzag ? "text-white bg-white/10" : "text-white/40 hover:text-white/70")}
            title="Toggle ZigZag"><BarChart2 className="w-4 h-4" /></button>
          <button onClick={() => toggleLayer('labels')} aria-pressed={toggles.labels}
            className={cn("px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors", toggles.labels ? "text-white bg-white/10" : "text-white/40 hover:text-white/70")}
            title="Toggle Structure Labels">HH/LL</button>
          <button onClick={() => toggleLayer('zones')} aria-pressed={toggles.zones}
            className={cn("px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors", toggles.zones ? "text-white bg-white/10" : "text-white/40 hover:text-white/70")}
            title="Toggle S/D Zones">ZONES</button>
          <button onClick={() => toggleLayer('sessions')} aria-pressed={toggles.sessions}
            className={cn("px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors", toggles.sessions ? "text-white bg-white/10" : "text-white/40 hover:text-white/70")}
            title="Toggle Sessions">SESS</button>
        </div>

        <div className="flex items-center gap-1 bg-[#161e2c] rounded-lg p-1 border border-white/5">
          {(["sr15m","sr1h","sr4h"] as const).map(k => (
            <button key={k} onClick={() => toggleLayer(k)} aria-pressed={toggles[k]}
              className={cn("px-2 py-1.5 rounded-md text-[10px] font-bold transition-colors",
                toggles[k] ? "text-white bg-white/10" : "text-white/40 hover:text-white/70")}
              title={`Toggle S/R ${k.replace("sr","")}`}>
              {k.replace("sr","").toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: Bias + MT5 */}
      <div className="flex items-center space-x-2">
        <div className="hidden lg:flex items-center gap-1">
          <BiasBadge label="15M" trend={bias15m} />
          <BiasBadge label="1H"  trend={bias1h}  />
          <BiasBadge label="4H"  trend={bias4h}  />
        </div>
        <MT5Badge />
      </div>
    </div>
  );
}
