/**
 * ChochMonitorPage — dedicated tab for CHoCH alerts across all 11 pairs.
 * Route: /choch  (opens in new tab from TopBar)
 */

import { useChoch, useBrokerTime, type ChochEvent } from "@/hooks/use-trading-api";
import { useChochAlerts, dismissChochAlert } from "@/hooks/use-choch-alerts";
import { LoginGate } from "@/components/LoginGate";
import { X } from "lucide-react";

const PAIRS = [
  "USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY", "GBP/JPY",
  "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "AUD/JPY", "CAD/JPY",
];

function fmt(p: number) { return p > 50 ? p.toFixed(3) : p.toFixed(5); }

function timeAgo(unixSec: number, nowSec: number) {
  const age = nowSec - unixSec;
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${(age / 3600).toFixed(1)}h ago`;
}

function countdown(expiresAt: number, nowSec: number) {
  const remain = expiresAt - nowSec;
  if (remain <= 0) return "⚠ EXPIRED";
  const h = Math.floor(remain / 3600);
  const m = Math.floor((remain % 3600) / 60);
  return `${h}h ${m}m left`;
}

// ── Single cell showing one timeframe's CHoCH ─────────────────────────────────

function ChochCell({ event, validitySec, brokerNow }: { event: ChochEvent | null; validitySec: number; brokerNow: number }) {
  if (!event) return (
    <div style={{ textAlign: "center", color: "#64748b", fontSize: 10 }}>—</div>
  );
  const bull = event.direction === "bullish";
  const color = bull ? "#26a69a" : "#ef5350";
  const expiresAt = event.time + validitySec;
  const valid = countdown(expiresAt, brokerNow);
  const expired = valid === "⚠ EXPIRED";
  return (
    <div style={{
      background: expired ? "rgba(255,255,255,0.02)" : `${color}12`,
      border: `1px solid ${expired ? "rgba(255,255,255,0.06)" : color + "40"}`,
      borderRadius: 5, padding: "5px 8px", opacity: expired ? 0.4 : 1,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
        {bull ? "▲ BULL" : "▼ BEAR"}
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8" }}>{fmt(event.price)}</div>
      <div style={{ fontSize: 9, color: "#64748b", marginLeft: "auto", whiteSpace: "nowrap" }}>{timeAgo(event.time, brokerNow)}</div>
      <div style={{ fontSize: 9, color: expired ? "#ef5350" : "#94a3b8", whiteSpace: "nowrap" }}>{valid}</div>
    </div>
  );
}

// ── One row per pair ───────────────────────────────────────────────────────────

function ChochPairRow({ symbol }: { symbol: string }) {
  const { data: d1h, isLoading: l1h } = useChoch(symbol, "1h");
  const { data: d4h, isLoading: l4h } = useChoch(symbol, "4h");
  const { data: brokerTimeData } = useBrokerTime();
  const brokerNow = brokerTimeData?.broker_time ?? Math.floor(Date.now() / 1000);
  const latest1h = d1h?.choch?.length ? d1h.choch[d1h.choch.length - 1] : null;
  const latest4h = d4h?.choch?.length ? d4h.choch[d4h.choch.length - 1] : null;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "80px 1fr 1fr",
      gap: 6, alignItems: "center",
      padding: "5px 10px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 6
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
        {symbol.replace("/", "")}
      </div>
      {l1h
        ? <div style={{ fontSize: 10, color: "#64748b" }}>loading…</div>
        : <ChochCell event={latest1h} validitySec={8 * 3600} brokerNow={brokerNow} />}
      {l4h
        ? <div style={{ fontSize: 10, color: "#64748b" }}>loading…</div>
        : <ChochCell event={latest4h} validitySec={48 * 3600} brokerNow={brokerNow} />}
    </div>
  );
}

// ── Active alerts (dismissable) ───────────────────────────────────────────────

function ActiveAlerts() {
  const alerts = useChochAlerts();
  const { data: brokerTimeData } = useBrokerTime();
  const brokerNow = brokerTimeData?.broker_time ?? Math.floor(Date.now() / 1000);
  if (alerts.length === 0) return (
    <div style={{ textAlign: "center", padding: "12px 0", color: "#64748b", fontSize: 11, letterSpacing: "0.1em" }}>
      NO ACTIVE ALERTS
    </div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {alerts.map(a => {
        const bull = a.direction === "bullish";
        const color = bull ? "#26a69a" : "#ef5350";
        return (
          <div key={a.id} style={{
            position: "relative", minWidth: 200,
            background: `${color}12`, border: `1px solid ${color}40`,
            borderRadius: 8, padding: "10px 36px 10px 14px",
          }}>
            <button onClick={() => dismissChochAlert(a.id)} style={{
              position: "absolute", top: 8, right: 8,
              background: "none", border: "none", cursor: "pointer", color: "#475569", padding: 2,
            }}>
              <X size={12} />
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: "0.05em" }}>
              {a.symbol} · {a.tf.toUpperCase()} · {bull ? "Bullish" : "Bearish"} CHoCH
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
              {fmt(a.price)} — {a.brokenLabel} broken
            </div>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>{countdown(a.expiresAt, brokerNow)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ChochMonitorPage() {
  return (
    <LoginGate>
      <div style={{ minHeight: "100vh", background: "#0a0e17", color: "white", fontFamily: "'Roboto Mono', monospace" }}>

        {/* Header */}
        <div style={{
          height: 40, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,14,23,0.98)", position: "sticky", top: 0, zIndex: 50,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "white" }}>
              STRUCT<span style={{ color: "#3b82f6" }}>.ai</span>
            </span>
            <span style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              CHoCH Monitor · 11 Pairs
            </span>
          </div>
          <a href="/" style={{ fontSize: 11, color: "#94a3b8", textDecoration: "none" }}>
            ← Back to chart
          </a>
        </div>

        {/* Body */}
        <div style={{ padding: "10px 16px", maxWidth: 900, margin: "0 auto" }}>

          {/* Active alerts section */}
          <div style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "#94a3b8",
              textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.05)",
              paddingBottom: 5, marginBottom: 8,
            }}>
              Active Alerts — click card to dismiss
            </div>
            <ActiveAlerts />
          </div>

          {/* All-pairs table */}
          <div>
            {/* Column headers */}
            <div style={{
              display: "grid", gridTemplateColumns: "80px 1fr 1fr",
              gap: 6, padding: "2px 10px", marginBottom: 4,
            }}>
              <div />
              <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.14em", textAlign: "center", textTransform: "uppercase" }}>
                1H CHoCH · valid 8h
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.14em", textAlign: "center", textTransform: "uppercase" }}>
                4H CHoCH · valid 48h
              </div>
            </div>

            {/* Rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {PAIRS.map(pair => <ChochPairRow key={pair} symbol={pair} />)}
            </div>
          </div>

        </div>
      </div>
    </LoginGate>
  );
}

export default ChochMonitorPage;