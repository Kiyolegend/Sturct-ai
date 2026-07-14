/**
 * DataCollectPage — manage historical data collection.
 * Route: /collect  (opens in new tab from TopBar)
 *
 * Shows:
 *   - Current DB bar counts per symbol × timeframe
 *   - "Refresh History" button (--refresh, fast: only missing bars)
 *   - "Full Collection" button (all history, slow — use rarely)
 *   - Live log output while the script is running
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { LoginGate } from "@/components/LoginGate";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatRow {
  symbol: string;
  timeframe: string;
  bars: number;
  first_ts: number | null;
  last_ts: number | null;
}

interface CollectStatus {
  running: boolean;
  mode: "refresh" | "full" | null;
  done: boolean;
  error: string | null;
  log: string[];
  started_at: number | null;
  finished_at: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SYMBOLS = [
  "USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY", "GBP/JPY",
  "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "AUD/JPY", "CAD/JPY",
];
const TIMEFRAMES = ["5m", "15m", "1h", "4h", "d1"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function fmtBars(n: number | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function elapsed(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt) return "";
  const end = finishedAt ?? Date.now() / 1000;
  const secs = Math.round(end - startedAt);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// ── Stats table ───────────────────────────────────────────────────────────────

function StatsTable({ stats }: { stats: StatRow[] }) {
  const map: Record<string, Record<string, StatRow>> = {};
  for (const row of stats) {
    if (!map[row.symbol]) map[row.symbol] = {};
    map[row.symbol][row.timeframe] = row;
  }

  const colW = "1fr";

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `130px repeat(${TIMEFRAMES.length}, ${colW}) 110px`,
        gap: 4,
        padding: "4px 10px",
        marginBottom: 4,
      }}>
        <div />
        {TIMEFRAMES.map(tf => (
          <div key={tf} style={{
            fontSize: 9, fontWeight: 700, color: "#374151",
            letterSpacing: "0.14em", textAlign: "center", textTransform: "uppercase",
          }}>{tf}</div>
        ))}
        <div style={{
          fontSize: 9, fontWeight: 700, color: "#374151",
          letterSpacing: "0.14em", textAlign: "center", textTransform: "uppercase",
        }}>Last Update</div>
      </div>

      {/* Data rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {SYMBOLS.map(sym => {
          const row = map[sym] ?? {};
          const last5m = row["5m"]?.last_ts ?? null;
          const hasData = Object.keys(row).length > 0;
          return (
            <div key={sym} style={{
              display: "grid",
              gridTemplateColumns: `130px repeat(${TIMEFRAMES.length}, ${colW}) 110px`,
              gap: 4,
              alignItems: "center",
              padding: "8px 10px",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 6,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
                {sym.replace("/", "")}
              </div>
              {TIMEFRAMES.map(tf => {
                const cell = row[tf];
                const ok = cell && cell.bars > 0;
                return (
                  <div key={tf} style={{ textAlign: "center" }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600,
                      color: ok ? "#34d399" : "#374151",
                    }}>
                      {cell ? fmtBars(cell.bars) : "—"}
                    </div>
                  </div>
                );
              })}
              <div style={{
                fontSize: 10, color: hasData ? "#94a3b8" : "#374151",
                textAlign: "center", fontFamily: "monospace",
              }}>
                {fmtDate(last5m)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function LogViewer({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div style={{
      background: "#060a12",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 8,
      padding: "12px 14px",
      maxHeight: 340,
      overflowY: "auto",
      fontFamily: "'Roboto Mono', 'Courier New', monospace",
      fontSize: 11,
      lineHeight: 1.6,
    }}>
      {lines.map((line, i) => {
        const isErr  = line.includes("ERROR") || line.includes("WARNING");
        const isOk   = line.startsWith("OK") || line.includes("stored") || line.includes("Done");
        const color  = isErr ? "#ef5350" : isOk ? "#34d399" : "#94a3b8";
        return (
          <div key={i} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {line || "\u00a0"}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DataCollectPage() {
  const [stats, setStats]       = useState<StatRow[]>([]);
  const [status, setStatus]     = useState<CollectStatus | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [confirmFull, setConfirmFull]   = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch DB stats ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/trading-api/collect/stats");
      if (!res.ok) return;
      const data = await res.json();
      setStats(data.stats ?? []);
    } catch { /* server may be offline */ }
    finally { setLoadingStats(false); }
  }, []);

  // ── Poll job status ─────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/trading-api/collect/status");
      if (!res.ok) return;
      const data: CollectStatus = await res.json();
      setStatus(data);
      if (!data.running && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        if (data.done) fetchStats();
      }
    } catch { /* ignore */ }
  }, [fetchStats]);

  // ── On mount: load stats + current status ──────────────────────────────────
  useEffect(() => {
    fetchStats();
    fetchStatus();
  }, [fetchStats, fetchStatus]);

  // ── Start polling when a job is running ────────────────────────────────────
  useEffect(() => {
    if (status?.running && !pollRef.current) {
      pollRef.current = setInterval(fetchStatus, 1500);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [status?.running, fetchStatus]);

  // ── Trigger collect ────────────────────────────────────────────────────────
  const startCollect = async (mode: "refresh" | "full") => {
    setConfirmFull(false);
    try {
      const res = await fetch(`/trading-api/collect/${mode}`, { method: "POST" });
      if (!res.ok) { alert(`Failed to start: HTTP ${res.status}`); return; }
      await fetchStatus();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchStatus, 1500);
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  const isRunning = status?.running ?? false;
  const isDone    = status?.done && !isRunning;
  const hasError  = !!status?.error;

  return (
    <LoginGate>
      <div style={{
        minHeight: "100vh",
        background: "#0a0e17",
        color: "white",
        fontFamily: "'Roboto Mono', monospace",
      }}>

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div style={{
          height: 56,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 24px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,14,23,0.98)",
          position: "sticky", top: 0, zIndex: 50,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "white" }}>
              STRUCT<span style={{ color: "#3b82f6" }}>.ai</span>
            </span>
            <span style={{
              fontSize: 10, color: "#374151",
              letterSpacing: "0.14em", textTransform: "uppercase",
            }}>
              Data Collection · 11 Pairs · 5 Timeframes
            </span>
          </div>
          <a href="/" style={{ fontSize: 11, color: "#374151", textDecoration: "none" }}>
            ← Back to chart
          </a>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: "24px 20px", maxWidth: 960, margin: "0 auto" }}>

          {/* ── Control panel ──────────────────────────────────────────────── */}
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "20px 22px",
            marginBottom: 24,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
              color: "#374151", textTransform: "uppercase",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              paddingBottom: 10, marginBottom: 16,
            }}>
              Data Collection Controls
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>

              {/* Refresh History button */}
              <div>
                <button
                  disabled={isRunning}
                  onClick={() => startCollect("refresh")}
                  style={{
                    padding: "10px 22px",
                    background: isRunning ? "rgba(52,211,153,0.05)" : "rgba(52,211,153,0.12)",
                    border: `1px solid ${isRunning ? "rgba(52,211,153,0.15)" : "rgba(52,211,153,0.4)"}`,
                    borderRadius: 7,
                    color: isRunning ? "#1f4f3a" : "#34d399",
                    fontFamily: "'Roboto Mono', monospace",
                    fontSize: 12, fontWeight: 700,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    cursor: isRunning ? "not-allowed" : "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {isRunning && status?.mode === "refresh" ? "⟳  Collecting…" : "⟳  Refresh History"}
                </button>
                <div style={{ fontSize: 9, color: "#374151", marginTop: 5, paddingLeft: 2 }}>
                  Fast (~30s) — only missing bars since last run
                </div>
              </div>

              {/* Full Collection button (with confirm) */}
              <div>
                {!confirmFull ? (
                  <button
                    disabled={isRunning}
                    onClick={() => setConfirmFull(true)}
                    style={{
                      padding: "10px 22px",
                      background: isRunning ? "rgba(251,191,36,0.04)" : "rgba(251,191,36,0.08)",
                      border: `1px solid ${isRunning ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.3)"}`,
                      borderRadius: 7,
                      color: isRunning ? "#4a3a10" : "#fbbf24",
                      fontFamily: "'Roboto Mono', monospace",
                      fontSize: 12, fontWeight: 700,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      cursor: isRunning ? "not-allowed" : "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    ◈  Full Collection
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#fbbf24" }}>Slow (~5 min). Sure?</span>
                    <button
                      onClick={() => startCollect("full")}
                      style={{
                        padding: "6px 14px", background: "rgba(251,191,36,0.15)",
                        border: "1px solid rgba(251,191,36,0.4)",
                        borderRadius: 5, color: "#fbbf24",
                        fontFamily: "'Roboto Mono', monospace", fontSize: 11, fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >Yes</button>
                    <button
                      onClick={() => setConfirmFull(false)}
                      style={{
                        padding: "6px 14px", background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 5, color: "#94a3b8",
                        fontFamily: "'Roboto Mono', monospace", fontSize: 11,
                        cursor: "pointer",
                      }}
                    >Cancel</button>
                  </div>
                )}
                <div style={{ fontSize: 9, color: "#374151", marginTop: 5, paddingLeft: 2 }}>
                  Slow (~5 min) — re-fetches all history from MT5
                </div>
              </div>
            </div>

            {/* ── Status strip ─────────────────────────────────────────────── */}
            {status && (
              <div style={{
                marginTop: 16,
                padding: "10px 14px",
                borderRadius: 6,
                background: isRunning ? "rgba(59,130,246,0.06)"
                  : hasError ? "rgba(239,83,80,0.06)"
                  : isDone ? "rgba(52,211,153,0.06)"
                  : "transparent",
                border: isRunning ? "1px solid rgba(59,130,246,0.2)"
                  : hasError ? "1px solid rgba(239,83,80,0.2)"
                  : isDone ? "1px solid rgba(52,211,153,0.15)"
                  : "none",
                display: "flex", alignItems: "center", gap: 14,
              }}>
                {isRunning && (
                  <span style={{ fontSize: 14, animation: "spin 1s linear infinite" }}>⟳</span>
                )}
                <div>
                  <div style={{
                    fontSize: 11, fontWeight: 700,
                    color: isRunning ? "#60a5fa"
                      : hasError ? "#ef5350"
                      : isDone ? "#34d399"
                      : "#94a3b8",
                  }}>
                    {isRunning
                      ? `Running ${status.mode === "refresh" ? "refresh" : "full collection"}…`
                      : hasError ? `Failed: ${status.error}`
                      : isDone ? `Completed (${status.mode}) — cache cleared, analysis will recompute`
                      : "Idle"}
                  </div>
                  {(isRunning || isDone || hasError) && status.started_at && (
                    <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                      {elapsed(status.started_at, status.finished_at)} elapsed
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Live log ───────────────────────────────────────────────────── */}
          {status && status.log.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
                color: "#374151", textTransform: "uppercase",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                paddingBottom: 8, marginBottom: 12,
              }}>
                Collection Log
              </div>
              <LogViewer lines={status.log} />
            </div>
          )}

          {/* ── DB Stats table ─────────────────────────────────────────────── */}
          <div>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              paddingBottom: 8, marginBottom: 14,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.18em",
                color: "#374151", textTransform: "uppercase",
              }}>
                Database — Current Bar Counts
              </div>
              <button
                onClick={fetchStats}
                style={{
                  fontSize: 9, color: "#374151", background: "none",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 4, padding: "3px 8px",
                  cursor: "pointer", fontFamily: "'Roboto Mono', monospace",
                  letterSpacing: "0.1em",
                }}
              >
                ↻ Refresh
              </button>
            </div>

            {loadingStats ? (
              <div style={{ textAlign: "center", padding: "30px 0", color: "#1f2937", fontSize: 11 }}>
                Loading database stats…
              </div>
            ) : stats.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", color: "#ef5350", fontSize: 11 }}>
                No data in database. Run "Refresh History" or "Full Collection" to populate.
              </div>
            ) : (
              <StatsTable stats={stats} />
            )}
          </div>

        </div>
      </div>

      {/* spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </LoginGate>
  );
}

export default DataCollectPage;