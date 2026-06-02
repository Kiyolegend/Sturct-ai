/**
 * PairSweep — compact 5-pair environment table.
 * Shows Scalp + Limit environment rating for each pair.
 * Click a row to switch the active symbol on the main chart.
 */

import React from "react";
import { usePairSweep, type EnvRating, type PairEnvironment } from "@/hooks/use-trading-api";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  activeSymbol:   string;
  onSelectSymbol: (symbol: string) => void;
}

const RATING_COLOR: Record<EnvRating, string> = {
  Favorable:   "#26a69a",
  Mixed:       "#f59e0b",
  Unfavorable: "#ef5350",
};

const RATING_BG: Record<EnvRating, string> = {
  Favorable:   "rgba(38,166,154,0.12)",
  Mixed:       "rgba(245,158,11,0.12)",
  Unfavorable: "rgba(239,83,80,0.12)",
};

const DOT: Record<EnvRating, string> = {
  Favorable:   "🟢",
  Mixed:       "🟡",
  Unfavorable: "🔴",
};

function RatingPill({ rating, reason }: { rating: EnvRating; reason: string }) {
  return (
    <div
      title={reason}
      style={{
        background:   RATING_BG[rating],
        border:       `1px solid ${RATING_COLOR[rating]}40`,
        borderRadius: 3,
        padding:      "2px 5px",
        fontSize:     7,
        fontWeight:   700,
        color:        RATING_COLOR[rating],
        letterSpacing: "0.05em",
        cursor:       "default",
        whiteSpace:   "nowrap",
      }}
    >
      {DOT[rating]} {rating.toUpperCase()}
    </div>
  );
}

const PAIRS = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"];
function scorePair(env: PairEnvironment | undefined): number {
  if (!env || env.error) return -1;
  const pts: Record<EnvRating, number> = { Favorable: 2, Mixed: 1, Unfavorable: 0 };
  return pts[env.scalp] + pts[env.limit];
}

export function PairSweep({ activeSymbol, onSelectSymbol }: Props) {
  const { data, isLoading, error, dataUpdatedAt } = usePairSweep(20_000);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
    
  const bestPair = (() => {
    if (!data?.pairs) return null;
    let best: string | null = null;
    let bestScore = 2;
    for (const pair of PAIRS) {
      const env   = data.pairs[pair];
      const score = scorePair(env);
      if (score > bestScore) {
        bestScore = score;
        best      = pair;
      } else if (score === bestScore && best !== null) {
        if (env?.level_warning && !data.pairs[best]?.level_warning) {
          best = pair;
        }
      }
    }
    return best;
  })();

  return (
    <div style={{
      background:   "#0a0e17",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      padding:      "8px 10px 6px",
    }}>
      {/* Header */}
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        marginBottom:   6,
      }}>
        <span style={{ fontSize: 7.5, fontWeight: 700, color: "#475569", letterSpacing: "0.1em" }}>
          MARKET ENVIRONMENT
        </span>
        {isLoading && (
          <RefreshCw size={8} style={{ color: "#475569", animation: "spin 1s linear infinite" }} />
        )}
        {lastUpdated && !isLoading && (
          <span style={{ fontSize: 6, color: "#1f2937" }}>{lastUpdated}</span>
        )}
      </div>

      {/* Column headers */}
      <div style={{
        display:       "grid",
        gridTemplateColumns: "1fr 80px 80px",
        gap:           4,
        marginBottom:  3,
        paddingBottom: 3,
        borderBottom:  "1px solid rgba(255,255,255,0.04)",
      }}>
        <span style={{ fontSize: 6, color: "#1f2937", letterSpacing: "0.08em" }}>PAIR</span>
        <span style={{ fontSize: 6, color: "#1f2937", letterSpacing: "0.08em", textAlign: "center" }}>SCALP</span>
        <span style={{ fontSize: 6, color: "#1f2937", letterSpacing: "0.08em", textAlign: "center" }}>LIMIT</span>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 0" }}>
          <AlertTriangle size={8} style={{ color: "#ef5350" }} />
          <span style={{ fontSize: 7, color: "#ef5350" }}>Sweep unavailable</span>
        </div>
      )}

      {/* Rows */}
      {PAIRS.map((pair) => {
        const env   = data?.pairs?.[pair];
        const isActive = pair === activeSymbol;

        return (
          <div
            key={pair}
            onClick={() => onSelectSymbol(pair)}
            style={{
              display:       "grid",
              gridTemplateColumns: "1fr 80px 80px",
              gap:           4,
              alignItems:    "center",
              padding:       "3px 4px",
              marginBottom:  1,
              borderRadius:  3,
              cursor:        "pointer",
              background:    isActive ? "rgba(255,255,255,0.04)" : "transparent",
              border:        isActive ? "1px solid rgba(255,255,255,0.06)" : "1px solid transparent",
              transition:    "background 0.15s",
            }}
          >
            {/* Pair name */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  fontSize:      8,
                  fontWeight:    700,
                  fontFamily:    "monospace",
                  color:         isActive ? "#e2e8f0" : "#6b7280",
                  letterSpacing: "0.04em",
                }}>
                  {pair.replace("/", "")}
                </span>
                {pair === bestPair && (
                  <span style={{
                   fontSize:      5.5,
                   fontWeight:    700,
                   color:         "#26a69a",
                   background:    "rgba(38,166,154,0.12)",
                   border:        "1px solid rgba(38,166,154,0.3)",
                   borderRadius:  2,
                   padding:       "1px 3px",
                   letterSpacing: "0.08em",
                  }}>
                    BEST
                  </span> 
                )}
              </div>
              {/* Level warning inline */}
              {env?.level_warning && (
                <span style={{ fontSize: 6, color: "#f59e0b", lineHeight: 1.3 }}>
                  ⚠ {env.level_warning}
                </span>
              )}
            </div>    
   
  

            {/* Scalp pill */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              {env && !env.error ? (
                <RatingPill rating={env.scalp} reason={env.scalp_reason} />
              ) : (
                <span style={{ fontSize: 7, color: "#374151" }}>—</span>
              )}
            </div>

            {/* Limit pill */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              {env && !env.error ? (
                <RatingPill rating={env.limit} reason={env.limit_reason} />
              ) : (
                <span style={{ fontSize: 7, color: "#374151" }}>—</span>
              )}
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default PairSweep;