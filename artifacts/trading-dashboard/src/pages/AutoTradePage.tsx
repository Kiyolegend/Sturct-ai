/**
 * AutoTradePage — dedicated full-screen page for the Auto Trade engine.
 * Route: /auto-trade  (opens in new tab from TopBar)
 */

import { useState } from "react";
import { useAutoTradeStatus, useAutoTradeLog } from "@/hooks/use-trading-api";
import { LoginGate } from "@/components/LoginGate";
import { useQueryClient } from "@tanstack/react-query";

const PAIRS = [
  "USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY", "GBP/JPY",
  "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "AUD/JPY", "CAD/JPY",
];

const STATUS_COLOR: Record<string, string> = {
  READY:    "#26a69a",
  WATCHING: "#f59e0b",
  WAITING:  "#475569",
  NEUTRAL:  "#374151",
  ERROR:    "#ef5350",
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

export function AutoTradePage() {
  const { data: state, isLoading } = useAutoTradeStatus();
  const { data: logData }          = useAutoTradeLog();
  const [busy, setBusy]            = useState(false);
  const [showLog, setShowLog]      = useState(true);
  const queryClient                = useQueryClient();

  const enabled    = state?.enabled    ?? false;
  const paperMode  = state?.paper_mode ?? true;
  const pairs      = state?.pairs      ?? {};
  const log        = logData?.log      ?? [];

  const readyCount    = Object.values(pairs).filter((p: any) => p.status === "READY").length;
  const watchingCount = Object.values(pairs).filter((p: any) => p.status === "WATCHING").length;
  const idleCount     = Object.keys(pairs).length - readyCount - watchingCount;

  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/trading-api/auto-trade/${enabled ? "off" : "on"}`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["auto-trade-status"] });
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
      queryClient.invalidateQueries({ queryKey: ["auto-trade-status"] });
    } finally { setBusy(false); }
  }

  const sortedPairs = Object.values(pairs).sort((a: any, b: any) => {
    const o: Record<string, number> = { READY: 0, WATCHING: 1, WAITING: 2, NEUTRAL: 3, ERROR: 4 };
    return (o[a.status] ?? 5) - (o[b.status] ?? 5);
  });

  return (
    <LoginGate>
      <div style={{ minHeight: "100vh", background: "#0a0e17", color: "white", fontFamily: "'Roboto Mono', monospace" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 24px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,14,23,0.98)", position: "sticky", top: 0, zIndex: 50,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "white" }}>
              STRUCT<span style={{ color: "#3b82f6" }}>.ai</span>
            </span>
            <span style={{ fontSize: 10, color: "#374151", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Auto Trade · 11 Pairs
            </span>
          </div>
          <a href="/" style={{ fontSize: 11, color: "#374151", textDecoration: "none" }}>← Back to chart</a>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>

          {/* Controls */}
          <div style={{
            display: "flex", alignItems: "center", gap: 16, marginBottom: 28,
            padding: "16px 20px",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10,
          }}>
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Engine
            </span>

            {/* Paper / Live */}
            <button
              onClick={() => setMode(!paperMode)}
              disabled={busy || enabled}
              style={{
                padding: "5px 14px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: enabled ? "not-allowed" : "pointer",
                opacity: enabled ? 0.5 : 1,
                background: paperMode ? "rgba(56,189,248,0.12)" : "rgba(239,83,80,0.12)",
                border: `1px solid ${paperMode ? "rgba(56,189,248,0.3)" : "rgba(239,83,80,0.3)"}`,
                color: paperMode ? "#38bdf8" : "#ef5350",
              }}
            >
              {paperMode ? "PAPER" : "LIVE"}
            </button>

            {/* ON / OFF */}
            <button
              onClick={toggle}
              disabled={busy}
              style={{
                padding: "5px 20px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: busy ? "not-allowed" : "pointer",
                background: enabled ? "rgba(38,166,154,0.18)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${enabled ? "rgba(38,166,154,0.4)" : "rgba(255,255,255,0.1)"}`,
                color: enabled ? "#26a69a" : "rgba(255,255,255,0.3)",
              }}
            >
              {enabled ? "● ON" : "○ OFF"}
            </button>

            {/* Summary counts */}
            {!isLoading && Object.keys(pairs).length > 0 && (
              <div style={{ display: "flex", gap: 20, marginLeft: 8, fontSize: 11 }}>
                <span style={{ color: "#26a69a", fontWeight: 700 }}>{readyCount} READY</span>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>{watchingCount} WATCHING</span>
                <span style={{ color: "#374151" }}>{idleCount} IDLE</span>
              </div>
            )}

            {!enabled && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#374151" }}>
                Turn ON to start scanning all 11 pairs
              </span>
            )}
          </div>

          {/* Pair grid */}
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "#374151",
              textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)",
              paddingBottom: 8, marginBottom: 14,
            }}>
              Pair Status
            </div>

            {isLoading && (
              <div style={{ textAlign: "center", padding: "30px 0", color: "#374151", fontSize: 11 }}>
                Loading…
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 8 }}>
              {sortedPairs.map((pair: any) => {
                const color = STATUS_COLOR[pair.status] ?? "#374151";
                const isReady = pair.status === "READY";
                const hasExh  = isReady && pair.exhaustion_signal;
                return (
                  <div key={pair.symbol} style={{
                    background: hasExh ? "rgba(251,146,60,0.05)" : isReady ? "rgba(38,166,154,0.05)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${hasExh ? "rgba(251,146,60,0.22)" : isReady ? "rgba(38,166,154,0.18)" : "rgba(255,255,255,0.05)"}`,
                    borderRadius: 8, padding: "10px 14px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* Status dot */}
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                        background: color,
                        boxShadow: isReady ? `0 0 6px ${color}` : "none",
                      }} />

                      {/* Pair name */}
                      <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 13, fontFamily: "monospace", width: 70, flexShrink: 0 }}>
                        {pair.symbol?.replace("/", "")}
                      </span>

                      {/* Status badge */}
                      <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: "0.1em" }}>
                        {pair.status}
                      </span>

                      {isReady ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: pair.direction === "BUY" ? "#26a69a" : "#ef5350" }}>
                            {pair.direction}
                          </span>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>E: {fmt(pair.entry)}</span>
                          <span style={{ fontSize: 10, color: "#64748b" }}>SL: {fmt(pair.sl)}</span>
                          <span style={{ fontSize: 10, color: "#64748b" }}>TP: {fmt(pair.tp)}</span>
                          <span style={{ fontSize: 10, color: "#475569" }}>R:R {pair.rr}</span>
                          {hasExh && (
                            <span style={{ fontSize: 10, color: "#fb923c", fontWeight: 700 }}>⚡{pair.exhaustion_score}</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {pair.reason
                            ?.replace(/D1 (bullish|bearish) ✓\s*/g, "")
                            .replace(/D1 (bullish|bearish)\s*/g, "")}
                        </span>
                      )}
                    </div>

                    {/* Exhaustion detail */}
                    {hasExh && pair.exhaustion_detail && (
                      <div style={{ marginTop: 5, paddingLeft: 17, fontSize: 9, color: "rgba(251,146,60,0.5)" }}>
                        {pair.exhaustion_detail}
                      </div>
                    )}

                    {/* Entry source */}
                    {isReady && pair.entry_source && (
                      <div style={{ marginTop: 3, paddingLeft: 17, fontSize: 9, color: "#374151" }}>
                        via {pair.entry_source}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Placeholder rows for pairs not yet in state */}
              {!isLoading && PAIRS.filter(p => !Object.values(pairs).some((s: any) => s.symbol === p)).map(p => (
                <div key={p} style={{
                  background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)",
                  borderRadius: 8, padding: "10px 14px",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#1f2937" }} />
                  <span style={{ color: "#1f2937", fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>
                    {p.replace("/", "")}
                  </span>
                  <span style={{ fontSize: 9, color: "#1f2937" }}>waiting for engine</span>
                </div>
              ))}
            </div>
          </div>

          {/* Signal log */}
          {log.length > 0 && (
            <div>
              <button
                onClick={() => setShowLog(v => !v)}
                style={{
                  width: "100%", textAlign: "left", background: "none", border: "none",
                  cursor: "pointer", padding: "0 0 8px 0",
                  fontSize: 9, fontWeight: 700, color: "#374151", letterSpacing: "0.18em",
                  textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)",
                  marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
              >
                <span>Signal Log ({log.length})</span>
                <span>{showLog ? "▲ hide" : "▼ show"}</span>
              </button>

              {showLog && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {log.map((entry: any, i: number) => {
                    const isBuy = entry.direction === "BUY";
                    const c = isBuy ? "#26a69a" : "#ef5350";
                    return (
                      <div key={i} style={{
                        background: `${c}08`, border: `1px solid ${c}22`,
                        borderRadius: 8, padding: "10px 14px",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ color: c, fontSize: 12, fontWeight: 700 }}>{entry.direction}</span>
                          <span style={{ color: "#e2e8f0", fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>
                            {entry.symbol?.replace("/", "")}
                          </span>
                          <span style={{ fontSize: 10, color: "#475569" }}>{entry.paper_mode ? "PAPER" : "LIVE"}</span>
                          {entry.exhaustion_signal && (
                            <span style={{ fontSize: 10, color: "#fb923c", fontWeight: 700 }}>⚡{entry.exhaustion_score}</span>
                          )}
                          <span style={{ marginLeft: "auto", fontSize: 10, color: "#374151" }}>{timeAgo(entry.fired_at)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 20, marginTop: 6, fontSize: 10, color: "#475569" }}>
                          <span>Entry: {fmt(entry.entry)}</span>
                          <span>SL: {fmt(entry.sl)}</span>
                          <span>TP: {fmt(entry.tp)}</span>
                          <span>R:R {entry.rr}</span>
                          {entry.entry_source && <span>via {entry.entry_source}</span>}
                        </div>
                        {entry.exhaustion_detail && entry.exhaustion_detail !== "none" && (
                          <div style={{ marginTop: 4, fontSize: 9, color: "rgba(251,146,60,0.45)" }}>
                            {entry.exhaustion_detail}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </LoginGate>
  );
}

export default AutoTradePage;