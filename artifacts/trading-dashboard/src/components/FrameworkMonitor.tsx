/**
 * FrameworkMonitor — invisible background component.
 * Polls /trading-api/framework-status every 30 s.
 * When any pair transitions limit_ready false → true,
 * fires a browser notification + an in-app toast.
 * Also fires when 4H direction flips (bullish ↔ bearish) — the one
 * signal that justifies cancelling a pending limit order.
 *
 * All timestamps displayed use broker time from MT5 candles.
 * Requests notification permission on first mount.
 */

import { useEffect, useRef } from "react";
import { useFrameworkStatus, type ActiveSetup } from "@/hooks/use-trading-api";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const PAIRS = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "USD/CHF"];

function fmt(p: number): string {
  return p > 50 ? p.toFixed(3) : p.toFixed(5);
}

function fmtBrokerTime(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

function playAlert() {
  if (localStorage.getItem("struct_sound_muted") === "true") return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.33);

    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

function fireSystemNotification(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try { new Notification(title, { body, silent: false }); } catch {}
  }
}

interface Props {
  onActiveSetups: (setups: ActiveSetup[]) => void;
  onSwitchSymbol: (pair: string) => void;
}

export function FrameworkMonitor({ onActiveSetups,onSwitchSymbol }: Props) {
  const { data } = useFrameworkStatus(30_000);
  const { toast } = useToast();
  // CHANGE 1: added `direction: string` to prevState shape
  prevState.current[pair] = { scalp: s.scalp_ready, limit: s.limit_ready, direction: s.direction };
  const permRequested = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!permRequested.current && typeof Notification !== "undefined" && Notification.permission === "default") {
      permRequested.current = true;
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!data?.pairs) return;
    if (!initialized.current) {
     initialized.current = true;
     for (const pair of PAIRS) {
       const s = data.pairs[pair];
       if (!s || s.error) continue;
        prevState.current[pair] = { limit: s.limit_ready, direction: s.direction };
    }
    return;
  }

    const brokerTime = data.broker_time;
    const ts = fmtBrokerTime(brokerTime);
    const active: ActiveSetup[] = [];

    for (const pair of PAIRS) {
      const status = data.pairs[pair];
      if (!status || status.error) continue;

      // CHANGE 2: added `direction: ""` as default fallback
      const prev = prevState.current[pair] ?? { limit: false, direction: "" };
      const cur  = { limit: status.limit_ready };

     

      // ── limit: false → true ───────────────────────────────────────────────
      if (!prev.limit && cur.limit) {
        const dir = status.direction.toUpperCase();
        const rr  = status.limit_rr;
        const p   = status.price;
        const entryStr = status.limit_entry ? fmt(status.limit_entry) : "zone";
        const tpStr    = status.limit_tp    ? fmt(status.limit_tp)    : "—";
        const slStr    = status.limit_sl    ? fmt(status.limit_sl)    : "—";

        playAlert();
        fireSystemNotification(
          `📍 LIMIT READY — ${pair}`,
          `${dir} · RR ${rr}:1 · Zone entry ${entryStr} · TP ${tpStr} · SL ${slStr} · ${ts}`
        );
        toast({
          title:       `📍 LIMIT READY — ${pair}`,
          description: `${dir} · RR ${rr}:1 · Zone entry ${entryStr} · TP ${tpStr} · ${ts}`,
          duration:    20_000,
          action: (
            <ToastAction altText={`Switch to ${pair}`} onClick={() => onSwitchSymbol(pair)}>
              GO TO {pair.replace("/", "")}
            </ToastAction>
          ),
        });
      }

      // CHANGE 3: HTF direction flip — fires when 4H bias reverses ──────────
      if (
        prev.direction !== "" &&
        prev.direction !== "neutral" &&
        status.direction !== "neutral" &&
        prev.direction !== status.direction
      ) {
        playAlert();
        fireSystemNotification(
          `🔄 HTF BIAS FLIPPED — ${pair}`,
          `Direction changed ${prev.direction.toUpperCase()} → ${status.direction.toUpperCase()}. Cancel any pending limit orders on ${pair}.`
        );
        toast({
          title:       `🔄 HTF BIAS FLIPPED — ${pair}`,
          description: `Direction reversed ${prev.direction.toUpperCase()} → ${status.direction.toUpperCase()}. Cancel pending limit orders on ${pair}.`,
          duration:    60_000,
        });
      }

      // CHANGE 4: persist direction alongside scalp/limit flags ─────────────
      prevState.current[pair] = { ...cur, direction: status.direction };

      
      if (cur.limit) active.push({
        pair, mode: "limit", direction: status.direction, rr: status.limit_rr,
        entry: status.limit_entry, tp: status.limit_tp, sl: status.limit_sl,
      });
    }

    onActiveSetups(active);
  }, [data, toast, onActiveSetups]);

  return null;
}