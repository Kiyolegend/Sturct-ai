/**
 * StructurePage — dedicated full-screen structure viewer.
 * Route: /structure  (opens in new tab from TopBar)
 *
 * Shows ALL zones, ALL S/R levels, ALL confluence hits across every TF.
 * Toggle-state independent — ignores chart toggles completely.
 */

import React, { useState, useMemo } from "react";
import { useMTFBias, useZonesMTF, useSRLevels, useConfluence } from "@/hooks/use-trading-api";
import type { ZoneMTF, SRLevel, ConfluenceHit, MTFBias } from "@/hooks/use-trading-api";
import { LoginGate } from "@/components/LoginGate";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPip(price: number): number {
  if (price > 10000) return 1;
  if (price > 500)   return 0.1;
  if (price > 50)    return 0.01;
  return 0.0001;
}

function fmt(price: number): string {
  if (!price) return "—";
  return price.toFixed(price > 10000 ? 0 : price > 500 ? 2 : 5);
}

function distPips(a: number, b: number, pip: number): string {
  return Math.round(Math.abs(a - b) / pip) + "p";
}

function statusBadge(s?: string): { label: string; cls: string } {
  if (s === "fresh")           return { label: "Fresh",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" };
  if (s === "tested_once")     return { label: "Tested", cls: "bg-yellow-500/20  text-yellow-300  border-yellow-500/30"  };
  if (s === "tested_multiple") return { label: "Worn",   cls: "bg-orange-500/20  text-orange-300  border-orange-500/30"  };
  if (s === "broken")          return { label: "Broken", cls: "bg-red-500/20     text-red-400     border-red-500/30"     };
  return { label: "—", cls: "text-white/20" };
}

function trendColor(t?: string): string {
  if (t === "bullish") return "text-emerald-400";
  if (t === "bearish") return "text-rose-400";
  return "text-orange-400";
}
function trendLabel(t?: string): string {
  if (t === "bullish") return "BULL";
  if (t === "bearish") return "BEAR";
  return "CONS";
}

const SYMBOLS = [
  "USD/JPY","EUR/USD","GBP/USD","EUR/JPY","GBP/JPY",
  "AUD/USD","USD/CAD","USD/CHF","NZD/USD","AUD/JPY","CAD/JPY",
  "XAU/USD","BTC/USD",
];

const TF_ZONE_KEYS = [
  { label: "W1", key: "zones_w1" as const, color: "text-purple-300",  borderColor: "border-purple-500/30" },
  { label: "D1", key: "zones_d1" as const, color: "text-blue-300",    borderColor: "border-blue-500/30"   },
  { label: "4H", key: "zones_4h" as const, color: "text-emerald-300", borderColor: "border-emerald-500/30"},
  { label: "1H", key: "zones_1h" as const, color: "text-yellow-300",  borderColor: "border-yellow-500/30" },
];

const TF_SR_KEYS = ["w1","d1","4h","1h","15m"] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white/25 border-b border-white/[0.05] bg-[#080c14] sticky top-[56px] z-10">
      {children}
    </div>
  );
}

function ZoneRow({ zone, currentPrice, tfLabel, tfColor }: {
  zone: ZoneMTF; currentPrice: number; tfLabel: string; tfColor: string;
}) {
  const pip = getPip(currentPrice);
  const inside  = currentPrice >= zone.bottom && currentPrice <= zone.top;
  const above   = currentPrice > zone.top;
  const dist = inside
    ? { text: "▶ INSIDE", cls: "text-amber-400 font-bold" }
    : above
      ? { text: `↑ ${distPips(currentPrice, zone.top, pip)} above`, cls: "text-white/30" }
      : { text: `↓ ${distPips(zone.bottom, currentPrice, pip)} below`, cls: "text-white/30" };
  const sb = statusBadge(zone.status);
  const isSupply = zone.kind === "supply";

  return (
    <div className={`flex items-center gap-3 px-4 py-2 border-b border-white/[0.03] hover:bg-white/[0.02] ${zone.broken ? "opacity-30" : ""}`}>
      <span className={`w-7 text-[9px] font-bold shrink-0 ${tfColor}`}>{tfLabel}</span>
      <span className={`w-14 text-[9px] font-bold shrink-0 ${isSupply ? "text-rose-400" : "text-emerald-400"}`}>
        {isSupply ? "SUPPLY" : "DEMAND"}
      </span>
      <span className={`w-40 text-[10px] font-mono shrink-0 ${isSupply ? "text-rose-200" : "text-emerald-200"}`}>
        {fmt(zone.bottom)} → {fmt(zone.top)}
      </span>
      <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${sb.cls}`}>{sb.label}</span>
      {zone.quality != null && (
        <span className="text-[8px] font-mono text-white/30 shrink-0">Q{zone.quality}</span>
      )}
      {zone.departure_pips != null && (
        <span className="text-[8px] font-mono text-white/20 shrink-0">{zone.departure_pips}p dep</span>
      )}
      <span className="text-[8px] font-mono text-white/20 shrink-0">{zone.touches}t</span>
      <span className={`ml-auto text-[8px] font-mono shrink-0 ${dist.cls}`}>{dist.text}</span>
    </div>
  );
}

function SRRow({ level, currentPrice }: { level: SRLevel; currentPrice: number }) {
  const pip = getPip(currentPrice);
  const isSupport = level.kind === "support";
  const dist = Math.round(Math.abs(level.price - currentPrice) / pip);
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.03] hover:bg-white/[0.02]">
      <span className="w-7 text-[9px] font-bold text-white/40 shrink-0">{level.timeframe.toUpperCase()}</span>
      <span className={`w-16 text-[9px] font-bold shrink-0 ${isSupport ? "text-indigo-400" : "text-orange-400"}`}>
        {isSupport ? "SUPPORT" : "RESIST"}
      </span>
      <span className={`w-32 text-[10px] font-mono shrink-0 ${isSupport ? "text-indigo-200" : "text-orange-200"}`}>
        {fmt(level.price)}
      </span>
      {level.score != null && (
        <div className="w-24 shrink-0 flex items-center gap-1">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400 rounded-full"
              style={{ width: `${Math.round(level.score * 100)}%` }}
            />
          </div>
          <span className="text-[8px] font-mono text-white/30">{Math.round(level.score * 100)}%</span>
        </div>
      )}
      <span className="text-[8px] font-mono text-white/20 shrink-0">{level.touches}t</span>
      <span className="ml-auto text-[8px] font-mono text-white/25 shrink-0">{dist}p away</span>
    </div>
  );
}

function ConfluenceRow({ hit, currentPrice }: { hit: ConfluenceHit; currentPrice: number }) {
  const pip = getPip(currentPrice);
  const dist = Math.round(Math.abs(hit.price - currentPrice) / pip);
  const scoreColor = hit.confluence_score >= 0.75
    ? "text-emerald-400"
    : hit.confluence_score >= 0.5
      ? "text-yellow-400"
      : "text-white/40";

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.03] hover:bg-white/[0.02]">
      <span className={`w-20 text-[10px] font-mono font-bold shrink-0 ${scoreColor}`}>
        {Math.round(hit.confluence_score * 100)}%
      </span>
      <span className={`w-14 text-[9px] font-bold shrink-0 ${hit.kind === "support" ? "text-indigo-400" : "text-orange-400"}`}>
        {hit.kind === "support" ? "SUPPORT" : "RESIST"}
      </span>
      <span className="w-32 text-[10px] font-mono text-white/80 shrink-0">{fmt(hit.price)}</span>
      <span className="w-10 text-[8px] text-white/30 shrink-0">{hit.sr_timeframe.toUpperCase()} S/R</span>
      <span className="text-[8px] text-white/20 shrink-0">in</span>
      <span className={`text-[8px] shrink-0 ${hit.zone_kind === "demand" ? "text-emerald-400/70" : "text-rose-400/70"}`}>
        {hit.zone_timeframe.toUpperCase()} {hit.zone_kind}
      </span>
      {hit.has_ob  && <span className="text-[8px] font-bold text-violet-400 bg-violet-500/15 border border-violet-500/30 px-1.5 py-0.5 rounded shrink-0">OB</span>}
      {hit.has_fvg && <span className="text-[8px] font-bold text-sky-400 bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 rounded shrink-0">FVG</span>}
      {(() => { const sb = statusBadge(hit.zone_status); return <span className={`text-[7px] font-bold px-1 py-px rounded border shrink-0 ${sb.cls}`}>{sb.label}</span>; })()}
      <span className="ml-auto text-[8px] font-mono text-white/25 shrink-0">{dist}p away</span>
    </div>
  );
}

// ── Bias strip ────────────────────────────────────────────────────────────────

function BiasBadge({ label, bias }: { label: string; bias?: MTFBias }) {
  if (!bias) return (
    <div className="flex flex-col items-center px-3 py-2 rounded border border-white/10 bg-white/5 min-w-[70px]">
      <span className="text-[8px] text-white/25 uppercase tracking-widest">{label}</span>
      <span className="text-[10px] text-white/20 mt-0.5">—</span>
    </div>
  );
  const tc = trendColor(bias.trend);
  const tl = trendLabel(bias.trend);
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded border min-w-[70px] ${
      bias.trend === "bullish" ? "bg-emerald-500/10 border-emerald-500/30"
      : bias.trend === "bearish" ? "bg-rose-500/10 border-rose-500/30"
      : "bg-orange-500/10 border-orange-500/30"
    }`}>
      <span className="text-[8px] text-white/40 uppercase tracking-widest">{label}</span>
      <span className={`text-[11px] font-black mt-0.5 ${tc}`}>{tl}</span>
      {bias.trend_health != null && (
        <span className="text-[8px] font-mono text-white/30 mt-0.5">{Math.round(bias.trend_health)}%</span>
      )}
      {bias.latest_choch && (
        <span className="text-[7px] text-amber-400 mt-0.5">
          {bias.latest_choch.direction === "bullish" ? "↑" : "↓"}CHoCH {bias.latest_choch.age_hours.toFixed(0)}h
        </span>
      )}
      {bias.latest_bos && (
        <span className="text-[7px] text-white/25 mt-px">
          {bias.latest_bos.direction === "bullish" ? "↑" : "↓"}BOS {bias.latest_bos.age_hours.toFixed(0)}h
        </span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StructurePage() {
  const [symbol, setSymbol] = useState("USD/JPY");
  const [showBroken, setShowBroken] = useState(false);

  const { data: biasData,      isLoading: biasLoading }      = useMTFBias(symbol);
  const { data: zonesMTFData,  isLoading: zonesLoading }     = useZonesMTF(symbol);
  const { data: srData,        isLoading: srLoading }        = useSRLevels(symbol);
  const { data: confluenceData,isLoading: confluenceLoading } = useConfluence(symbol);

  const currentPrice = useMemo(() =>
    biasData?.bias_15m?.current_price ?? biasData?.bias_1h?.current_price ?? 0,
    [biasData]
  );

  // All zones from all TFs, optionally filtering broken
  const allZones = useMemo(() => {
    const out: { zone: ZoneMTF; tfLabel: string; tfColor: string }[] = [];
    for (const { label, key, color } of TF_ZONE_KEYS) {
      const zones = (zonesMTFData?.[key] ?? []) as ZoneMTF[];
      for (const z of zones) {
        if (!showBroken && z.broken) continue;
        out.push({ zone: z, tfLabel: label, tfColor: color });
      }
    }
    // Sort: supply zones above price (descending), demand zones below price (ascending)
    return out.sort((a, b) => {
      const aCenter = (a.zone.top + a.zone.bottom) / 2;
      const bCenter = (b.zone.top + b.zone.bottom) / 2;
      return bCenter - aCenter; // highest first
    });
  }, [zonesMTFData, showBroken]);

  const supplyZones = allZones.filter(z => z.zone.kind === "supply");
  const demandZones = allZones.filter(z => z.zone.kind === "demand");

  // All S/R levels sorted by score desc
  const allSR = useMemo(() => {
    return [...(srData?.levels ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [srData]);

  const srSupport    = allSR.filter(l => l.kind === "support");
  const srResistance = allSR.filter(l => l.kind === "resistance");

  // All confluence hits sorted by score desc
  const allConfluence = useMemo(() =>
    [...(confluenceData?.confluence ?? [])].sort((a, b) => b.confluence_score - a.confluence_score),
    [confluenceData]
  );

  const isLoading = biasLoading || zonesLoading || srLoading || confluenceLoading;
  const pip = getPip(currentPrice);

  return (
    <LoginGate>
      <div style={{ minHeight: "100vh", background: "#080c14", color: "white", fontFamily: "'Roboto Mono', monospace" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(8,12,20,0.98)", position: "sticky", top: 0, zIndex: 50,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "rgba(255,255,255,0.7)", letterSpacing: 2 }}>
              STRUCT<span style={{ color: "hsl(var(--primary, 210 100% 60%))" }}>.ai</span>
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: 3 }}>/ STRUCTURE</span>
          </div>

          {/* Symbol selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: 2 }}>PAIR</span>
            <select
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              style={{
                background: "#161e2c", border: "1px solid rgba(255,255,255,0.1)",
                color: "white", fontSize: 11, fontWeight: 700, padding: "4px 8px",
                borderRadius: 6, outline: "none", cursor: "pointer",
              }}
            >
              {SYMBOLS.map(s => (
                <option key={s} value={s}>{s.replace("/","")}</option>
              ))}
            </select>
            {currentPrice > 0 && (
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>
                @ {fmt(currentPrice)}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Show broken toggle */}
            <button
              onClick={() => setShowBroken(b => !b)}
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 1,
                padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                background: showBroken ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                border: showBroken ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.1)",
                color: showBroken ? "#f87171" : "rgba(255,255,255,0.3)",
              }}
            >
              {showBroken ? "HIDE BROKEN" : "SHOW BROKEN"}
            </button>
            {isLoading && (
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>LOADING…</span>
            )}
          </div>
        </div>

        {/* ── Bias strip ─────────────────────────────────────────────────── */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#0a0e17" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: 3, marginBottom: 8 }}>
            MTF TREND BIAS
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BiasBadge label="W1"  bias={biasData?.bias_w1} />
            <BiasBadge label="D1"  bias={biasData?.bias_d1} />
            <BiasBadge label="4H"  bias={biasData?.bias_4h} />
            <BiasBadge label="1H"  bias={biasData?.bias_1h} />
            <BiasBadge label="15M" bias={biasData?.bias_15m} />
          </div>
        </div>

        {/* ── Main 3-column grid ──────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", minHeight: "calc(100vh - 200px)" }}>

          {/* ── Column 1: Supply/Demand Zones ──────────────────────────── */}
          <div style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
            <SectionTitle>
              Supply/Demand Zones — {supplyZones.length + demandZones.length} total
              ({supplyZones.length} supply · {demandZones.length} demand)
            </SectionTitle>

            {/* Column header */}
            <div style={{
              display: "flex", gap: 12, padding: "4px 16px",
              fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)",
              letterSpacing: 1, borderBottom: "1px solid rgba(255,255,255,0.04)",
              background: "#09101a",
            }}>
              <span style={{ width: 28 }}>TF</span>
              <span style={{ width: 56 }}>TYPE</span>
              <span style={{ width: 160 }}>RANGE</span>
              <span style={{ width: 48 }}>STATUS</span>
              <span style={{ width: 32 }}>Q</span>
              <span style={{ width: 40 }}>DEP</span>
              <span style={{ marginLeft: "auto" }}>DIST</span>
            </div>

            {/* Supply zones (above price) */}
            {supplyZones.length > 0 && (
              <div>
                <div style={{ padding: "4px 16px", fontSize: 8, fontWeight: 900, color: "rgba(248,113,113,0.5)", letterSpacing: 2, background: "rgba(239,68,68,0.03)" }}>
                  ▲ SUPPLY ZONES (above price)
                </div>
                {supplyZones.map((z, i) => (
                  <ZoneRow key={i} zone={z.zone} currentPrice={currentPrice} tfLabel={z.tfLabel} tfColor={z.tfColor} />
                ))}
              </div>
            )}

            {/* Price marker */}
            {currentPrice > 0 && (
              <div style={{
                padding: "6px 16px", fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                color: "#fbbf24", background: "rgba(251,191,36,0.05)",
                borderTop: "1px dashed rgba(251,191,36,0.2)", borderBottom: "1px dashed rgba(251,191,36,0.2)",
              }}>
                ◆ PRICE {fmt(currentPrice)}
              </div>
            )}

            {/* Demand zones (below price) */}
            {demandZones.length > 0 && (
              <div>
                <div style={{ padding: "4px 16px", fontSize: 8, fontWeight: 900, color: "rgba(52,211,153,0.5)", letterSpacing: 2, background: "rgba(16,185,129,0.03)" }}>
                  ▼ DEMAND ZONES (below price)
                </div>
                {demandZones.map((z, i) => (
                  <ZoneRow key={i} zone={z.zone} currentPrice={currentPrice} tfLabel={z.tfLabel} tfColor={z.tfColor} />
                ))}
              </div>
            )}

            {(supplyZones.length === 0 && demandZones.length === 0) && (
              <div style={{ padding: "24px 16px", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>No zone data yet</div>
            )}
          </div>

          {/* ── Column 2: S/R Levels ───────────────────────────────────── */}
          <div style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }}>
            <SectionTitle>
              S/R Levels — {allSR.length} total
              ({srResistance.length} resistance · {srSupport.length} support)
            </SectionTitle>

            {/* Column header */}
            <div style={{
              display: "flex", gap: 12, padding: "4px 16px",
              fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)",
              letterSpacing: 1, borderBottom: "1px solid rgba(255,255,255,0.04)",
              background: "#09101a",
            }}>
              <span style={{ width: 28 }}>TF</span>
              <span style={{ width: 64 }}>TYPE</span>
              <span style={{ width: 128 }}>PRICE</span>
              <span style={{ width: 96 }}>SCORE</span>
              <span style={{ width: 24 }}>T</span>
              <span style={{ marginLeft: "auto" }}>DIST</span>
            </div>

            {/* Resistance (above price) */}
            {srResistance.length > 0 && (
              <div>
                <div style={{ padding: "4px 16px", fontSize: 8, fontWeight: 900, color: "rgba(251,146,60,0.5)", letterSpacing: 2, background: "rgba(249,115,22,0.03)" }}>
                  ▲ RESISTANCE (above price)
                </div>
                {srResistance.map((l, i) => (
                  <SRRow key={i} level={l} currentPrice={currentPrice} />
                ))}
              </div>
            )}

            {/* Price marker */}
            {currentPrice > 0 && (
              <div style={{
                padding: "6px 16px", fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                color: "#fbbf24", background: "rgba(251,191,36,0.05)",
                borderTop: "1px dashed rgba(251,191,36,0.2)", borderBottom: "1px dashed rgba(251,191,36,0.2)",
              }}>
                ◆ PRICE {fmt(currentPrice)}
              </div>
            )}

            {/* Support (below price) */}
            {srSupport.length > 0 && (
              <div>
                <div style={{ padding: "4px 16px", fontSize: 8, fontWeight: 900, color: "rgba(129,140,248,0.5)", letterSpacing: 2, background: "rgba(99,102,241,0.03)" }}>
                  ▼ SUPPORT (below price)
                </div>
                {srSupport.map((l, i) => (
                  <SRRow key={i} level={l} currentPrice={currentPrice} />
                ))}
              </div>
            )}

            {allSR.length === 0 && (
              <div style={{ padding: "24px 16px", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>No S/R data yet</div>
            )}
          </div>

          {/* ── Column 3: Confluence ───────────────────────────────────── */}
          <div>
            <SectionTitle>
              Confluence Hits — {allConfluence.length} total (S/R inside Zone · OB · FVG)
            </SectionTitle>

            {/* Column header */}
            <div style={{
              display: "flex", gap: 12, padding: "4px 16px",
              fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)",
              letterSpacing: 1, borderBottom: "1px solid rgba(255,255,255,0.04)",
              background: "#09101a",
            }}>
              <span style={{ width: 80 }}>SCORE</span>
              <span style={{ width: 56 }}>TYPE</span>
              <span style={{ width: 128 }}>PRICE</span>
              <span style={{ width: 40 }}>S/R TF</span>
              <span>ZONE</span>
              <span style={{ marginLeft: "auto" }}>DIST</span>
            </div>

            {allConfluence.length > 0 ? (
              allConfluence.map((c, i) => (
                <ConfluenceRow key={i} hit={c} currentPrice={currentPrice} />
              ))
            ) : (
              <div style={{ padding: "24px 16px", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>No confluence data yet</div>
            )}
          </div>
        </div>

      </div>
    </LoginGate>
  );
}