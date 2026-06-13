import React, { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, RefreshCw, Loader2, Zap } from "lucide-react";
import { useQuickScalpScan, type QuickScalpSignal, useBrokerTime } from "@/hooks/use-trading-api";
import { TradePanel } from "@/components/TradePanel";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

interface ScalpPageProps {
  symbol:    string;
  setSymbol: (s: string) => void;
}

function CheckRow({ label, ok, msg }: { label: string; ok: boolean; msg: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`w-4 text-center font-bold ${ok ? "text-emerald-400" : "text-red-400/50"}`}>
        {ok ? "✓" : "✗"}
      </span>
      <span className="text-white/30 w-16 shrink-0">{label}</span>
      <span className={ok ? "text-white/60" : "text-white/25"}>{msg}</span>
    </div>
  );
}

function SignalCard({
  signal,
  isActive,
  onUse,
}: {
  signal:   QuickScalpSignal;
  isActive: boolean;
  onUse:    () => void;
}) {
  const isBuy = signal.direction === "BUY";
  const isGreen  = signal.status === "green";
  const isYellow = signal.status === "yellow";

  const borderColor = isGreen
    ? "border-emerald-500/40 bg-emerald-500/5"
    : isYellow
    ? "border-yellow-500/25 bg-yellow-500/5"
    : "border-white/5 bg-white/[0.02]";

  const leftAccent = isGreen
    ? "border-l-emerald-400"
    : isYellow
    ? "border-l-yellow-400/50"
    : "border-l-white/10";

  return (
    <div className={`rounded-lg border border-l-4 ${borderColor} ${leftAccent} ${isActive ? "ring-1 ring-white/10" : ""} p-3 flex flex-col gap-2`}>

      {/* Header row */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          isGreen ? "bg-emerald-400 animate-pulse" : isYellow ? "bg-yellow-400" : "bg-white/20"
        }`} />
        <span className="font-mono text-sm font-bold text-white/80">
          {signal.symbol.replace("/", "")}
        </span>
        {signal.direction && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
            isBuy ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
          }`}>
            {signal.direction}
          </span>
        )}
        {signal.mode && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary font-bold font-mono">
            Mode {signal.mode}
          </span>
        )}
        <div className="flex-1" />
        <span className={`text-[10px] font-medium ${
          isGreen ? "text-emerald-400" : isYellow ? "text-yellow-400" : "text-white/25"
        }`}>
          {isGreen ? "READY" : isYellow ? "PARTIAL" : "NO SETUP"}
        </span>
      </div>

      {/* Reason */}
      <p className={`text-[11px] leading-relaxed ${
        isGreen ? "text-emerald-300/70" : isYellow ? "text-yellow-300/60" : "text-white/20"
      }`}>
        {signal.reason}
      </p>

      {/* SL / TP row — only when we have prices */}
      {signal.sl && signal.tp && (
        <div className="grid grid-cols-3 gap-2 text-[11px] border-t border-white/5 pt-2">
          <div>
            <div className="text-white/25 text-[9px] uppercase mb-0.5">Entry</div>
            <div className="font-mono text-white/60">{signal.entry ?? "—"}</div>
          </div>
          <div>
            <div className="text-red-400/50 text-[9px] uppercase mb-0.5">SL</div>
            <div className="font-mono text-white/60">{signal.sl}</div>
            <div className="text-white/25 text-[9px]">{signal.sl_pips ? `${signal.sl_pips}p` : ""}</div>
          </div>
          <div>
            <div className="text-emerald-400/50 text-[9px] uppercase mb-0.5">TP</div>
            <div className="font-mono text-white/60">{signal.tp}</div>
            <div className="text-white/25 text-[9px]">{signal.tp_pips}p</div>
          </div>
        </div>
      )}

      {/* Check rows — always visible */}
      {(signal.status === "green" || signal.status === "yellow") && (
        <div className="flex flex-col gap-1 border-t border-white/5 pt-2">
          {signal.checks.session && <CheckRow label="Session" ok={signal.checks.session.ok} msg={signal.checks.session.msg} />}
          {signal.checks.trend   && <CheckRow label="Trend"   ok={signal.checks.trend.ok}   msg={signal.checks.trend.msg}   />}
          {signal.checks.news    && <CheckRow label="News"    ok={signal.checks.news.ok}    msg={signal.checks.news.msg}    />}
          {signal.checks.mode_a  && <CheckRow label="Mode A"  ok={signal.checks.mode_a.ok}  msg={signal.checks.mode_a.msg}  />}
          {signal.checks.mode_b  && <CheckRow label="Mode B"  ok={signal.checks.mode_b.ok}  msg={signal.checks.mode_b.msg}  />}
          {signal.checks.mode_c  && <CheckRow label="Mode C"  ok={signal.checks.mode_c.ok}  msg={signal.checks.mode_c.msg}  />}
          {signal.checks.mode_d  && <CheckRow label="Mode D"  ok={signal.checks.mode_d.ok}  msg={signal.checks.mode_d.msg}  />}
        </div>
      )}

      {/* Use Setup button — green only */}
      {isGreen && signal.sl && signal.tp && (
        <button
          onClick={onUse}
          className={`mt-1 w-full py-2 rounded-lg text-sm font-bold transition-all ${
            isBuy
              ? "bg-emerald-500 hover:bg-emerald-400 text-white"
              : "bg-red-500 hover:bg-red-400 text-white"
          }`}
        >
          {isBuy ? "▲" : "▼"} Use Setup → {signal.symbol.replace("/", "")}
        </button>
      )}
    </div>
  );
}

export function ScalpPage({ symbol, setSymbol }: ScalpPageProps) {
  const [, navigate]  = useLocation();
  const { toast }     = useToast();
  const [scalpMode, setScalpMode] = useState<"auto" | "notify">("notify");
  const [prefill, setPrefill]     = useState<{
    direction: "BUY" | "SELL";
    sl: number; tp: number;
    entry?: number;
    orderType?: "MARKET" | "LIMIT";
  } | null>(null);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuickScalpScan(20_000);
  const { data: brokerTimeData } = useBrokerTime();

  const signals     = data?.signals ?? [];
  const greenCount  = signals.filter(s => s.status === "green").length;
  const yellowCount = signals.filter(s => s.status === "yellow").length;

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  // Green transition detection
  const prevStatusRef = useRef<Record<string, string>>({});

  const handleUse = (signal: QuickScalpSignal) => {
    if (!signal.direction || !signal.sl || !signal.tp) return;
    setSymbol(signal.symbol);
    setPrefill({
      direction: signal.direction,
      sl:        signal.sl,
      tp:        signal.tp,
      entry:     signal.entry ?? undefined,
      orderType: "MARKET",
    });
  };

  useEffect(() => {
    if (!data?.signals) return;
    for (const sig of data.signals) {
      const prev = prevStatusRef.current[sig.symbol];
      if (sig.status === "green" && prev !== undefined && prev !== "green") {
        if (scalpMode === "auto") {
          handleUse(sig);
        } else {
          const isBuy = sig.direction === "BUY";
          toast({
            title: `⚡ ${sig.symbol.replace("/", "")} ${sig.direction}${sig.mode ? ` · Mode ${sig.mode}` : ""}`,
            description: sig.reason,
            action: (
              <ToastAction
                altText="Use this scalp setup"
                onClick={() => handleUse(sig)}
                className={isBuy ? "bg-emerald-500 hover:bg-emerald-400 text-white border-0" : "bg-red-500 hover:bg-red-400 text-white border-0"}
              >
                {isBuy ? "▲ Use" : "▼ Use"}
              </ToastAction>
            ),
          });
        }
      }
    }
    prevStatusRef.current = Object.fromEntries(data.signals.map(s => [s.symbol, s.status]));
  }, [data]);

  const currentPrice = brokerTimeData?.broker_time ?? 0;

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0e17] text-white overflow-hidden font-sans">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 bg-[#0a0f1a] shrink-0">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors text-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Chart
        </button>

        <div className="w-px h-4 bg-white/10" />

        <Zap className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-bold uppercase tracking-widest text-white/70">Quick Scalp</span>

        <div className="flex items-center gap-1.5">
          {greenCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-bold">
              {greenCount} ready
            </span>
          )}
          {yellowCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">
              {yellowCount} partial
            </span>
          )}
        </div>

        <div className="flex-1" />

        <span className="text-[10px] text-white/20 font-mono">
          5M · SL=structural · TP=6-8p · 0.02 lots{lastUpdate ? ` · ${lastUpdate}` : ""}
        </span>

        {/* AUTO / NOTIFY toggle */}
        <button
          onClick={() => setScalpMode(m => m === "auto" ? "notify" : "auto")}
          className={`text-[10px] px-3 py-1 rounded-full font-bold border transition-all ${
            scalpMode === "auto"
              ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
              : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"
          }`}
        >
          {scalpMode === "auto" ? "⚡ AUTO" : "🔔 NOTIFY"}
        </button>

        {isLoading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/30" />
          : <button onClick={() => refetch()} className="text-white/20 hover:text-white/50 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
        }
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-row min-h-0">

        {/* Left — signal cards */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {isLoading && signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-sm">Scanning pairs…</span>
            </div>
          ) : (
            signals.map(sig => (
              <SignalCard
                key={sig.symbol}
                signal={sig}
                isActive={sig.symbol === symbol}
                onUse={() => handleUse(sig)}
              />
            ))
          )}
        </div>

        {/* Right — trade panel */}
        <div className="w-72 shrink-0 border-l border-white/5 overflow-y-auto">
          <TradePanel
            symbol={symbol}
            currentPrice={0}
            clickedPrice={null}
            onClickedPriceConsumed={() => {}}
            onSLChange={() => {}}
            onTPChange={() => {}}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
          />
        </div>

      </div>
    </div>
  );
}