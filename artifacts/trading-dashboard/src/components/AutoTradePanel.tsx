import { useState } from "react";
import { useAutoTradeStatus, useAutoTradeLog } from "@/hooks/use-trading-api";

const STATUS_DOT: Record<string, string> = {
  READY:   "bg-teal-400 animate-pulse",
  WATCHING:"bg-yellow-400",
  WAITING: "bg-slate-600",
  NEUTRAL: "bg-slate-700",
  ERROR:   "bg-red-500",
};

function fmt(p: number | undefined): string {
  if (p == null) return "—";
  return p > 50 ? p.toFixed(3) : p.toFixed(5);
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return "";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
}

export function AutoTradePanel() {
  const { data: state, isLoading } = useAutoTradeStatus();
  const { data: logData }          = useAutoTradeLog();
  const [showLog, setShowLog]      = useState(false);
  const [busy, setBusy]            = useState(false);

  const enabled   = state?.enabled    ?? false;
  const paperMode = state?.paper_mode ?? true;
  const pairs     = state?.pairs      ?? {};
  const log       = logData?.log      ?? [];

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/trading-api/auto-trade/${enabled ? "off" : "on"}`, { method: "POST" });
    } finally { setBusy(false); }
  }

  async function setMode(paper: boolean) {
    if (enabled) return;
    setBusy(true);
    try {
      await fetch("/trading-api/auto-trade/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper }),
      });
    } finally { setBusy(false); }
  }

  const readyCount    = Object.values(pairs).filter(p => p.status === "READY").length;
  const watchingCount = Object.values(pairs).filter(p => p.status === "WATCHING").length;

  return (
    <div className="flex flex-col gap-2 p-3 bg-[#0f1520] border-t border-white/5 text-xs">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">
          Auto Trade
        </span>
        <div className="flex items-center gap-1.5">
          {/* Paper / Live pill */}
          <button
            onClick={() => setMode(!paperMode)}
            disabled={busy || enabled}
            title={enabled ? "Turn OFF before switching mode" : ""}
            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors
              ${paperMode
                ? "bg-sky-500/15 border-sky-500/30 text-sky-400"
                : "bg-red-500/15 border-red-500/30 text-red-400"
              } ${enabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}`}
          >
            {paperMode ? "PAPER" : "LIVE"}
          </button>

          {/* ON / OFF */}
          <button
            onClick={toggle}
            disabled={busy}
            className={`px-3 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all
              ${enabled
                ? "bg-teal-500/20 border-teal-500/40 text-teal-400 hover:bg-teal-500/30"
                : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
              } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {enabled ? "● ON" : "○ OFF"}
          </button>
        </div>
      </div>

      {/* Summary counts */}
      {!isLoading && Object.keys(pairs).length > 0 && (
        <div className="flex gap-3 text-[9px] px-0.5">
          <span className="text-teal-400">{readyCount} READY</span>
          <span className="text-yellow-400">{watchingCount} WATCHING</span>
          <span className="text-white/20">{Object.keys(pairs).length - readyCount - watchingCount} IDLE</span>
        </div>
      )}

      {/* Pair grid */}
      {!isLoading && Object.keys(pairs).length > 0 && (
        <div className="flex flex-col gap-1">
          {Object.values(pairs)
            .sort((a, b) => {
              const o: Record<string,number> = { READY:0, WATCHING:1, WAITING:2, NEUTRAL:3, ERROR:4 };
              return (o[a.status] ?? 5) - (o[b.status] ?? 5);
            })
            .map(pair => (
              <div
                key={pair.symbol}
                style={{
                  background: pair.status === "READY"
                    ? pair.exhaustion_signal ? "rgba(251,146,60,0.06)" : "rgba(38,166,154,0.06)"
                    : "rgba(255,255,255,0.02)",
                  border: `1px solid ${
                    pair.status === "READY"
                      ? pair.exhaustion_signal ? "rgba(251,146,60,0.25)" : "rgba(38,166,154,0.20)"
                      : "rgba(255,255,255,0.05)"
                  }`,
                  borderRadius: 5, padding: "5px 8px",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[pair.status] ?? "bg-slate-700"}`} />
                  <span className="text-white/70 font-mono font-bold text-[10px] w-14 flex-shrink-0">
                    {pair.symbol?.replace("/", "")}
                  </span>

                  {pair.status === "READY" ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className={`text-[9px] font-bold ${pair.direction === "BUY" ? "text-teal-400" : "text-red-400"}`}>
                        {pair.direction}
                      </span>
                      <span className="text-white/30 text-[9px]">E:{fmt(pair.entry)}</span>
                      <span className="text-white/20 text-[9px]">R:R {pair.rr}</span>
                      <div className="ml-auto flex items-center gap-1">
                        {pair.exhaustion_signal && (
                          <span className="text-orange-400 font-bold text-[9px]">
                            ⚡{pair.exhaustion_score}
                          </span>
                        )}
                        <span className="text-white/20 text-[9px]">{pair.entry_source}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-[9px] text-white/25 truncate flex-1">
                      {pair.d1 && (
                        <span className={pair.d1 === "bullish" ? "text-teal-500/60" : "text-red-500/60"}>
                          D1 {pair.d1}{" · "}
                        </span>
                      )}
                      {pair.reason
                        ?.replace(/D1 (bullish|bearish) ✓\s*/g, "")
                        .replace(/D1 (bullish|bearish)\s*/g, "")}
                    </span>
                  )}
                </div>

                {/* Exhaustion detail row — only on READY signals */}
                {pair.status === "READY" && pair.exhaustion_signal && pair.exhaustion_detail && (
                  <div className="mt-1 text-[8px] text-orange-400/50 truncate pl-3">
                    {pair.exhaustion_detail}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {isLoading && (
        <div className="text-[9px] text-white/20 text-center py-2">Loading…</div>
      )}

      {!isLoading && !enabled && Object.keys(pairs).length === 0 && (
        <div className="text-[9px] text-white/20 text-center py-2">
          Turn ON to start scanning all 11 pairs
        </div>
      )}

      {/* Log toggle */}
      {log.length > 0 && (
        <button
          onClick={() => setShowLog(v => !v)}
          className="text-[9px] text-white/20 hover:text-white/40 text-left transition-colors"
        >
          {showLog ? "▲ Hide log" : `▼ Show log (${log.length})`}
        </button>
      )}

      {/* Log entries */}
      {showLog && log.map((entry, i) => {
        const isBuy = entry.direction === "BUY";
        const c = isBuy ? "#26a69a" : "#ef5350";
        return (
          <div key={i} style={{ background:`${c}08`, border:`1px solid ${c}25`, borderRadius:5, padding:"5px 8px" }}>
            <div className="flex items-center gap-1.5">
              <span style={{ color:c, fontSize:10, fontWeight:700 }}>{entry.direction}</span>
              <span className="text-white/60 font-mono text-[10px]">{entry.symbol?.replace("/","")}</span>
              <span className="text-white/20 text-[9px]">{entry.paper_mode ? "PAPER" : "LIVE"}</span>
              {entry.exhaustion_signal && <span className="text-orange-400 text-[9px]">⚡{entry.exhaustion_score}</span>}
              <span className="text-white/20 text-[9px] ml-auto">{timeAgo(entry.fired_at)}</span>
            </div>
            <div className="flex gap-2 mt-0.5 text-[9px] text-white/25">
              <span>E:{fmt(entry.entry)}</span>
              <span>SL:{fmt(entry.sl)}</span>
              <span>TP:{fmt(entry.tp)}</span>
              <span>R:R {entry.rr}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}