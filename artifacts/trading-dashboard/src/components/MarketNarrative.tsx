/**
 * MarketNarrative — plain-English market commentary panel.
 *
 * Replaces TradeTeller's raw signal codes (S1/BOS/FVG) with analyst-style narrative:
 *   • Market Condition  (Bullish Pullback / Range / Expansion …)
 *   • Structure Summary (4H → 1H → 15M in plain English)
 *   • Key Levels        (nearest resistance & support with pip distance)
 *   • Session Context   (what to expect right now)
 *   • Trade Readiness   (5-condition checklist, progress bar, action line)
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
  return p.toFixed(ref >= 10 ? 3 : 5);
}
function secAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
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
          <span style={{ fontSize: 5.5, color: "#1f2937", letterSpacing: "0.07em" }}>
            {level.timeframe}
          </span>
        )}
        <span style={{ fontSize: 6, color: "#1f2937" }}>{level.pips_away}p</span>
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

// ── Main component ────────────────────────────────────────────────────────────

interface MarketNarrativeProps {
  symbol: string;
  /** Increment this from the parent's WebSocket candle handler to trigger an immediate re-fetch */
  refreshTrigger?: number;
}

export function MarketNarrative({ symbol, refreshTrigger }: MarketNarrativeProps) {
  const [narrative,  setNarrative]  = useState<Narrative | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [minimized,  setMinimized]  = useState(false);
  const [fetchedAt,  setFetchedAt]  = useState(0);
  const abortRef   = useRef<AbortController | null>(null);
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

  // Fetch immediately on symbol change
  useEffect(() => {
    setNarrative(null);
    fetchNarrative(symbol);
  }, [symbol, fetchNarrative]);

  // Re-fetch when parent signals a new candle arrived (debounced 3s so we don't
  // hammer the API on every push cycle — the bridge pushes 20 candles at once)
  useEffect(() => {
    if (!refreshTrigger) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchNarrative(symbol), 3000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [refreshTrigger, symbol, fetchNarrative]);

  // 30-second background poll as fallback
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
              {secAgo(Math.floor(fetchedAt / 1000))}
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

          {/* Error */}
          {error && !loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, paddingBottom: 6 }}>
              <AlertTriangle size={9} style={{ color: "#ef5350", flexShrink: 0 }} />
              <span style={{ fontSize: 7, color: "#ef5350", lineHeight: 1.5 }}>
                {error} — check API connection
              </span>
            </div>
          )}

          {/* Skeleton */}
          {loading && !n && (
            <>
              <SkeletonLine width="55%" />
              <SkeletonLine width="90%" />
              <SkeletonLine width="75%" />
              <SkeletonLine width="65%" />
            </>
          )}

          {/* ── Content ── */}
          {n && (
            <>
              {/* News block banner */}
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

              {/* Condition sentence */}
              <div style={{
                fontSize: 7.5, color: "#475569", lineHeight: 1.7,
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                paddingBottom: 7, marginBottom: 7,
              }}>
                {n.condition_detail}
              </div>

              {/* Structure summary */}
              <div style={{ marginBottom: 8 }}>
                <SectionLabel>Structure Summary</SectionLabel>
                {n.structure.map((line, i) => (
                  <div key={i} style={{ fontSize: 7.5, color: "#374151", lineHeight: 1.65 }}>
                    {line}
                  </div>
                ))}
              </div>

              {/* Key levels */}
              {(n.key_levels.resistance.length > 0 || n.key_levels.support.length > 0) && (
                <div style={{ marginBottom: 8 }}>
                  <SectionLabel>Key Levels</SectionLabel>

                  {n.key_levels.resistance.map((lvl, i) => (
                    <LevelRow key={`r${i}`} level={lvl} kind="res" refPrice={n.price} />
                  ))}

                  {/* Current price marker */}
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

              {/* Session context */}
              <div style={{ marginBottom: 8 }}>
                <SectionLabel>Session Context</SectionLabel>
                <SessionCountdown brokerTime={n.broker_time} />
                {n.session.map((line, i) => (
                  <div key={i} style={{ fontSize: 7.5, color: "#374151", lineHeight: 1.65 }}>
                    {line}
                  </div>
                ))}
              </div>

              {/* Trade readiness */}
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

                {/* Checklist */}
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

                {/* Action */}
                <div style={{
                  marginTop: 6, fontSize: 7.5, lineHeight: 1.65,
                  color: n.trade_readiness.ready ? "#4ade80" : "#374151",
                  borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 5,
                }}>
                  {n.trade_readiness.action}
                </div>
              </div>

              {/* Confidence tiles */}
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
                <span style={{ fontSize: 5.5, color: "#1e293b" }}>
                  {secAgo(n.generated_at)}
                </span>
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
    const [now, setNow] = React.useState(() => brokerTime ? new Date(brokerTime * 1000) : new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(brokerTime ? new Date(brokerTime * 1000) : new Date()), 30_000);
    return () => clearInterval(t);
  }, [brokerTime]);
  const midMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const lonOff = (() => { try { const m = midMonth.toLocaleString("en", { timeZone: "Europe/London",    timeZoneName: "shortOffset" }).match(/([+-])(\d+)/); return m ? (m[1] === "+" ? 1 : -1) * parseInt(m[2]) : 0;  } catch { return 0;  } })();
  const nyOff  = (() => { try { const m = midMonth.toLocaleString("en", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).match(/([+-])(\d+)/); return m ? (m[1] === "+" ? 1 : -1) * parseInt(m[2]) : -5; } catch { return -5; } })();
  const sessions = [
    { name: "London", open: 8  + lonOff, close: 17 + lonOff },
    { name: "NY",     open: 13 + nyOff,  close: 22 + nyOff  },
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
      const elapsed = totalMin - openMin;
      const remaining = closeMin - totalMin;
      statusLine = `${s.name} session active — ${elapsed}m since open`;
      nextLine   = `closes in ${Math.floor(remaining / 60)}h ${remaining % 60}m`;
      break;
    }
  }
  if (!statusLine) {
    // Find next session
    const nexts = sessions.map(s => {
      let diff = s.open * 60 - totalMin;
      if (diff <= 0) diff += 24 * 60;
      return { name: s.name, diff };
    }).sort((a, b) => a.diff - b.diff);
    const n = nexts[0];
    nextLine = `${n.name} opens in ${Math.floor(n.diff / 60)}h ${n.diff % 60}m`;
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
