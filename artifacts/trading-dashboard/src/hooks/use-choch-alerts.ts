import { useEffect, useState } from "react";

export interface ChochAlert {
  id: string;            // `${symbol}_${tf}_${time}` — stable per event
  symbol: string;
  tf: "1h" | "4h";
  direction: "bullish" | "bearish";
  price: number;
  brokenLabel: string;
  firedAt: number;        // event candle time (unix seconds)
  expiresAt: number;      // firedAt + validitySec, in unix seconds
}

let alerts: ChochAlert[] = [];
const dismissed = new Set<string>(
  JSON.parse(localStorage.getItem("struct_choch_dismissed") ?? "[]")
);
const listeners: Array<() => void> = [];

function persist() {
  localStorage.setItem("struct_choch_dismissed", JSON.stringify([...dismissed]));
}
function emit() { listeners.forEach((l) => l()); }

export function addChochAlert(a: ChochAlert) {
  if (dismissed.has(a.id)) return;
  if (alerts.some((x) => x.id === a.id)) return;
  alerts = [a, ...alerts];
  emit();
}

export function dismissChochAlert(id: string) {
  dismissed.add(id);
  persist();
  alerts = alerts.filter((a) => a.id !== id);
  emit();
}

function pruneExpired() {
  const now = Math.floor(Date.now() / 1000);
  const before = alerts.length;
  alerts = alerts.filter((a) => a.expiresAt > now);
  if (alerts.length !== before) emit();
}

export function useChochAlerts() {
  const [, force] = useState(0);
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.push(rerender);
    const interval = setInterval(() => { pruneExpired(); rerender(); }, 30_000);
    return () => {
      listeners.splice(listeners.indexOf(rerender), 1);
      clearInterval(interval);
    };
  }, []);
  return alerts;
}