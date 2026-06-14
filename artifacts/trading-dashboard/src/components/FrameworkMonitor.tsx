/**
 * FrameworkMonitor — invisible background component.
 * Polls /trading-api/framework-status every 30 s.
 * When any pair transitions limit_ready false → true,
 * fires a browser notification + an in-app toast.
 * Also fires when 4H direction flips (bullish ↔ bearish) — the one
 * signal that justifies cancelling a pending limit order.
 * Also fires when a zone is blown while limit_ready was active —
 * signals to cancel the pending limit order immediately.
 *
 * All timestamps displayed use broker time from MT5 candles.
 * Requests notification permission on first mount.
 *
 * limit_ready now fires on 4 hard conditions only:
 *   1. 4H direction clear
 *   2. Valid 1H zone exists
 *   3. Zone not blown
 *   4. No news block + R:R >= 2.5
 * phase_good, retrace_pct, has_15m_confluence shown as bonus indicators in toast.
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

export function FrameworkMonitor({ onActiveSetups, onSwitchSymbol }: Props) {
  const { data } = useFrameworkStatus(30_000);
  const { toast } = useToast();

  const prevState = useRef<Record<string, { limit: boolean; direction: string; zone_status: string; lastNonNeutralDir: string }>>({});



  const permRequested = useRef(false);
  const initialized   = useRef(false);

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
        prevState.current[pair] = {
          limit:       s.limit_ready,
          direction:   s.direction,
          zone_status:        (s as any).limit_zone_status ?? "",
          lastNonNeutralDir:  s.direction !== "neutral" ? s.direction : "",
        };
      }
      return;
    }

    const brokerTime = data.broker_time;
    const ts = fmtBrokerTime(brokerTime);
    const active: ActiveSetup[] = [];

    for (const pair of PAIRS) {
      const status = data.pairs[pair];
      if (!status || status.error) continue;

      const prev = prevState.current[pair] ?? { limit: false, direction: "", zone_status: "", lastNonNeutralDir: "" };
      const cur  = { limit: status.limit_ready };

      const curZoneStatus = (status as any).limit_zone_status ?? "";

      // ── limit: false → true ───────────────────────────────────────────────
      if (!prev.limit && cur.limit) {
        const dir      = status.direction.toUpperCase();
        const rr       = status.limit_rr;
        const entryStr = status.limit_entry ? fmt(status.limit_entry) : "zone";
        const tpStr    = status.limit_tp    ? fmt(status.limit_tp)    : "—";
        const slStr    = status.limit_sl    ? fmt(status.limit_sl)    : "—";

        const bonuses: string[] = [];
        if ((status as any).has_15m_confluence) bonuses.push("15M ✓");
        if (status.phase_good)                  bonuses.push("Phase ✓");
        if ((status as any).retrace_pct != null) bonuses.push(`Retr ${(status as any).retrace_pct}%`);
        const bonusStr = bonuses.length > 0 ? ` · ${bonuses.join(" · ")}` : "";

        playAlert();
        fireSystemNotification(
          `📍 LIMIT READY — ${pair}`,
          `${dir} · RR ${rr}:1 · Zone entry ${entryStr} · TP ${tpStr} · SL ${slStr}${bonusStr} · ${ts}`
        );
        toast({
          title:       `📍 LIMIT READY — ${pair}`,
          description: `${dir} · RR ${rr}:1 · Zone entry ${entryStr} · TP ${tpStr}${bonusStr} · ${ts}`,
          duration:    20_000,
          action: (
            <ToastAction altText={`Switch to ${pair}`} onClick={() => onSwitchSymbol(pair)}>
              GO TO {pair.replace("/", "")}
            </ToastAction>
          ),
        });
      }

      // ── Zone blown while limit was active — cancel alert ──────────────────
      if (
        prev.zone_status !== "" &&
        prev.zone_status !== "blown" &&
        curZoneStatus === "blown" &&
        prev.limit
      ) {
        playAlert();
        fireSystemNotification(
          `⛔ ZONE BLOWN — ${pair}`,
          `The ${status.direction.toUpperCase()} entry zone on ${pair} was violated. Cancel your pending limit order.`
        );
        toast({
          title:       `⛔ ZONE BLOWN — ${pair}`,
          description: `The ${status.direction.toUpperCase()} entry zone was violated. Cancel your pending limit order on ${pair} now.`,
          duration:    60_000,
          action: (
            <ToastAction altText={`Go to ${pair}`} onClick={() => onSwitchSymbol(pair)}>
              GO TO {pair.replace("/", "")}
            </ToastAction>
          ),
        });
      }

      // ── HTF direction flip — cancel alert ─────────────────────────────────
      if (
        prev.limit &&
        prev.lastNonNeutralDir !== "" &&
        status.direction !== "neutral" &&
        prev.lastNonNeutralDir !== status.direction
      ) {
        playAlert();
        fireSystemNotification(
          `🔄 HTF BIAS FLIPPED — ${pair}`,
          `Direction changed ${prev.lastNonNeutralDir.toUpperCase()} → ${status.direction.toUpperCase()}. Cancel any pending limit orders on ${pair}.`
        );
        toast({
          title:       `🔄 HTF BIAS FLIPPED — ${pair}`,
          description: `Direction reversed ${prev.lastNonNeutralDir.toUpperCase()} → ${status.direction.toUpperCase()}. Cancel pending limit orders on ${pair}.`,
          duration:    60_000,
        });
      }

      // Persist current state for next scan
      prevState.current[pair] = {
        ...cur,
        direction:   status.direction,
        zone_status: curZoneStatus,
        lastNonNeutralDir:  status.direction !== "neutral" ? status.direction : prev.lastNonNeutralDir ?? "",
      };

      if (cur.limit) active.push({
        pair, mode: "limit", direction: status.direction, rr: status.limit_rr,
        entry: status.limit_entry, tp: status.limit_tp, sl: status.limit_sl,
      });
    }

    onActiveSetups(active);
  }, [data, toast, onActiveSetups]);

  return null;
}