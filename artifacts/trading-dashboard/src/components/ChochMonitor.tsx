/**
 * ChochMonitor — invisible background component.
 * Polls /trading-api/choch for 1H and 4H across all 11 symbols every 60s.
 * Fires browser notification + toast whenever a NEW CHoCH appears.
 * Seeds silently on first mount — no startup spam.
 */

import { useEffect, useMemo, useRef } from "react";
import { useChoch, type ChochEvent } from "@/hooks/use-trading-api";
import { useToast } from "@/hooks/use-toast";
import { addChochAlert } from "@/hooks/use-choch-alerts";

function fmt(p: number): string {
  return p > 50 ? p.toFixed(3) : p.toFixed(5);
}

function playAlert() {
  if (localStorage.getItem("struct_sound_muted") === "true") return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

function fireSystemNotification(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try { new Notification(title, { body, silent: false }); } catch {}
  }
}

export function ChochMonitor() {
  const { toast } = useToast();
  const permRequested = useRef(false);

  // 11 symbols × 2 timeframes = 22 hooks (must be static — no loops allowed)
  const d1_1h  = useChoch("USD/JPY", "1h");
  const d1_4h  = useChoch("USD/JPY", "4h");
  const d2_1h  = useChoch("EUR/USD", "1h");
  const d2_4h  = useChoch("EUR/USD", "4h");
  const d3_1h  = useChoch("GBP/USD", "1h");
  const d3_4h  = useChoch("GBP/USD", "4h");
  const d4_1h  = useChoch("AUD/USD", "1h");
  const d4_4h  = useChoch("AUD/USD", "4h");
  const d5_1h  = useChoch("USD/CHF", "1h");
  const d5_4h  = useChoch("USD/CHF", "4h");
  const d6_1h  = useChoch("EUR/JPY", "1h");
  const d6_4h  = useChoch("EUR/JPY", "4h");
  const d7_1h  = useChoch("GBP/JPY", "1h");
  const d7_4h  = useChoch("GBP/JPY", "4h");
  const d8_1h  = useChoch("USD/CAD", "1h");
  const d8_4h  = useChoch("USD/CAD", "4h");
  const d9_1h  = useChoch("NZD/USD", "1h");
  const d9_4h  = useChoch("NZD/USD", "4h");
  const d10_1h = useChoch("AUD/JPY", "1h");
  const d10_4h = useChoch("AUD/JPY", "4h");
  const d11_1h = useChoch("CAD/JPY", "1h");
  const d11_4h = useChoch("CAD/JPY", "4h");

  const allData = useMemo(() => ({
    "USD/JPY_1h": d1_1h.data,   "USD/JPY_4h": d1_4h.data,
    "EUR/USD_1h": d2_1h.data,   "EUR/USD_4h": d2_4h.data,
    "GBP/USD_1h": d3_1h.data,   "GBP/USD_4h": d3_4h.data,
    "AUD/USD_1h": d4_1h.data,   "AUD/USD_4h": d4_4h.data,
    "USD/CHF_1h": d5_1h.data,   "USD/CHF_4h": d5_4h.data,
    "EUR/JPY_1h": d6_1h.data,   "EUR/JPY_4h": d6_4h.data,
    "GBP/JPY_1h": d7_1h.data,   "GBP/JPY_4h": d7_4h.data,
    "USD/CAD_1h": d8_1h.data,   "USD/CAD_4h": d8_4h.data,
    "NZD/USD_1h": d9_1h.data,   "NZD/USD_4h": d9_4h.data,
    "AUD/JPY_1h": d10_1h.data,  "AUD/JPY_4h": d10_4h.data,
    "CAD/JPY_1h": d11_1h.data,  "CAD/JPY_4h": d11_4h.data,
  }), [
    d1_1h.data,  d1_4h.data,  d2_1h.data,  d2_4h.data,
    d3_1h.data,  d3_4h.data,  d4_1h.data,  d4_4h.data,
    d5_1h.data,  d5_4h.data,  d6_1h.data,  d6_4h.data,
    d7_1h.data,  d7_4h.data,  d8_1h.data,  d8_4h.data,
    d9_1h.data,  d9_4h.data,  d10_1h.data, d10_4h.data,
    d11_1h.data, d11_4h.data,
  ]);

  // seenRef tracks the last CHoCH timestamp seen per key
  const seenRef        = useRef<Record<string, number>>({});
  const initializedRef = useRef<Record<string, boolean>>({});

  // Request browser notification permission once
  useEffect(() => {
    if (!permRequested.current && typeof Notification !== "undefined" && Notification.permission === "default") {
      permRequested.current = true;
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    for (const [key, data] of Object.entries(allData)) {
      if (!data || !Array.isArray(data.choch) || data.choch.length === 0) continue;

      // Engine returns events sorted ascending — last = most recent
      const latest: ChochEvent = data.choch[data.choch.length - 1];
      const latestTime = latest.time;

      // First load — seed silently, do not fire
      if (!initializedRef.current[key]) {
        initializedRef.current[key] = true;
        seenRef.current[key] = latestTime;
        continue;
      }

      // New CHoCH — fire alert
      if (latestTime > (seenRef.current[key] ?? 0)) {
        seenRef.current[key] = latestTime;

        const [symbol, tf] = key.split("_");
        const isBull         = latest.direction === "bullish";
        const emoji          = isBull ? "🟢" : "🔴";
        const dirLabel       = isBull ? "BULLISH" : "BEARISH";
        const nowSec         = Math.floor(Date.now() / 1000);
        const ageSec         = nowSec - latestTime;
        const validitySec    = tf === "1h" ? 8 * 3600 : 48 * 3600;
        const remainingSec   = validitySec - ageSec;
        const ageStr         = ageSec < 3600
          ? `${Math.floor(ageSec / 60)}m ago`
          : `${(ageSec / 3600).toFixed(1)}h ago`;
        const validStr       = remainingSec > 0
          ? `${Math.floor(remainingSec / 3600)}h ${Math.floor((remainingSec % 3600) / 60)}m left`
          : "⚠ EXPIRED";
        const title          = `${emoji} CHoCH — ${symbol} ${tf.toUpperCase()} · ${ageStr}`;
        const body           = `${dirLabel} shift at ${fmt(latest.price)} — ${latest.broken_label} broken · ${validStr}`;

        playAlert();
        fireSystemNotification(title, body);
        addChochAlert({
          id: `${symbol}_${tf}_${latestTime}`,
          symbol, tf: tf as "1h" | "4h",
          direction: latest.direction,
          price: latest.price,
          brokenLabel: latest.broken_label,
          firedAt: latestTime,
          expiresAt: latestTime + validitySec,
        });
      }
    }
  }, [allData, toast]);

  return null;
}