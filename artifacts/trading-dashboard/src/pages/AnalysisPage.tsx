/**
 * AnalysisPage — full-width readable view of Market Narrative + Market Environment.
 * Accessible at /analysis (opens in a new tab from the TopBar).
 * Symbol switcher at top — left panel = narrative, right panel = environment.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { FrameworkPanel } from "@/components/FrameworkPanel";
import { LoginGate } from "@/components/LoginGate";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TradingStyle {
  style: string;
  direction: "long" | "short" | null;
  reason: string;
}
interface Narrative {
  symbol:    string;
  price:     number;
  bias:      { d1: string; h4: string; h1: string; m15: string };
  structure: string[];
  session:   string[];
  swing_context:    { leg_pips?: number; retrace_pct?: number; in_window?: boolean; description?: string };
  trading_styles:   { best: TradingStyle[]; multiple_confirmed: boolean; summary: string };
  trend_exhaustion: { active: boolean; notes: string[] };
  confidence: { market_clarity: "High"|"Medium"|"Low"; structure_quality: "High"|"Medium"|"Low"; signal_confidence: number };
  news:        { blocked: boolean; reason: string };
  generated_at: number;
  broker_time?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAIRS = [
  "USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY", "GBP/JPY",
  "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "AUD/JPY", "CAD/JPY"
];



// ── Helpers ───────────────────────────────────────────────────────────────────


function qc(q: "High" | "Medium" | "Low") {
  return q === "High" ? "#4ade80" : q === "Medium" ? "#fbbf24" : "#475569";
}
function fmt(p: number, ref: number) { return p.toFixed(ref > 50 ? 3 : 5); }

// ── Session countdown (same DST logic as MarketNarrative) ─────────────────────

function sessionStatus(brokerTime?: number) {
  if (!brokerTime) return "Session info unavailable — bridge offline";
  const now = new Date(brokerTime * 1000);
  const mid  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const lonOff = (() => { try { const m = mid.toLocaleString("en", { timeZone: "Europe/London",    timeZoneName: "shortOffset" }).match(/([+-])(\d+)/); return m ? (m[1] === "+" ? 1 : -1) * parseInt(m[2]) : 0;  } catch { return 0;  } })();
  const nyOff  = (() => { try { const m = mid.toLocaleString("en", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).match(/([+-])(\d+)/); return m ? (m[1] === "+" ? 1 : -1) * parseInt(m[2]) : -5; } catch { return -5; } })();
  const sessions = [
    { name: "London", open: 8  + lonOff, close: 17 + lonOff },
    { name: "NY",     open: 13 + nyOff,  close: 22 + nyOff  },
    { name: "Asian",  open: 0,           close: 9            },
  ];
  const total = now.getUTCHours() * 60 + now.getUTCMinutes();
  for (const s of sessions) {
    const o = s.open * 60, c = s.close * 60;
    if (total >= o && total < c) {
      const rem = c - total;
      return `${s.name} session active · closes in ${Math.floor(rem / 60)}h ${rem % 60}m`;
    }
  }
  const nexts = sessions.map(s => { let d = s.open * 60 - total; if (d <= 0) d += 1440; return { name: s.name, d }; }).sort((a, b) => a.d - b.d);
  const n = nexts[0];
  return `No prime session · ${n.name} opens in ${Math.floor(n.d / 60)}h ${n.d % 60}m`;
}

// ── Environment panel ─────────────────────────────────────────────────────────



// ── Narrative panel ───────────────────────────────────────────────────────────

function NarrativePanel({ symbol }: { symbol: string }) {
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetch_ = useCallback(async (sym: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/trading-api/narrative?symbol=${encodeURIComponent(sym)}`, { signal: abortRef.current.signal });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setNarrative(await res.json());
      setFetchedAt(Date.now());
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message ?? "Failed");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { setNarrative(null); fetch_(symbol); }, [symbol, fetch_]);
  useEffect(() => { const id = setInterval(() => fetch_(symbol), 30_000); return () => clearInterval(id); }, [symbol, fetch_]);

  const n = narrative;
  const primaryStyle = n?.trading_styles?.best?.[0] ?? null;
  const psColor = primaryStyle?.direction === "long" ? "#26a69a" : primaryStyle?.direction === "short" ? "#ef5350" : "#94a3b8";
  const sessionLine = n ? sessionStatus(n.broker_time) : "";

  return (
    <div style={{
      background: "rgba(10,14,23,0.97)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 10, padding: "18px 22px",
      fontFamily: "'Roboto Mono', monospace",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "#475569", textTransform: "uppercase" }}>
            Market Narrative
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
            {symbol.replace("/", "")}
          </span>
           {primaryStyle && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: `${psColor}18`, border: `1px solid ${psColor}55`,
              borderRadius: 5, padding: "3px 10px",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: psColor, letterSpacing: "0.05em" }}>
                {primaryStyle.direction === "long" ? "▲ " : primaryStyle.direction === "short" ? "▼ " : ""}{primaryStyle.style}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {fetchedAt > 0 && !loading && (
            <span style={{ fontSize: 10, color: "#374151" }}>
              {Math.floor((Date.now() - fetchedAt) / 1000)}s ago
            </span>
          )}
          {loading && <RefreshCw size={12} style={{ color: "#475569", animation: "spin 1s linear infinite" }} />}
          <button onClick={() => fetch_(symbol)} title="Refresh" style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 5, padding: "4px 8px", cursor: "pointer", color: "#475569",
            display: "flex", alignItems: "center",
          }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#ef5350", fontSize: 13, marginBottom: 12 }}>
          <AlertTriangle size={14} /> {error} — check API connection
        </div>
      )}

      {loading && !n && (
        <div style={{ color: "#374151", fontSize: 13 }}>Loading narrative…</div>
      )}

      {n && (
        <>
          {/* News block */}
          {n.news?.blocked && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: "#ef535018", border: "1px solid #ef535050",
              borderRadius: 6, padding: "8px 12px", marginBottom: 14,
            }}>
              <AlertTriangle size={14} style={{ color: "#ef5350", flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ef5350", letterSpacing: "0.05em" }}>NEWS BLOCK ACTIVE</div>
                <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 3, lineHeight: 1.6 }}>{n.news?.reason}</div>
              </div>
            </div>
          )}

          {/* Bias row */}
          {n.bias && (
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {(["d1","h4","h1","m15"] as const).map(tf => {
                const val = (n.bias as any)[tf] as string;
                const color = val === "bullish" ? "#26a69a" : val === "bearish" ? "#ef5350" : "#374151";
                return (
                  <div key={tf} style={{
                    flex: 1, textAlign: "center", padding: "6px 0",
                    background: `${color}12`, border: `1px solid ${color}40`, borderRadius: 5,
                  }}>
                    <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.1em", marginBottom: 2 }}>{tf.toUpperCase()}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color }}>{val.toUpperCase()}</div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Structure */}
          <Section label="Structure Summary">
            {(n.structure ?? []).map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{line}</div>
            ))}
          </Section>

          

          {/* Session */}
          <Section label="Session Context">
            <div style={{ fontSize: 13, color:sessionLine.startsWith("No prime") ? "#f59e0b" : "#4ade80", lineHeight: 1.7, marginBottom: 4 }}>{sessionLine}</div>
            {(n.session ?? []).map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{line}</div>
            ))}
          </Section>

          {/* Swing Context */}
          {n.swing_context?.description && (
            <Section label="Swing Context">
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginBottom: 8 }}>
                {n.swing_context.description}
              </div>
              {n.swing_context.retrace_pct !== undefined && (
                <>
                  <div style={{ fontSize: 11, color: "#374151", marginBottom: 4 }}>
                    {n.swing_context.retrace_pct}% retrace{n.swing_context.in_window ? " — in structural pullback zone ✓" : ""}
                  </div>
                  <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, n.swing_context.retrace_pct)}%`,
                      background: n.swing_context.in_window ? "#26a69a" : "#f59e0b",
                      borderRadius: 2, transition: "width 0.7s ease",
                    }} />
                  </div>
                </>
              )}
            </Section>
          )}

          {/* Trading Styles */}
          <Section label="Trading Style">
            {(!n.trading_styles?.best || n.trading_styles.best.length === 0) ? (
              <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
                No style confirmed — structure unclear or conditions quiet. Stand aside.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>{n.trading_styles.summary}</div>
                {n.trading_styles.best.map((s, i) => {
                  const isEx = s.style === "Trend Exhaustion";
                  const dc = s.direction === "long" ? "#26a69a" : s.direction === "short" ? "#ef5350" : "#94a3b8";
                  return (
                    <div key={i} style={{
                      background: isEx ? "rgba(239,83,80,0.07)" : "rgba(255,255,255,0.02)",
                      border: isEx ? "1px solid rgba(239,83,80,0.3)" : "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 6, padding: "10px 12px", marginBottom: 8,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isEx ? "#ef5350" : dc, marginBottom: 5 }}>
                        {isEx ? "⚠ TREND EXHAUSTION" : `${s.direction === "long" ? "▲" : s.direction === "short" ? "▼" : "◆"} ${s.style.toUpperCase()}`}
                      </div>
                      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>{s.reason}</div>
                    </div>
                  );
                })}
              </>
            )}
          </Section>

          {/* Confidence tiles */}
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 14 }}>
            {[
              { label: "CLARITY",   value: n.confidence.market_clarity,   q: n.confidence.market_clarity },
              { label: "STRUCTURE", value: n.confidence.structure_quality, q: n.confidence.structure_quality },
              {
                label: "SIGNAL",
                value: `${n.confidence.signal_confidence}%`,
                q: (n.confidence.signal_confidence >= 70 ? "High" : n.confidence.signal_confidence >= 40 ? "Medium" : "Low") as "High" | "Medium" | "Low",
              },
            ].map(({ label, value, q }) => (
              <div key={label} style={{
                flex: 1, background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 6, padding: "8px 0", textAlign: "center",
              }}>
                <div style={{ fontSize: 9, color: "#374151", letterSpacing: "0.12em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: qc(q as "High" | "Medium" | "Low") }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "#374151",
        textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)",
        paddingBottom: 5, marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}



// ── Main page ─────────────────────────────────────────────────────────────────

export function AnalysisPage() {
  const [symbol, setSymbol] = useState("USD/JPY");

  return (
    <LoginGate>
    <div style={{
      minHeight: "100vh", background: "#0a0e17", color: "white",
      fontFamily: "'Roboto Mono', monospace",
    }}>
      {/* Top bar */}
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
            Analysis View
          </span>
        </div>
        

        {/* Symbol switcher */}
        <div style={{ display: "flex", gap: 6 }}>
          {PAIRS.map(pair => {
            const display = pair.replace("/", "");
            const active = pair === symbol;
            return (
              <button key={pair} onClick={() => setSymbol(pair)} style={{
                padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                fontFamily: "monospace", cursor: "pointer", transition: "all 0.15s",
                background: active ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
                border: active ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
                color: active ? "#93c5fd" : "#6b7280",
              }}>
                {display}
              </button>
            );
          })}
        </div>

        <a href="/" style={{ fontSize: 11, color: "#374151", textDecoration: "none" }}>
          ← Back to chart
        </a>
      </div>

      {/* Body — 2 columns */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 420px", gap: 16,
        padding: 20, maxWidth: 1400, margin: "0 auto",
      }}>
        {/* Left: Narrative */}
        <NarrativePanel symbol={symbol} />

        {/* Right: Environment */}
        <FrameworkPanel symbol={symbol} />
      </div>
    </div>
    </LoginGate>
  );
}

export default AnalysisPage;