/**
 * FrameworkMonitor — invisible background component.
 *
 * Polls /trading-api/framework-status every 30 s.
 * When any pair transitions scalp_ready or limit_ready false → true,
 * fires a browser notification + an in-app toast.
 *
 * Also fires when 4H direction flips (bullish ↔ bearish) — the one
 * signal that justifies cancelling a pending limit order.
 *
 * All timestamps displayed use broker time from MT5 candles.
 * Requests notification permission on first mount.
 */

import { useEffect, useRef } from "react";
import { useFrameworkStatus, type ActiveSetup } from "@/hooks/use-trading-api";
import { useToast } from "@/hooks/use-toast";

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

function playAlert(mode: "scalp" | "limit") {
  if (localStorage.getItem("struct_sound_muted") === "true") return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const notes = mode === "scalp"
      ? [{ freq: 880,  start: 0,    dur: 0.12 },
         { freq: 1100, start: 0.15, dur: 0.18 }]
      : [{ freq: 660,  start: 0,    dur: 0.28 }];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.35, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });

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
}

export function FrameworkMonitor({ onActiveSetups }: Props) {
  const { data } = useFrameworkStatus(30_000);
  const { toast } = useToast();
  // CHANGE 1: added `direction: string` to prevState shape
  const prevState = useRef<Record<string, { scalp: boolean; limit: boolean; direction: string }>>({});
  const permRequested = useRef(false);

  useEffect(() => {
    if (!permRequested.current && typeof Notification !== "undefined" && Notification.permission === "default") {
      permRequested.current = true;
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!data?.pairs) return;

    const brokerTime = data.broker_time;
    const ts = fmtBrokerTime(brokerTime);
    const active: ActiveSetup[] = [];

    for (const pair of PAIRS) {
      const status = data.pairs[pair];
      if (!status || status.error) continue;

      // CHANGE 2: added `direction: ""` as default fallback
      const prev = prevState.current[pair] ?? { scalp: false, limit: false, direction: "" };
      const cur  = { scalp: status.scalp_ready, limit: status.limit_ready };

      // ── scalp: false → true ───────────────────────────────────────────────
      if (!prev.scalp && cur.scalp) {
        const dir = status.direction.toUpperCase();
        const rr  = status.scalp_rr;
        const p   = status.price;
        const entryStr = status.scalp_entry ? fmt(status.scalp_entry) : fmt(p);
        const tpStr    = status.scalp_tp    ? fmt(status.scalp_tp)    : "—";
        const slStr    = status.scalp_sl    ? fmt(status.scalp_sl)    : "—";

        playAlert("scalp");
        fireSystemNotification(
          `🎯 SCALP READY — ${pair}`,
          `${dir} · RR ${rr}:1 · Entry ${entryStr} · TP ${tpStr} · SL ${slStr} · ${ts}`
        );
        toast({
          title:       `🎯 SCALP READY — ${pair}`,
          description: `${dir} · RR ${rr}:1 · Entry ${entryStr} · TP ${tpStr} · ${ts}`,
          duration:    20_000,
        });
      }

      // ── limit: false → true ───────────────────────────────────────────────
      if (!prev.limit && cur.limit) {
        const dir = status.direction.toUpperCase();
        const rr  = status.limit_rr;
        const p   = status.price;
        const entryStr = status.limit_entry ? fmt(status.limit_entry) : "zone";
        const tpStr    = status.limit_tp    ? fmt(status.limit_tp)    : "—";
        const slStr    = status.limit_sl    ? fmt(status.limit_sl)    : "—";

        playAlert("limit");
        fireSystemNotification(
          `📍 LIMIT READY — ${pair}`,
          `${dir} · RR ${rr}:1 · Zone entry ${entryStr} · TP ${tpStr} · SL ${slStr} · ${ts}`
        );
        toast({
          title:       `📍 LIMIT READY — ${pair}`,
          description: `${dir} · RR ${rr}:1 · Zone entry ${entryStr} · TP ${tpStr} · ${ts}`,
          duration:    20_000,
        });
      }

      // CHANGE 3: HTF direction flip — fires when 4H bias reverses ──────────
      if (
        prev.direction !== "" &&
        prev.direction !== "neutral" &&
        status.direction !== "neutral" &&
        prev.direction !== status.direction
      ) {
        playAlert("limit");
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

      if (cur.scalp) active.push({
        pair, mode: "scalp", direction: status.direction, rr: status.scalp_rr,
        entry: status.scalp_entry, tp: status.scalp_tp, sl: status.scalp_sl,
      });
      if (cur.limit) active.push({
        pair, mode: "limit", direction: status.direction, rr: status.limit_rr,
        entry: status.limit_entry, tp: status.limit_tp, sl: status.limit_sl,
      });
    }

    onActiveSetups(active);
  }, [data, toast, onActiveSetups]);

  return null;
}