/**
 * StructurePage — dedicated full-screen structure viewer.
 * Route: /structure
 *
 * Shows exactly what the frontend chart would display if ALL toggles were ON.
 * Organized W1 → D1 → 4H → 1H → 15M.
 * UI scaled for comfortable reading at 75% browser zoom.
 */

import React, { useState, useMemo } from "react";
import { useMTFBias, useZonesMTF, useSRLevels, useConfluence, useTradingAnalysis } from "@/hooks/use-trading-api";
import type { ZoneMTF, SRLevel, MTFBias } from "@/hooks/use-trading-api";
import { detectOrderBlocks, detectFVGs } from "@/components/TradingChart";
import type { OrderBlockData, FVGData } from "@/components/TradingChart";
import { LoginGate } from "@/components/LoginGate";

// ── Chart filter constants (mirror of TradingChart.tsx) ───────────────────────

const PROXIMITY_MTF = 0.025;
const STRENGTH_MIN  = 3;

const SR_PROXIMITY: Record<string, number> = {
  "15m": 0.012,
  "1h":  0.018,
  "4h":  0.025,
  "d1":  0.060,
  "w1":  0.12,
};
const SR_MAX_EACH = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPip(price: number): number {
  if (price > 10000) return 1;
  if (price > 500)   return 0.1;
  if (price > 10)    return 0.01;
  return 0.0001;
}

function fmt(price: number, ref: number): string {
  if (!price) return "—";
  if (ref > 10000) return price.toFixed(0);
  if (ref > 500)   return price.toFixed(2);
  if (ref > 10)    return price.toFixed(3);
  return price.toFixed(5);
}

function pipDist(a: number, b: number, pip: number): string {
  return Math.round(Math.abs(a - b) / pip) + "p";
}

function freshLabel(s?: string): { text: string; color: string } {
  if (s === "fresh")           return { text: "Fresh",  color: "#34d399" };
  if (s === "tested_once")     return { text: "Tested", color: "#fbbf24" };
  if (s === "tested_multiple") return { text: "Worn",   color: "#f97316" };
  if (s === "broken")          return { text: "Broken", color: "#ef4444" };
  return { text: "—", color: "#475569" };
}

function trendPill(t?: string): { label: string; color: string; bg: string } {
  if (t === "bullish") return { label: "BULL", color: "#34d399", bg: "rgba(52,211,153,0.12)"  };
  if (t === "bearish") return { label: "BEAR", color: "#f87171", bg: "rgba(248,113,113,0.12)" };
  return                      { label: "CONS", color: "#fb923c", bg: "rgba(251,146,60,0.12)"  };
}

const SYMBOLS = [
  "USD/JPY","EUR/USD","GBP/USD","EUR/JPY","GBP/JPY",
  "AUD/USD","USD/CAD","USD/CHF","NZD/USD","AUD/JPY","CAD/JPY",
  "XAU/USD","BTC/USD",
];

// ── TF config ─────────────────────────────────────────────────────────────────

const TF_CONFIG = [
  { label: "W1",  zoneKey: "zones_w1" as const, srKey: "w1"  as const, biasKey: "bias_w1"  as const, color: "#c084fc" },
  { label: "D1",  zoneKey: "zones_d1" as const, srKey: "d1"  as const, biasKey: "bias_d1"  as const, color: "#60a5fa" },
  { label: "4H",  zoneKey: "zones_4h" as const, srKey: "4h"  as const, biasKey: "bias_4h"  as const, color: "#34d399" },
  { label: "1H",  zoneKey: "zones_1h" as const, srKey: "1h"  as const, biasKey: "bias_1h"  as const, color: "#fbbf24" },
  { label: "15M", zoneKey: null,                srKey: "15m" as const, biasKey: "bias_15m" as const, color: "#94a3b8" },
];

// ── TFBlock component ─────────────────────────────────────────────────────────

function TFBlock({
  label, color, bias,
  supplyZones, demandZones, srLevels,
  obs, fvgs, currentPrice,
}: {
  label: string;
  color: string;
  bias?: MTFBias;
  supplyZones: ZoneMTF[];
  demandZones: ZoneMTF[];
  srLevels: SRLevel[];
  obs: OrderBlockData[];
  fvgs: FVGData[];
  currentPrice: number;
}) {
  const pip        = getPip(currentPrice);
  const tp         = trendPill(bias?.trend);
  const resistance = srLevels.filter(l => l.kind === "resistance").sort((a, b) => b.price - a.price);
  const support    = srLevels.filter(l => l.kind === "support").sort((a, b) => b.price - a.price);

  const noSupply = supplyZones.length === 0;
  const noDemand = demandZones.length === 0;
  const noSR     = srLevels.length === 0;

  const emptyMark = (
    <div style={{ padding: "10px", fontSize: 14, color: "rgba(255,255,255,0.12)", textAlign: "center" }}>✗</div>
  );

  const zoneItem = (z: ZoneMTF, i: number) => {
    const fl     = freshLabel(z.status);
    const center = (z.top + z.bottom) / 2;
    const inside = currentPrice >= z.bottom && currentPrice <= z.top;
    const isS    = z.kind === "supply";
    return (
      <div key={i} style={{
        padding: "6px 5px",
        marginBottom: 5,
        borderLeft: `3px solid ${isS ? "rgba(248,113,113,0.55)" : "rgba(52,211,153,0.55)"}`,
        background: inside ? (isS ? "rgba(248,113,113,0.07)" : "rgba(52,211,153,0.07)") : "transparent",
        borderRadius: "0 3px 3px 0",
      }}>
        <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: isS ? "#fca5a5" : "#6ee7b7", lineHeight: 1.4 }}>
          {fmt(z.bottom, currentPrice)} → {fmt(z.top, currentPrice)}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: fl.color, fontWeight: 700 }}>{fl.text}</span>
          {z.quality != null && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", fontFamily: "monospace" }}>Q{z.quality}</span>
          )}
          <span style={{
            fontSize: 11, fontFamily: "monospace", marginLeft: "auto",
            color: inside ? "#fbbf24" : "rgba(255,255,255,0.17)",
            fontWeight: inside ? 700 : 400,
          }}>
            {inside ? "▶ IN" : pipDist(center, currentPrice, pip)}
          </span>
        </div>
      </div>
    );
  };

  const srItem = (l: SRLevel, i: number) => {
    const isS = l.kind === "support";
    return (
      <div key={i} style={{
        padding: "5px 5px",
        marginBottom: 5,
        borderLeft: `3px solid ${isS ? "rgba(129,140,248,0.55)" : "rgba(251,146,60,0.55)"}`,
        borderRadius: "0 3px 3px 0",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: isS ? "#a5b4fc" : "#fdba74", lineHeight: 1.4 }}>
            {fmt(l.price, currentPrice)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 800, color: isS ? "#818cf8" : "#f97316" }}>
            {isS ? "S" : "R"}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.17)", fontFamily: "monospace", marginLeft: "auto" }}>
            {pipDist(l.price, currentPrice, pip)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      marginBottom: 10,
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 8,
      overflow: "hidden",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 12px",
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: 20, fontWeight: 900, color, letterSpacing: 1, minWidth: 40 }}>{label}</span>
        {bias && (
          <span style={{
            fontSize: 13, fontWeight: 800, color: tp.color,
            background: tp.bg, padding: "2px 10px", borderRadius: 10, letterSpacing: 0.5,
          }}>
            {tp.label}{bias.trend_health != null ? ` ${Math.round(bias.trend_health)}%` : ""}
          </span>
        )}
        {bias?.latest_choch && (
          <span style={{ fontSize: 12, color: "#fbbf24", fontFamily: "monospace" }}>
            {bias.latest_choch.direction === "bullish" ? "↑" : "↓"}CHoCH {bias.latest_choch.age_hours.toFixed(0)}h
          </span>
        )}
        {bias?.latest_bos && (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
            {bias.latest_bos.direction === "bullish" ? "↑" : "↓"}BOS {bias.latest_bos.age_hours.toFixed(0)}h
          </span>
        )}
        <div style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.16)", display: "flex", gap: 12 }}>
          <span>{supplyZones.length}S · {demandZones.length}D</span>
          <span>{resistance.length}R · {support.length}Sup</span>
        </div>
      </div>

      {/* ── Column headers ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr 120px 120px",
        background: "rgba(0,0,0,0.22)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        {[
          { text: "▲ SUPPLY",   color: "rgba(248,113,113,0.50)" },
          { text: "▼ DEMAND",   color: "rgba(52,211,153,0.50)"  },
          { text: "S/R LEVELS", color: "rgba(148,163,184,0.40)" },
          { text: "ORDER BLOCKS", color: "rgba(192,132,252,0.55)" },
          { text: "FAIR VALUE GAPS", color: "rgba(56,189,248,0.55)" },
        ].map((h, i) => (
          <div key={i} style={{
            padding: "5px 8px",
            fontSize: 10, fontWeight: 900, letterSpacing: 1.2, color: h.color,
            borderRight: i < 4 ? "1px solid rgba(255,255,255,0.04)" : "none",
            textAlign: i >= 3 ? "center" : "left",
          }}>
            {h.text}
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 120px 120px", alignItems: "start", minHeight: 56 }}>

        {/* Supply */}
        <div style={{ padding: "8px 7px", borderRight: "1px solid rgba(255,255,255,0.04)" }}>
          {noSupply ? emptyMark : supplyZones.map(zoneItem)}
        </div>

        {/* Demand */}
        <div style={{ padding: "8px 7px", borderRight: "1px solid rgba(255,255,255,0.04)" }}>
          {noDemand ? emptyMark : demandZones.map(zoneItem)}
        </div>

        {/* S/R */}
        <div style={{ padding: "8px 7px", borderRight: "1px solid rgba(255,255,255,0.04)" }}>
          {noSR ? emptyMark : (
            <>
              {resistance.map(srItem)}
              {resistance.length > 0 && support.length > 0 && (
                <div style={{
                  margin: "4px 0", padding: "3px 5px",
                  fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: "#fbbf24",
                  background: "rgba(251,191,36,0.05)",
                  borderTop: "1px dashed rgba(251,191,36,0.2)",
                  borderBottom: "1px dashed rgba(251,191,36,0.2)",
                }}>
                  ◆ {fmt(currentPrice, currentPrice)}
                </div>
              )}
              {support.map(srItem)}
            </>
          )}
        </div>

        {/* OB — real candle-based, same as TradingChart */}
        <div style={{ borderRight: "1px solid rgba(255,255,255,0.04)", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "7px 7px" }}>
          {obs.length === 0
            ? <span style={{ fontSize: 14, color: "rgba(255,255,255,0.13)", textAlign: "center" }}>✗</span>
            : obs.map((ob, i) => (
                <div key={i} style={{ fontSize: 12, fontFamily: "monospace", color: ob.type === "bullish" ? "#a3e635" : "#c084fc", marginBottom: 4, lineHeight: 1.5 }}>
                  {ob.type === "bullish" ? "▲" : "▼"} {fmt(ob.bottom, currentPrice)}–{fmt(ob.top, currentPrice)}
                </div>
              ))
          }
        </div>

        {/* FVG — real candle-based, same as TradingChart */}
        <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "7px 7px" }}>
          {fvgs.length === 0
            ? <span style={{ fontSize: 14, color: "rgba(255,255,255,0.13)", textAlign: "center" }}>✗</span>
            : fvgs.map((fvg, i) => (
                <div key={i} style={{ fontSize: 12, fontFamily: "monospace", color: fvg.type === "bullish" ? "#22d3ee" : "#e879f9", marginBottom: 4, lineHeight: 1.5 }}>
                  {fvg.type === "bullish" ? "▲" : "▼"} {fmt(fvg.bottom, currentPrice)}–{fmt(fvg.top, currentPrice)}
                </div>
              ))
          }
        </div>

      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StructurePage() {
  const [symbol, setSymbol] = useState("USD/JPY");

  const { data: biasData,       isLoading: biasLoading       } = useMTFBias(symbol);
  const { data: zonesMTFData,   isLoading: zonesLoading      } = useZonesMTF(symbol);
  const { data: srData,         isLoading: srLoading         } = useSRLevels(symbol);
  const { data: confluenceData, isLoading: confluenceLoading } = useConfluence(symbol);
  const { data: dataW1  } = useTradingAnalysis(symbol, "w1",  300);
  const { data: dataD1  } = useTradingAnalysis(symbol, "d1",  365);
  const { data: data4h  } = useTradingAnalysis(symbol, "4h",  400);
  const { data: data1h  } = useTradingAnalysis(symbol, "1h",  400);
  const { data: data15m } = useTradingAnalysis(symbol, "15m", 500);

  const currentPrice = useMemo(() =>
    biasData?.bias_15m?.current_price ?? biasData?.bias_1h?.current_price ?? 0,
    [biasData]
  );

  const tfData = useMemo(() => {
    if (!currentPrice) return null;

    return TF_CONFIG.map(config => {

      // ── Zones ──
      const rawZones: ZoneMTF[] = config.zoneKey
        ? ((zonesMTFData?.[config.zoneKey] ?? []) as ZoneMTF[])
        : [];

      const nearbyZones = rawZones.filter(z =>
        !z.broken &&
        (z.strength ?? 0) >= STRENGTH_MIN &&
        Math.abs((z.top + z.bottom) / 2 - currentPrice) / currentPrice <= PROXIMITY_MTF
      );

      const supplyZones = nearbyZones
        .filter(z => (z.top + z.bottom) / 2 > currentPrice)
        .sort((a, b) => (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2)
        .slice(0, SR_MAX_EACH);

      const demandZones = nearbyZones
        .filter(z => (z.top + z.bottom) / 2 <= currentPrice)
        .sort((a, b) => (b.top + b.bottom) / 2 - (a.top + a.bottom) / 2)
        .slice(0, SR_MAX_EACH);

      // ── S/R ──
      const prox     = SR_PROXIMITY[config.srKey] ?? 0.025;
      const allForTF = (srData?.levels ?? []).filter(l => l.timeframe === config.srKey);
      const nearbySR = allForTF.filter(l =>
        Math.abs(l.price - currentPrice) / currentPrice <= prox
      );

      const resistance = nearbySR
        .filter(l => l.price >= currentPrice)
        .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
        .slice(0, SR_MAX_EACH);

      const support = nearbySR
        .filter(l => l.price < currentPrice)
        .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
        .slice(0, SR_MAX_EACH);

      // ── OB / FVG — real candle-based detection, same as TradingChart ──
      const candleMap: Record<string, any[]> = {
        "w1":  dataW1?.candles  ?? [],
        "d1":  dataD1?.candles  ?? [],
        "4h":  data4h?.candles  ?? [],
        "1h":  data1h?.candles  ?? [],
        "15m": data15m?.candles ?? [],
      };
      const candles  = candleMap[config.srKey] ?? [];
      const isD1tf   = config.srKey === "d1" || config.srKey === "w1";
      const obs:  OrderBlockData[] = candles.length ? detectOrderBlocks(candles, currentPrice, isD1tf) : [];
      const fvgs: FVGData[]        = candles.length ? detectFVGs(candles, currentPrice, isD1tf) : [];

      return {
        config,
        supplyZones,
        demandZones,
        srLevels: [...resistance, ...support],
        obs,
        fvgs,
        bias: biasData?.[config.biasKey],
      };
    });
  }, [zonesMTFData, srData, biasData, currentPrice, dataW1, dataD1, data4h, data1h, data15m]);

  const isLoading = biasLoading || zonesLoading || srLoading || confluenceLoading;

  return (
    <LoginGate showPanic={false}>
      <div style={{ minHeight: "100vh", background: "#080c14", color: "white", fontFamily: "'Roboto Mono', monospace" }}>

        {/* ── Header ── */}
        <div style={{
          height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(8,12,20,0.98)", position: "sticky", top: 0, zIndex: 50,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: "rgba(255,255,255,0.70)", letterSpacing: 2 }}>
              STRUCT<span style={{ color: "hsl(210,100%,60%)" }}>.ai</span>
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", letterSpacing: 3 }}>/ STRUCTURE</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.11)", marginLeft: 8 }}>
              all toggles ON
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", letterSpacing: 1 }}>PAIR</span>
            <select
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              style={{
                background: "#161e2c", border: "1px solid rgba(255,255,255,0.10)",
                color: "white", fontSize: 15, fontWeight: 700,
                padding: "3px 8px", borderRadius: 4, outline: "none", cursor: "pointer",
              }}
            >
              {SYMBOLS.map(s => <option key={s} value={s}>{s.replace("/", "")}</option>)}
            </select>
            {currentPrice > 0 && (
              <span style={{ fontSize: 14, fontFamily: "monospace", color: "rgba(255,255,255,0.32)" }}>
                @ {fmt(currentPrice, currentPrice)}
              </span>
            )}
            {isLoading && (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", letterSpacing: 2 }}>LOADING…</span>
            )}
          </div>
        </div>

        {/* ── TF blocks ── */}
        <div style={{ padding: "10px 14px" }}>
          {tfData
            ? tfData.map(d => (
                <TFBlock
                  key={d.config.label}
                  label={d.config.label}
                  color={d.config.color}
                  bias={d.bias}
                  supplyZones={d.supplyZones}
                  demandZones={d.demandZones}
                  srLevels={d.srLevels}
                  obs={d.obs}
                  fvgs={d.fvgs}
                  currentPrice={currentPrice}
                />
              ))
            : (
              <div style={{ padding: 30, fontSize: 13, color: "rgba(255,255,255,0.15)" }}>
                Waiting for price data…
              </div>
            )
          }
        </div>

      </div>
    </LoginGate>
  );
}