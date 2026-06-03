/**
 * AnalysisPage — full-width readable view of Market Narrative + Market Environment.
 * Accessible at /analysis (opens in a new tab from the TopBar).
 * Symbol switcher at top — left panel = narrative, right panel = environment.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { FrameworkPanel } from "@/components/FrameworkPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Condition { label: string; met: boolean }
interface TradeReadiness {
  ready: boolean;
  direction: "long" | "short" | null;
  summary: string;
  action: string;
  conditions: Condition[];
  met: number;
  total: number;
}
interface KeyLevel {
  price: number;
  label?: string;
  timeframe?: string;
  pips_away: number;
  source: string;
  range?: [number, number];
}
interface Narrative {
  symbol: string;
  price: number;
  condition: string;
  condition_detail: string;
  structure: string[];
  key_levels: { resistance: KeyLevel[]; support: KeyLevel[] };
  session: string[];
  trade_readiness: TradeReadiness;
  confidence: {
    market_clarity: "High" | "Medium" | "Low";
    structure_quality: "High" | "Medium" | "Low";
    signal_confidence: number;
  };
  news: { blocked: boolean; reason: string };
  generated_at: number;
  broker_time?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAIRS = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"];

const CONDITION_COLORS: Record<string, string> = {
  "Bullish Trend":    "#26a69a",
  "Bullish Pullback": "#4ade80",
  "Bullish Bias":     "#4ade80",
  "Bearish Trend":    "#ef5350",
  "Bearish Pullback": "#f87171",
  "Bearish Bias":     "#f87171",
  "Expansion":        "#f59e0b",
  "Distribution":     "#fb923c",
  "Accumulation":     "#a78bfa",
  "Range":            "#94a3b8",
  "Consolidation":    "#475569",
};



// ── Helpers ───────────────────────────────────────────────────────────────────

function cc(label: string) { return CONDITION_COLORS[label] ?? "#64748b"; }
function qc(q: "High" | "Medium" | "Low") {
  return q === "High" ? "#4ade80" : q === "Medium" ? "#fbbf24" : "#475569";
}
function fmt(p: number, ref: number) { return p.toFixed(ref >= 10 ? 3 : 5); }

// ── Session countdown (same DST logic as MarketNarrative) ─────────────────────

function sessionStatus(brokerTime?: number) {
  const now  = brokerTime ? new Date(brokerTime * 1000) : new Date();
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
  const condColor = n ? cc(n.condition) : "#64748b";
  const pct = n ? (n.trade_readiness.met / n.trade_readiness.total) * 100 : 0;
  const barColor = pct >= 100 ? "#4ade80" : pct >= 60 ? "#fbbf24" : "#ef5350";
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
          {n && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: `${condColor}18`, border: `1px solid ${condColor}55`,
              borderRadius: 5, padding: "3px 10px",
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: condColor, boxShadow: `0 0 7px 2px ${condColor}88`, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: condColor, letterSpacing: "0.05em" }}>{n.condition}</span>
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
          {n.news.blocked && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: "#ef535018", border: "1px solid #ef535050",
              borderRadius: 6, padding: "8px 12px", marginBottom: 14,
            }}>
              <AlertTriangle size={14} style={{ color: "#ef5350", flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#ef5350", letterSpacing: "0.05em" }}>NEWS BLOCK ACTIVE</div>
                <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 3, lineHeight: 1.6 }}>{n.news.reason}</div>
              </div>
            </div>
          )}

          {/* Condition sentence */}
          <div style={{
            fontSize: 13, color: "#64748b", lineHeight: 1.75,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            paddingBottom: 12, marginBottom: 14,
          }}>
            {n.condition_detail}
          </div>

          {/* Structure */}
          <Section label="Structure Summary">
            {n.structure.map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{line}</div>
            ))}
          </Section>

          {/* Key levels */}
          {(n.key_levels.resistance.length > 0 || n.key_levels.support.length > 0) && (
            <Section label="Key Levels">
              {n.key_levels.resistance.map((lvl, i) => <LevelRow key={`r${i}`} level={lvl} kind="res" ref_={n.price} />)}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                margin: "6px 0", padding: "4px 0",
                borderTop: "1px dashed rgba(255,255,255,0.07)",
                borderBottom: "1px dashed rgba(255,255,255,0.07)",
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>{fmt(n.price, n.price)}</span>
                <span style={{ fontSize: 11, color: "#374151" }}>current price</span>
              </div>
              {n.key_levels.support.map((lvl, i) => <LevelRow key={`s${i}`} level={lvl} kind="sup" ref_={n.price} />)}
            </Section>
          )}

          {/* Session */}
          <Section label="Session Context">
            <div style={{ fontSize: 13, color: "#4ade80", lineHeight: 1.7, marginBottom: 4 }}>{sessionLine}</div>
            {n.session.map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{line}</div>
            ))}
          </Section>

          {/* Trade readiness */}
          <Section label="Trade Readiness">
            {n.trade_readiness.direction && (
              <div style={{
                fontSize: 14, fontWeight: 700, letterSpacing: "0.05em",
                color: n.trade_readiness.direction === "long" ? "#26a69a" : "#ef5350",
                marginBottom: 8,
              }}>
                {n.trade_readiness.direction === "long" ? "▲ LONG BIAS" : "▼ SHORT BIAS"}
              </div>
            )}
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginBottom: 10 }}>
              {n.trade_readiness.summary}
            </div>
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 6, padding: "10px 14px", marginBottom: 10,
            }}>
              {n.trade_readiness.conditions.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: c.met ? "#4ade80" : "#374151", flexShrink: 0, lineHeight: 1 }}>
                    {c.met ? "✓" : "○"}
                  </span>
                  <span style={{ fontSize: 13, color: c.met ? "#94a3b8" : "#374151", lineHeight: 1.6 }}>
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
            {/* Progress bar */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "#374151" }}>{n.trade_readiness.met} of {n.trade_readiness.total} conditions</span>
                <span style={{ fontSize: 11, color: barColor }}>
                  {pct >= 100 ? "Ready" : pct >= 60 ? "Developing" : "Waiting"}
                </span>
              </div>
              <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                <div style={{
                  height: "100%", width: `${pct}%`, background: barColor,
                  borderRadius: 2, transition: "width 0.7s ease",
                  boxShadow: `0 0 8px ${barColor}88`,
                }} />
              </div>
            </div>
            <div style={{
              fontSize: 13, lineHeight: 1.7,
              color: n.trade_readiness.ready ? "#4ade80" : "#374151",
              borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8,
            }}>
              {n.trade_readiness.action}
            </div>
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

function LevelRow({ level, kind, ref_ }: { level: KeyLevel; kind: "res" | "sup"; ref_: number }) {
  const color = kind === "res" ? "#fbbf24" : "#a78bfa";
  const isMajor = level.label === "Major";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 3, height: 16, background: color, borderRadius: 1, opacity: isMajor ? 1 : 0.45 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color, letterSpacing: "0.04em" }}>
          {fmt(level.price, ref_)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isMajor && (
          <span style={{
            fontSize: 9, fontWeight: 700, color,
            background: `${color}22`, borderRadius: 3, padding: "2px 5px", letterSpacing: "0.1em",
          }}>MAJOR</span>
        )}
        {level.timeframe && <span style={{ fontSize: 10, color: "#374151" }}>{level.timeframe}</span>}
        <span style={{ fontSize: 11, color: "#374151" }}>{level.pips_away}p</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AnalysisPage() {
  const [symbol, setSymbol] = useState("USD/JPY");

  return (
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
  );
}

export default AnalysisPage;