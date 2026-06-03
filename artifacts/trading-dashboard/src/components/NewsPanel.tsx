import React from "react";
import { useNewsStatus } from "@/hooks/use-trading-api";
import { AlertTriangle, ShieldCheck, AlertCircle, Clock, WifiOff } from "lucide-react";
import type { NewsStatus, UpcomingEvent } from "@/hooks/use-trading-api";

const STATUS_CONFIG: Record<NewsStatus, {
  bg: string; border: string; text: string; dot: string;
}> = {
  BLOCKED: {
    bg:     "bg-red-500/10",
    border: "border-red-500/30",
    text:   "text-red-400",
    dot:    "bg-red-400",
  },
  CAUTION: {
    bg:     "bg-yellow-500/10",
    border: "border-yellow-500/30",
    text:   "text-yellow-400",
    dot:    "bg-yellow-400",
  },
  CLEAR: {
    bg:     "bg-green-500/10",
    border: "border-green-500/30",
    text:   "text-green-400",
    dot:    "bg-green-400",
  },
};

function impactColor(level: number): string {
  if (level >= 8) return "text-red-400";
  if (level >= 5) return "text-yellow-400";
  return "text-green-400";
}

export function NewsPanel() {
  const { data, isLoading, isError } = useNewsStatus();

  return (
    <div className="border-t border-white/5 px-3 py-3 space-y-3">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          News Impact
        </span>
        {data && !data.service_ok && (
          <span className="flex items-center gap-1 text-[9px] text-red-400/70 font-mono">
            <WifiOff className="w-2.5 h-2.5" />
            offline
          </span>
        )}
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <p className="text-[10px] text-muted-foreground/50 font-mono">Loading...</p>
      )}
      {isError && (
        <p className="text-[10px] text-red-400/70 font-mono">News service unreachable</p>
      )}

      {/* Per-pair status pills */}
      {data && Object.keys(data.per_pair).length > 0 && (
        <div className="space-y-1">
          {Object.entries(data.per_pair).map(([pair, info]) => {
            const cfg = STATUS_CONFIG[info.status] ?? STATUS_CONFIG.CLEAR;
            return (
              <div
                key={pair}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 border ${cfg.bg} ${cfg.border}`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span className="text-[10px] font-mono text-white/80 w-14 flex-shrink-0">
                  {pair}
                </span>
                <span className={`text-[9px] font-bold tracking-wider ${cfg.text}`}>
                  {info.status}
                </span>
                {info.impact_level > 0 && (
                  <span className={`ml-auto text-[9px] font-mono ${impactColor(info.impact_level)}`}>
                    {info.impact_level}/10
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upcoming events next 4 hours */}
      {data && data.upcoming.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50">
            Upcoming · 4 h
          </p>
          {data.upcoming.slice(0, 5).map((ev: UpcomingEvent, i: number) => (
            <div key={i} className="flex items-start gap-2">
              <Clock className="w-2.5 h-2.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[9px] text-white/70 truncate leading-tight">
                  {ev.event ?? "Event"}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[8px] font-mono text-muted-foreground/50">
                    {ev.affects_pairs?.join(", ") ?? ""}
                  </span>
                  {ev.minutes_away != null && (
                    <span className={`text-[8px] font-mono ${impactColor(ev.impact_level ?? 0)}`}>
                      in {Math.round(ev.minutes_away)}m
                    </span>
                  )}
                  <span className={`text-[8px] font-mono ml-auto ${impactColor(ev.impact_level ?? 0)}`}>
                    {ev.impact_level ?? 0}/10
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && Object.keys(data.per_pair).length === 0 && !isLoading && (
        <p className="text-[10px] text-muted-foreground/40 font-mono">No data yet</p>
      )}
    </div>
  );
}