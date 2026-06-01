/**
 * ConditionAlert — toast notifications for environment shifts.
 * Appears when a pair's Scalp or Limit environment changes rating.
 * Auto-dismisses after 8 seconds. Stacks up to 3.
 */

import React, { useEffect, useRef, useState } from "react";
import { usePairSweep, type EnvShift, type EnvRating } from "@/hooks/use-trading-api";
import { X } from "lucide-react";

interface ActiveAlert extends EnvShift {
  id: string;
}

const RATING_COLOR: Record<EnvRating, string> = {
  Favorable:   "#26a69a",
  Mixed:       "#f59e0b",
  Unfavorable: "#ef5350",
};

const ARROW: Record<EnvRating, string> = {
  Favorable:   "↑",
  Mixed:       "→",
  Unfavorable: "↓",
};

export function ConditionAlert() {
  const { data } = usePairSweep(20_000);
  const [alerts, setAlerts]     = useState<ActiveAlert[]>([]);
  const seenTimestamps           = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data?.shifts?.length) return;

    data.shifts.forEach((shift) => {
      const key = `${shift.symbol}-${shift.type}-${shift.timestamp}`;
      if (seenTimestamps.current.has(key)) return;
      seenTimestamps.current.add(key);

      const alert: ActiveAlert = { ...shift, id: key };
      setAlerts(prev => [alert, ...prev].slice(0, 3));

      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setAlerts(prev => prev.filter(a => a.id !== key));
      }, 8000);
    });
  }, [data?.shifts]);

  if (!alerts.length) return null;

  return (
    <div style={{
      position:      "fixed",
      top:           12,
      right:         12,
      zIndex:        9999,
      display:       "flex",
      flexDirection: "column",
      gap:           6,
      pointerEvents: "none",
    }}>
      {alerts.map((alert) => (
        <div
          key={alert.id}
          style={{
            background:   "#0f1520",
            border:       `1px solid ${RATING_COLOR[alert.to]}50`,
            borderLeft:   `3px solid ${RATING_COLOR[alert.to]}`,
            borderRadius: 4,
            padding:      "7px 10px",
            minWidth:     200,
            maxWidth:     280,
            pointerEvents: "auto",
            boxShadow:    "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <span style={{
                  fontSize:      8,
                  fontWeight:    700,
                  fontFamily:    "monospace",
                  color:         "#e2e8f0",
                  letterSpacing: "0.05em",
                }}>
                  {alert.symbol.replace("/", "")}
                </span>
                <span style={{
                  fontSize:      7,
                  fontWeight:    700,
                  color:         "#475569",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}>
                  {alert.type} environment
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 8, color: RATING_COLOR[alert.from], fontWeight: 700 }}>
                  {alert.from}
                </span>
                <span style={{ fontSize: 9, color: RATING_COLOR[alert.to], fontWeight: 700 }}>
                  {ARROW[alert.to]}
                </span>
                <span style={{ fontSize: 8, color: RATING_COLOR[alert.to], fontWeight: 700 }}>
                  {alert.to}
                </span>
              </div>

              <div style={{ fontSize: 6.5, color: "#374151", lineHeight: 1.4 }}>
                {alert.reason}
              </div>
            </div>

            <button
              onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
              style={{
                background: "none",
                border:     "none",
                cursor:     "pointer",
                padding:    0,
                color:      "#374151",
                flexShrink: 0,
              }}
            >
              <X size={9} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ConditionAlert;