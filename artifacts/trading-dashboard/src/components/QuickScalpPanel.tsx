import React, { useState } from "react";
import { Zap, RefreshCw, Loader2 } from "lucide-react";
import { useQuickScalpScan, type QuickScalpSignal } from "@/hooks/use-trading-api";

interface QuickScalpPanelProps {
  activeSymbol: string;
  onUseSetup: (signal: QuickScalpSignal) => void;
}

const STATUS_STYLE = {
  green:  { dot: "bg-emerald-400 animate-pulse", border: "border-emerald-500/30 bg-emerald-500/5",  label: "text-emerald-400" },
  yellow: { dot: "bg-yellow-400",                border: "border-yellow-500/20 bg-yellow-500/5",    label: "text-yellow-400"  },
  red:    { dot: "bg-red-500/50",                border: "border-white/5 bg-white/3",               label: "text-white/30"    },
};

function CheckRow({ label, ok, msg }: { label: string; ok: boolean; msg: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span className={ok ? "text-emerald-400" : "text-red-400/60"}>{ok ? "✓" : "✗"}</span>
      <span className="text-white/30 w-16 shrink-0">{label}</span>
      <span className={ok ? "text-white/50" : "text-white/25"}>{msg}</span>
    </div>
  );
}

function SignalCard({
  signal,
  isActive,
  onUse,
}: {
  signal: QuickScalpSignal;
  isActive: boolean;
  onUse: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = STATUS_STYLE[signal.status];
  const isBuy = signal.direction === "BUY";

  if (signal.status === "red") {
    return (
      <div className={`flex items-center gap-2 px-2 py-1.5 rounded border ${style.border}`}>
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
        <span className="text-white/25 text-[10px] font-mono flex-1">{signal.symbol.replace("/", "")}</span>
        <span className="text-white/20 text-[10px] truncate max-w-[120px]">{signal.reason}</span>
      </div>
    );
  }

  return (
    <div className={`rounded border ${style.border} ${isActive ? "ring-1 ring-white/10" : ""}`}>
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
        <span className="font-mono text-[10px] text-white/70 w-10 shrink-0">
          {signal.symbol.replace("/", "")}
        </span>
        {signal.direction && (
          <span className={`text-[10px] font-bold px-1 rounded ${isBuy ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
            {signal.direction}
          </span>
        )}
        <span className={`text-[10px] flex-1 ${style.label}`}>
          {signal.status === "green" ? signal.reason : `Partial — ${signal.reason}`}
        </span>
        <span className="text-white/20 text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-1">
          <div className="grid grid-cols-3 gap-1 text-[10px] text-white/50 border-t border-white/5 pt-1.5">
            <div>
              <div className="text-white/25 uppercase text-[9px]">Entry</div>
              <div className="font-mono text-white/70">{signal.entry ?? "—"}</div>
            </div>
            <div>
              <div className="text-red-400/50 uppercase text-[9px]">SL</div>
              <div className="font-mono text-white/60">{signal.sl ?? "—"}</div>
              <div className="text-white/25 text-[9px]">{signal.sl_pips ? `${signal.sl_pips}p` : ""}</div>
            </div>
            <div>
              <div className="text-emerald-400/50 uppercase text-[9px]">TP</div>
              <div className="font-mono text-white/60">{signal.tp ?? "—"}</div>
              <div className="text-white/25 text-[9px]">{signal.tp_pips}p</div>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 border-t border-white/5 pt-1">
            {signal.checks.session  && <CheckRow label="Session"  ok={signal.checks.session.ok}  msg={signal.checks.session.msg}  />}
            {signal.checks.trend    && <CheckRow label="Trend"    ok={signal.checks.trend.ok}    msg={signal.checks.trend.msg}    />}
            {signal.checks.momentum && <CheckRow label="Momentum" ok={signal.checks.momentum.ok} msg={signal.checks.momentum.msg} />}
            {signal.checks.choch    && <CheckRow label="CHoCH"    ok={signal.checks.choch.ok}    msg={signal.checks.choch.msg}    />}
            {signal.checks.news     && <CheckRow label="News"     ok={signal.checks.news.ok}     msg={signal.checks.news.msg}     />}
          </div>

          {signal.status === "green" && signal.sl && signal.tp && (
            <button
              onClick={onUse}
              className={`mt-1 w-full py-1.5 rounded text-[11px] font-bold transition-all ${
                isBuy
                  ? "bg-emerald-500 hover:bg-emerald-400 text-white"
                  : "bg-red-500 hover:bg-red-400 text-white"
              }`}
            >
              {isBuy ? "▲" : "▼"} Use Setup → {signal.symbol.replace("/", "")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function QuickScalpPanel({ activeSymbol, onUseSetup }: QuickScalpPanelProps) {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuickScalpScan(20_000);

  const signals = data?.signals ?? [];
  const greenCount = signals.filter(s => s.status === "green").length;
  const yellowCount = signals.filter(s => s.status === "yellow").length;

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="flex flex-col gap-1.5 p-3 border-b border-white/5 bg-[#0a0f1a]">
      <div className="flex items-center gap-2">
        <Zap className="w-3 h-3 text-yellow-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Quick Scalp</span>
        <div className="flex-1" />
        {isLoading && <Loader2 className="w-3 h-3 animate-spin text-white/30" />}
        {!isLoading && (
          <button onClick={() => refetch()} className="text-white/20 hover:text-white/50 transition-colors">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
        <div className="flex items-center gap-1">
          {greenCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-bold">
              {greenCount} ready
            </span>
          )}
          {yellowCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">
              {yellowCount} partial
            </span>
          )}
        </div>
      </div>

      <div className="text-[9px] text-white/20 font-mono">
        5M · SL=structural swing · TP=6p · 0.02 lots · {lastUpdate ? `updated ${lastUpdate}` : "scanning…"}
      </div>

      <div className="flex flex-col gap-1">
        {isLoading && signals.length === 0 ? (
          <div className="text-[10px] text-white/20 text-center py-2">Scanning pairs…</div>
        ) : (
          signals.map(sig => (
            <SignalCard
              key={sig.symbol}
              signal={sig}
              isActive={sig.symbol === activeSymbol}
              onUse={() => onUseSetup(sig)}
            />
          ))
        )}
      </div>
    </div>
  );
}