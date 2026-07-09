/**
 * MarketNarrative — plain-English market commentary panel.
 *
 * Replaces TradeTeller's raw signal codes (S1/BOS/FVG) with analyst-style narrative:
 *   • Market Condition  (Bullish Pullback / Range / Expansion …)
 *   • Framework Status  (SCALP READY / LIMIT READY if live)
 *   • Structure Summary (4H → 1H → 15M in plain English)
 *   • Swing Context     (where am I in the 4H move? retrace %)
 *   • Key Levels        (nearest resistance & support with pip distance)
 *   • Strongest Level   (the one level that matters most right now)
 *   • Session Context   (what to expect right now)
 *   • Trade Readiness   (5-condition checklist, progress bar, action line)
 *   • Watch For         (plain English: exactly what to wait for before acting)
 *   • Confidence        (market clarity / structure quality / signal %)
 *
 * Data source: GET /trading-api/narrative?symbol=X
 *   • Auto-refreshes every 30 s
 *   • Instantly re-fetches when `refreshTrigger` changes (WebSocket candle event)
 *   • Switches immediately when `symbol` prop changes
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { ChevronUp, Minus, RefreshCw, AlertTriangle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Condition {
  label: string;
  met: boolean;
}

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

interface SwingContext {
  leg_pips: number;
  retrace_pct: number;
  in_window: boolean;
  description: string;
}

interface StrongestLevel {
  price: number;
  kind: string;
  timeframe: string;
  pips_away: number;
  description: string;
  source: string;
  range?: [number, number];
}

interface Framework {
  scalp_ready: boolean;
  limit_ready: boolean;
  scalp_rr: number;
  limit_rr: number;
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
  swing_context?: SwingContext;
  strongest_level?: StrongestLevel;
  watch_for?: string;
  framework?: Framework | null;
  generated_at: number;
  broker_time?: number;
}

// ── Colour maps ───────────────────────────────────────────────────────────────

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

function conditionColor(label: string) {
  return CONDITION_COLORS[label] ?? "#64748b";
}
function qualityColor(q: "High" | "Medium" | "Low") {
  return q === "High" ? "#4ade80" : q === "Medium" ? "#fbbf24" : "#475569";
}
function fmtPrice(p: number, ref: number) {
  return p.toFixed(ref > 50 ? 3 : 5);
}
function secAgo(ts: number, brokerNowSecs?: number) {
  if (!brokerNowSecs) return "—";
  const s = brokerNowSecs - ts;
  if (s < 0) return "just now";
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 7, fontWeight: 700, letterSpacing: "0.18em",
      color: "#1e293b", textTransform: "uppercase",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      paddingBottom: 3, marginBottom: 5,
    }}>
      {children}
    </div>
  );
}

function ConditionBadge({ label }: { label: string }) {
  const c = conditionColor(label);
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: `${c}18`, border: `1px solid ${c}55`,
      borderRadius: 4, padding: "2px 7px",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: c,
        boxShadow: `0 0 5px 1px ${c}88`, flexShrink: 0,
      }} />
      <span style={{ fontSize: 9.5, fontWeight: 700, color: c, letterSpacing: "0.07em" }}>
        {label}
      </span>
    </div>
  );
}

function ReadinessBar({ met, total }: { met: number; total: number }) {
  const pct   = total > 0 ? (met / total) * 100 : 0;
  const color = pct >= 100 ? "#4ade80" : pct >= 60 ? "#fbbf24" : "#ef5350";
  const label = pct >= 100 ? "Ready" : pct >= 60 ? "Developing" : "Waiting";
  return (
    <div style={{ marginTop: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 6.5, color: "#374151" }}>{met} of {total} conditions</span>
        <span style={{ fontSize: 6.5, color }}>{label}</span>
      </div>
      <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 1 }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color,
          borderRadius: 1, transition: "width 0.7s ease",
          boxShadow: `0 0 5px ${color}88`,
        }} />
      </div>
    </div>
  );
}

function CheckRow({ condition }: { condition: Condition }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 5, marginBottom: 3.5 }}>
      <span style={{
        fontSize: 8.5, flexShrink: 0, marginTop: 0.5, lineHeight: 1,
        color: condition.met ? "#4ade80" : "#374151",
      }}>
        {condition.met ? "✓" : "○"}
      </span>
      <span style={{
        fontSize: 7, lineHeight: 1.55,
        color: condition.met ? "#94a3b8" : "#374151",
      }}>
        {condition.label}
      </span>
    </div>
  );
}

function LevelRow({ level, kind, refPrice }: { level: KeyLevel; kind: "res" | "sup"; refPrice: number }) {
  const color   = kind === "res" ? "#fbbf24" : "#a78bfa";
  const isMajor = level.label === "Major";
  const isZone  = level.source === "Zone";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{
          width: 2.5, height: 12, background: color,
          borderRadius: 1, opacity: isMajor ? 1 : 0.45,
        }} />
        <div>
          <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: "0.04em" }}>
            {fmtPrice(level.price, refPrice)}
          </span>
          {isZone && level.range && (
            <span style={{ fontSize: 6, color: "#1f2937", marginLeft: 4 }}>
              [{fmtPrice(level.range[0], refPrice)} – {fmtPrice(level.range[1], refPrice)}]
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {isMajor && (
          <span style={{
            fontSize: 5.5, fontWeight: 700, color,
            background: `${color}22`, borderRadius: 2, padding: "1px 3px",
            letterSpacing: "0.10em",
          }}>MAJOR</span>
        )}
        {level.timeframe && (
          <span style={{ fontSize: 5.5, color: "#475569", letterSpacing: "0.07em" }}>
            {level.timeframe}
          </span>
        )}
        <span style={{ fontSize: 6, color: "#475569" }}>{level.pips_away}p</span>
      </div>
    </div>
  );
}

function SkeletonLine({ width = "100%", h = 6 }: { width?: string; h?: number }) {
  return (
    <div style={{
      width, height: h, background: "rgba(255,255,255,0.04)",
      borderRadius: 2, marginBottom: 5,
      animation: "pulse 1.6s ease-in-out infinite",
    }} />
  );
}

// ── Swing context retrace bar ─────────────────────────────────────────────────

function RetraceBar({ pct, inWindow }: { pct: number; inWindow: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = inWindow ? "#4ade80" : pct > 70 ? "#f59e0b" : "#475569";
  const FIB_LEVELS = [
    { pct: 23.6, label: "23.6" },
    { pct: 38.2, label: "38.2", key: true },
    { pct: 50,   label: "50" },
    { pct: 61.8, label: "61.8", key: true },
    { pct: 78.6, label: "78.6" },
  ];
  return (
    <div style={{ marginTop: 4, marginBottom: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 6, color: "#1f2937" }}>0%</span>
        <span style={{ fontSize: 6, color: inWindow ? "#4ade80" : "#374151", fontWeight: 700 }}>
          {pct}% retrace {inWindow ? "✓ entry window" : ""}
        </span>
        <span style={{ fontSize: 6, color: "#1f2937" }}>100%</span>
      </div>
      <div style={{ position: "relative", height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
        {/* Fibonacci window 38–70% */}
        <div style={{
          position: "absolute", left: "38.2%", width: "23.6%",
          height: "100%", background: "rgba(74,222,128,0.13)",
          borderRadius: 2,
        }} />
        {/* Fibonacci tick marks */}
        {FIB_LEVELS.map(f => (
          <div key={f.pct} style={{
            position: "absolute", left: `${f.pct}%`,
            transform: "translateX(-50%)",
            width: 1, height: "100%",
            background: (f as { key?: boolean }).key
              ? "rgba(74,222,128,0.55)"
              : "rgba(255,255,255,0.18)",
          }} />
        ))}
        {/* Current position dot */}
        <div style={{
          position: "absolute", left: `${clamped}%`,
          transform: "translateX(-50%)",
          width: 4, height: 5, borderRadius: 1,
          background: color, boxShadow: `0 0 5px ${color}`,
          zIndex: 1,
        }} />
      </div>
      {/* Fib level labels below bar */}
      <div style={{ position: "relative", height: 8, marginTop: 1 }}>
        {FIB_LEVELS.map(f => (
          <span key={f.pct} style={{
            position: "absolute", left: `${f.pct}%`,
            transform: "translateX(-50%)",
            fontSize: 5.5,
            color: (f as { key?: boolean }).key ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.2)",
            whiteSpace: "nowrap",
            fontWeight: (f as { key?: boolean }).key ? 700 : 400,
          }}>
            {f.label}
          </span>
        ))}
       </div>
      </div>    
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface MarketNarrativeProps {
  symbol: string;
  refreshTrigger?: number;
}

export function MarketNarrative({ symbol, refreshTrigger }: MarketNarrativeProps) {
  const [narrative,  setNarrative]  = useState<Narrative | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [minimized,  setMinimized]  = useState(false);
  const [fetchedAt,  setFetchedAt]  = useState(0);
  const abortRef    = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNarrative = useCallback(async (sym: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/trading-api/narrative?symbol=${encodeURIComponent(sym)}`,
        { signal: abortRef.current.signal },
      );
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: Narrative = await res.json();
      setNarrative(data);
      setFetchedAt(Date.now());
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNarrative(null);
    fetchNarrative(symbol);
  }, [symbol, fetchNarrative]);

  useEffect(() => {
    if (!refreshTrigger) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchNarrative(symbol), 3000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [refreshTrigger, symbol, fetchNarrative]);

  useEffect(() => {
    const id = setInterval(() => fetchNarrative(symbol), 30_000);
    return () => clearInterval(id);
  }, [symbol, fetchNarrative]);

  const n             = narrative;
  const displaySymbol = symbol.replace("/", "");

  return (
    <div style={{
      width: "100%",
      background: "rgba(8,12,20,0.96)",
      border: "1px solid rgba(255,255,255,0.07)",
      fontFamily: "'Roboto Mono', monospace",
      overflow: "hidden",
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "5px 9px",
        borderBottom: minimized ? "none" : "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: "0.16em",
            color: "#1e293b", textTransform: "uppercase", flexShrink: 0,
          }}>
            Market Narrative
          </span>
          <span style={{ fontSize: 8.5, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
            {displaySymbol}
          </span>
          {n && <ConditionBadge label={n.condition} />}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {fetchedAt > 0 && !loading && (
            <span style={{ fontSize: 6, color: "#1f2937" }}>
              {secAgo(Math.floor(fetchedAt / 1000), Math.floor(Date.now() / 1000))}
            </span>
          )}
          {loading && (
            <RefreshCw size={8} style={{ color: "#374151", animation: "spin 1s linear infinite" }} />
          )}
          <button
            onClick={() => setMinimized(m => !m)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#374151", padding: 2, display: "flex", alignItems: "center",
            }}
          >
            {minimized ? <ChevronUp size={11} /> : <Minus size={11} />}
          </button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {!minimized && (
        <div style={{ padding: "8px 10px" }}>

          {error && !loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, paddingBottom: 6 }}>
              <AlertTriangle size={9} style={{ color: "#ef5350", flexShrink: 0 }} />
              <span style={{ fontSize: 7, color: "#ef5350", lineHeight: 1.5 }}>
                {error} — check API connection
              </span>
            </div>
          )}

          {loading && !n && (
            <>
              <SkeletonLine width="55%" />
              <SkeletonLine width="90%" />
              <SkeletonLine width="75%" />
              <SkeletonLine width="65%" />
            </>
          )}

          {n && (
            <>
              {/* ── News block banner ── */}
              {n.news.blocked && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 5,
                  background: "#ef535014", border: "1px solid #ef535050",
                  borderRadius: 4, padding: "5px 7px", marginBottom: 8,
                }}>
                  <AlertTriangle size={9} style={{ color: "#ef5350", flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 7.5, fontWeight: 700, color: "#ef5350", letterSpacing: "0.06em" }}>
                      NEWS BLOCK ACTIVE
                    </div>
                    <div style={{ fontSize: 6.5, color: "#7f1d1d", marginTop: 1, lineHeight: 1.55 }}>
                      {n.news.reason}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Condition sentence ── */}
              <div style={{
                fontSize: 7.5, color: "#475569", lineHeight: 1.7,
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                paddingBottom: 7, marginBottom: 7,
              }}>
                {n.condition_detail}
              </div>

              {/* ── Framework ready badge ── */}
              {n.framework && (n.framework.scalp_ready || n.framework.limit_ready) && (
                <div style={{
                  display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap",
                }}>
                  {n.framework.scalp_ready && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 4,
                      background: "rgba(74,222,128,0.08)",
                      border: "1px solid rgba(74,222,128,0.3)",
                      borderRadius: 4, padding: "3px 8px",
                    }}>
                      <span style={{ fontSize: 8 }}>⚡</span>
                      <span style={{ fontSize: 7.5, fontWeight: 700, color: "#4ade80", letterSpacing: "0.06em" }}>
                        SCALP READY
                      </span>
                      <span style={{ fontSize: 6.5, color: "#4ade80", opacity: 0.7 }}>
                        R:R {n.framework.scalp_rr}
                      </span>
                    </div>
                  )}
                  {n.framework.limit_ready && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 4,
                      background: "rgba(167,139,250,0.08)",
                      border: "1px solid rgba(167,139,250,0.3)",
                      borderRadius: 4, padding: "3px 8px",
                    }}>
                      <span style={{ fontSize: 8 }}>📍</span>
                      <span style={{ fontSize: 7.5, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.06em" }}>
                        LIMIT READY
                      </span>
                      <span style={{ fontSize: 6.5, color: "#a78bfa", opacity: 0.7 }}>
                        R:R {n.framework.limit_rr}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Structure summary ── */}
              <div style={{ marginBottom: 8 }}>
                <SectionLabel>Structure Summary</SectionLabel>
                {n.structure.map((line, i) => (
                  <div key={i} style={{ fontSize: 7.5, color: "#374151", lineHeight: 1.65 }}>
                    {line}
                  </div>
                ))}
              </div>

              {/* ── Swing context ── */}
              {n.swing_context && n.swing_context.description && (
                <div style={{ marginBottom: 8 }}>
                  <SectionLabel>4H Swing Context</SectionLabel>
                  <div style={{ fontSize: 7.5, color: "#374151", lineHeight: 1.65, marginBottom: 4 }}>
                    {n.swing_context.description}
                  </div>
                  <RetraceBar
                    pct={n.swing_context.retrace_pct}
                    inWindow={n.swing_context.in_window}
                  />
                </div>
              )}

              {/* ── Key levels ── */}
              {(n.key_levels.resistance.length > 0 || n.key_levels.support.length > 0) && (
                <div style={{ marginBottom: 8 }}>
                  <SectionLabel>Key Levels</SectionLabel>

                  {n.key_levels.resistance.map((lvl, i) => (
                    <LevelRow key={`r${i}`} level={lvl} kind="res" refPrice={n.price} />
                  ))}

                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    margin: "3px 0", padding: "2px 0",
                    borderTop: "1px dashed rgba(255,255,255,0.07)",
                    borderBottom: "1px dashed rgba(255,255,255,0.07)",
                  }}>
                    <span style={{ width: 2.5, height: 1, background: "#475569" }} />
                    <span style={{ fontSize: 8, fontWeight: 700, color: "#475569" }}>
                      {fmtPrice(n.price, n.price)}
                    </span>
                    <span style={{ fontSize: 6, color: "#1f2937" }}>current price</span>
                  </div>

                  {n.key_levels.support.map((lvl, i) => (
                    <LevelRow key={`s${i}`} level={lvl} kind="sup" refPrice={n.price} />
                  ))}
                </div>
              )}

              {/* ── Strongest level ── */}
              {n.strongest_level && n.strongest_level.description && (
                <div style={{ marginBottom: 8 }}>
                  <SectionLabel>Level To Watch</SectionLabel>
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 6,
                    background: "rgba(251,191,36,0.04)",
                    border: "1px solid rgba(251,191,36,0.15)",
                    borderRadius: 3, padding: "5px 7px",
                  }}>
                    <div style={{
                      width: 2.5, flexShrink: 0, alignSelf: "stretch",
                      background: "#fbbf24", borderRadius: 1, marginTop: 1,
                    }} />
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#fbbf24", marginBottom: 3 }}>
                        {fmtPrice(n.strongest_level.price, n.price)}
                        {n.strongest_level.timeframe && (
                          <span style={{ fontSize: 6, color: "#78350f", marginLeft: 5, fontWeight: 400 }}>
                            {n.strongest_level.timeframe} · {n.strongest_level.pips_away}p away
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 7, color: "#374151", lineHeight: 1.6 }}>
                        {n.strongest_level.description}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Session context ── */}
              <div style={{ marginBottom: 8 }}>
                <SectionLabel>Session Context</SectionLabel>
                <SessionCountdown brokerTime={n.broker_time} />
                {n.session.map((line, i) => (
                  <div key={i} style={{ fontSize: 7.5, color: "#374151", lineHeight: 1.65 }}>
                    {line}
                  </div>
                ))}
              </div>

              {/* ── Trade readiness ── */}
              <div style={{ marginBottom: 8 }}>
                <SectionLabel>Trade Readiness</SectionLabel>

                {n.trade_readiness.direction && (
                  <div style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
                    color: n.trade_readiness.direction === "long" ? "#26a69a" : "#ef5350",
                    marginBottom: 5,
                  }}>
                    {n.trade_readiness.direction === "long" ? "▲ LONG BIAS" : "▼ SHORT BIAS"}
                  </div>
                )}

                <div style={{ fontSize: 7.5, color: "#475569", lineHeight: 1.65, marginBottom: 5 }}>
                  {n.trade_readiness.summary}
                </div>

                <div style={{
                  background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  borderRadius: 3, padding: "5px 7px", marginBottom: 5,
                }}>
                  {n.trade_readiness.conditions.map((c, i) => (
                    <CheckRow key={i} condition={c} />
                  ))}
                </div>

                <ReadinessBar met={n.trade_readiness.met} total={n.trade_readiness.total} />

                <div style={{
                  marginTop: 6, fontSize: 7.5, lineHeight: 1.65,
                  color: n.trade_readiness.ready ? "#4ade80" : "#374151",
                  borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 5,
                }}>
                  {n.trade_readiness.action}
                </div>

                {/* ── Watch for ── */}
                {n.watch_for && (
                  <div style={{
                    marginTop: 6,
                    background: "rgba(255,255,255,0.015)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 3, padding: "5px 7px",
                  }}>
                    <div style={{
                      fontSize: 6.5, fontWeight: 700, letterSpacing: "0.12em",
                      color: "#1e293b", textTransform: "uppercase", marginBottom: 3,
                    }}>
                      What to wait for
                    </div>
                    <div style={{ fontSize: 7.5, color: "#4ade80", lineHeight: 1.65 }}>
                      {n.watch_for}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Confidence tiles ── */}
              <div style={{
                display: "flex", gap: 5,
                borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 7,
              }}>
                {[
                  { label: "CLARITY",   value: n.confidence.market_clarity,    q: n.confidence.market_clarity },
                  { label: "STRUCTURE", value: n.confidence.structure_quality,  q: n.confidence.structure_quality },
                  {
                    label: "SIGNAL",
                    value: `${n.confidence.signal_confidence}%`,
                    q: n.confidence.signal_confidence >= 70 ? "High"
                      : n.confidence.signal_confidence >= 40 ? "Medium" : "Low" as "High" | "Medium" | "Low",
                  },
                ].map(({ label, value, q }) => (
                  <div key={label} style={{
                    flex: 1, background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.04)",
                    borderRadius: 3, padding: "4px 0", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 5.5, color: "#1f2937", letterSpacing: "0.12em", marginBottom: 2 }}>
                      {label}
                    </div>
                    <div style={{
                      fontSize: 8.5, fontWeight: 700,
                      color: qualityColor(q as "High" | "Medium" | "Low"),
                      letterSpacing: "0.04em",
                    }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 4, textAlign: "right" }}>
                {fetchedAt > 0 && (
                  <span style={{ fontSize: 5.5, color: "#1e293b" }}>
                    {secAgo(Math.floor(fetchedAt / 1000), Math.floor(Date.now() / 1000))}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: .35; } 50% { opacity: .75; } }
      `}</style>
    </div>
  );
}


function SessionCountdown({ brokerTime }: { brokerTime?: number }) {
  const [now, setNow] = React.useState<Date | null>(() => brokerTime ? new Date(brokerTime * 1000) : null);
  React.useEffect(() => {
    const t = setInterval(() => setNow(prev => {
      if (!brokerTime) return prev;
      return prev ? new Date(prev.getTime() + 30_000) : prev;
    }), 30_000);
    return () => clearInterval(t);
  }, [brokerTime]);

  React.useEffect(() => {
    if (brokerTime) setNow(new Date(brokerTime * 1000));
  }, [brokerTime]);
  if (!now) return null;

  const midMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const lonOff = (() => { try { const m = midMonth.toLocaleString("en", { timeZone: "Europe/London",    timeZoneName: "shortOffset" }).match(/([+-])(\d+)/); return m ? (m[1] === "+" ? 1 : -1) * parseInt(m[2]) : 0;  } catch { return 0;  } })();
  const nyOff  = (() => { try { const m = midMonth.toLocaleString("en", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).match(/([+-])(\d+)/); return m ? (m[1] === "+" ? 1 : -1) * parseInt(m[2]) : -5; } catch { return -5; } })();
  const sessions = [
    { name: "London", open: 8  - lonOff, close: 17 - lonOff },
    { name: "NY",     open: 8 - nyOff,  close: 17 - nyOff  },
    { name: "Asian",  open: 0,            close: 9            },
  ];
  const utcH   = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const totalMin = utcH * 60 + utcMin;
  let statusLine = "";
  let nextLine   = "";
  for (const s of sessions) {
    const openMin  = s.open  * 60;
    const closeMin = s.close * 60;
    if (totalMin >= openMin && totalMin < closeMin) {
      const elapsed   = totalMin - openMin;
      const remaining = closeMin - totalMin;
      statusLine = `${s.name} session active — ${elapsed}m since open`;
      nextLine   = `closes in ${Math.floor(remaining / 60)}h ${remaining % 60}m`;
      break;
    }
  }
  if (!statusLine) {
    const nexts = sessions.map(s => {
      let diff = s.open * 60 - totalMin;
      if (diff <= 0) diff += 24 * 60;
      return { name: s.name, diff };
    }).sort((a, b) => a.diff - b.diff);
    const nx = nexts[0];
    nextLine   = `${nx.name} opens in ${Math.floor(nx.diff / 60)}h ${nx.diff % 60}m`;
    statusLine = "No prime session active";
  }
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 7.5, color: "#374151", lineHeight: 1.65 }}>{statusLine}</div>
      {nextLine && (
        <div style={{ fontSize: 7, color: "#1f2937", lineHeight: 1.5 }}>{nextLine}</div>
      )}
    </div>
  );
}

export default MarketNarrative;
