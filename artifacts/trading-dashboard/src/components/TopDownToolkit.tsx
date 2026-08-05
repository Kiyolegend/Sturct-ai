import React, { useMemo } from "react";
import { X } from "lucide-react";
import type { ToggleState } from "@/components/TopBar";
import type {
  MTFBiasResponse,
  ZonesMTFResponse,
  SRLevelsResponse,
  ConfluenceResponse,
  ZoneMTF,
  MTFBias,
} from "@/hooks/use-trading-api";

interface TopDownToolkitProps {
  symbol: string;
  biasData?: MTFBiasResponse;
  zonesMTFData?: ZonesMTFResponse;
  srData?: SRLevelsResponse;
  confluenceData?: ConfluenceResponse;
  currentPrice: number;
  toggles?: ToggleState;
  onClose?: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getPip(price: number): number {
  if (price > 10000) return 1;
  if (price > 500)   return 0.1;
  if (price > 50)    return 0.01;
  return 0.0001;
}

function fmt(price: number): string {
  return price.toFixed(price > 10000 ? 0 : price > 500 ? 2 : 3);
}

function fmtFull(price: number): string {
  return price.toFixed(price > 10000 ? 0 : price > 500 ? 2 : 5);
}

function distanceLabel(
  zoneTop: number,
  zoneBottom: number,
  current: number,
): { text: string; color: string } {
  if (!current) return { text: "", color: "" };
  const p = getPip(current);
  if (current >= zoneBottom && current <= zoneTop)
    return { text: "▶ INSIDE", color: "text-amber-400 font-bold" };
  if (current > zoneTop) {
    const pips = Math.round((current - zoneTop) / p);
    return { text: `↑ ${pips}p above`, color: "text-white/35" };
  }
  const pips = Math.round((zoneBottom - current) / p);
  return { text: `↓ ${pips}p below`, color: "text-white/35" };
}

function statusBadge(s?: string): { label: string; cls: string } {
  if (s === "fresh")           return { label: "Fresh",  cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" };
  if (s === "tested_once")     return { label: "Tested", cls: "bg-yellow-500/20  text-yellow-300  border-yellow-500/30"  };
  if (s === "tested_multiple") return { label: "Worn",   cls: "bg-orange-500/20  text-orange-300  border-orange-500/30"  };
  return { label: "—", cls: "text-white/20" };
}

function trendPill(trend?: string, health?: number | null): { label: string; color: string; bg: string } {
  const h = health != null ? ` ${Math.round(health)}%` : "";
  if (trend === "bullish") return { label: `BULL${h}`, color: "text-emerald-300", bg: "bg-emerald-500/15 border border-emerald-500/25" };
  if (trend === "bearish") return { label: `BEAR${h}`, color: "text-rose-300",    bg: "bg-rose-500/15    border border-rose-500/25"    };
  return                          { label: `CONS${h}`, color: "text-orange-300",  bg: "bg-orange-500/10  border border-orange-500/20"  };
}

// ── TF config — maps each row to its data keys + toggle keys ────────────────

const TF_CONFIG = [
  { label: "W1",  biasKey: "bias_w1"  as const, zoneKey: "zones_w1" as const, srTf: "w1",  zoneToggle: "zonesW1" as keyof ToggleState, srToggle: "w1SR"  as keyof ToggleState, hasZoneData: true  },
  { label: "D1",  biasKey: "bias_d1"  as const, zoneKey: "zones_d1" as const, srTf: "d1",  zoneToggle: "zonesD1" as keyof ToggleState, srToggle: "d1SR"  as keyof ToggleState, hasZoneData: true  },
  { label: "4H",  biasKey: "bias_4h"  as const, zoneKey: "zones_4h" as const, srTf: "4h",  zoneToggle: "zones4h" as keyof ToggleState, srToggle: "sr4h"  as keyof ToggleState, hasZoneData: true  },
  { label: "1H",  biasKey: "bias_1h"  as const, zoneKey: "zones_1h" as const, srTf: "1h",  zoneToggle: "zones1h" as keyof ToggleState, srToggle: "sr1h"  as keyof ToggleState, hasZoneData: true  },
  { label: "15M", biasKey: "bias_15m" as const, zoneKey: null,                srTf: "15m", zoneToggle: null,                           srToggle: "sr15m" as keyof ToggleState, hasZoneData: false },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export function TopDownToolkit({
  symbol,
  biasData,
  zonesMTFData,
  srData,
  confluenceData,
  currentPrice,
  toggles,
  onClose,
}: TopDownToolkitProps) {

  // ── Per-TF data processing ─────────────────────────────────────────────
  const tfData = useMemo(() => TF_CONFIG.map(cfg => {
    const bias = biasData?.[cfg.biasKey] as MTFBias | undefined;

    // Zones — only if toggle is ON
    const zonesOn = cfg.zoneToggle != null ? (toggles?.[cfg.zoneToggle] ?? true) : false;
    const rawZones: ZoneMTF[] = zonesOn && cfg.zoneKey != null
      ? ((zonesMTFData?.[cfg.zoneKey] ?? []) as ZoneMTF[])
      : [];
    const demands  = rawZones
      .filter(z => z.kind === "demand" && z.status !== "broken")
      .sort((a, b) => Math.abs(currentPrice - a.center) - Math.abs(currentPrice - b.center));
    const supplies = rawZones
      .filter(z => z.kind === "supply" && z.status !== "broken")
      .sort((a, b) => Math.abs(currentPrice - a.center) - Math.abs(currentPrice - b.center));

    // S/R — only if toggle is ON
    const srOn = toggles?.[cfg.srToggle] ?? true;
    const allLevels = srData?.levels ?? [];
    const supports    = srOn ? allLevels.filter(l => l.kind === "support"    && (l.timeframe as string) === cfg.srTf).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 1) : [];
    const resistances = srOn ? allLevels.filter(l => l.kind === "resistance" && (l.timeframe as string) === cfg.srTf).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 1) : [];

    // OB / FVG / BOS — respect toggles
    const obOn  = toggles?.ob  ?? true;
    const fvgOn = toggles?.fvg ?? true;
    const bosOn = toggles?.bos ?? true;

    const cfHits = (confluenceData?.confluence ?? []).filter(c => (c.zone_timeframe as string) === cfg.srTf);
    const hasOB  = obOn  && cfHits.some(c => c.has_ob);
    const hasFVG = fvgOn && cfHits.some(c => c.has_fvg);

    return {
      label: cfg.label,
      bias,
      demands,
      supplies,
      supports,
      resistances,
      hasOB,
      hasFVG,
      zonesOn,
      srOn,
      obOn,
      fvgOn,
      bosOn,
      hasZoneData: cfg.hasZoneData,
    };
  }), [biasData, zonesMTFData, srData, confluenceData, currentPrice, toggles]);

  // ── Summary ────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const biases    = TF_CONFIG.map(k => (biasData?.[k.biasKey] as MTFBias | undefined)?.trend);
    const bullCount = biases.filter(b => b === "bullish").length;
    const bearCount = biases.filter(b => b === "bearish").length;

    const zoneKeys = ["zones_w1", "zones_d1", "zones_4h", "zones_1h"] as const;
    const allDemands = zoneKeys.flatMap(k => (zonesMTFData?.[k] ?? []) as ZoneMTF[]).filter(z => z.kind === "demand" && z.status !== "broken");
    const allSupplies = zoneKeys.flatMap(k => (zonesMTFData?.[k] ?? []) as ZoneMTF[]).filter(z => z.kind === "supply" && z.status !== "broken");

    // Best buy = demand zone just below or containing current price
    const bestBuy  = allDemands.filter(z => z.bottom <= currentPrice).sort((a, b) => b.bottom - a.bottom)[0];
    // Best sell = supply zone just above or containing current price
    const bestSell = allSupplies.filter(z => z.top >= currentPrice).sort((a, b) => a.top - b.top)[0];

    // Which TF is each zone from?
    const findZoneTF = (zone: ZoneMTF | undefined) => {
      if (!zone) return "—";
      const found = zoneKeys.find(k => (zonesMTFData?.[k] ?? []).some((z: ZoneMTF) => z.bottom === zone.bottom && z.top === zone.top));
      return found ? found.replace("zones_", "").toUpperCase() : "—";
    };
    const buyTF  = findZoneTF(bestBuy);
    const sellTF = findZoneTF(bestSell);

    const cf = confluenceData?.confluence ?? [];
    const hasOBDemand  = cf.some(c => c.zone_kind === "demand" && c.has_ob);
    const hasFVGDemand = cf.some(c => c.zone_kind === "demand" && c.has_fvg);
    const hasOBSupply  = cf.some(c => c.zone_kind === "supply" && c.has_ob);
    const hasFVGSupply = cf.some(c => c.zone_kind === "supply" && c.has_fvg);

    // Recent opposing CHoCH events (warnings)
    const choch1h  = biasData?.bias_1h?.latest_choch;
    const choch15m = biasData?.bias_15m?.latest_choch;

    // Confidence stars (max 5)
    const buyConf  = Math.min(5, Math.round(
      bullCount * 0.6 +
      (bestBuy?.status === "fresh" ? 1.5 : bestBuy?.status === "tested_once" ? 1 : 0) +
      (hasOBDemand  ? 0.5 : 0) +
      (hasFVGDemand ? 0.5 : 0),
    ));
    const sellConf = Math.min(5, Math.round(
      bearCount * 0.6 +
      (bestSell?.status === "fresh" ? 1.5 : bestSell?.status === "tested_once" ? 1 : 0) +
      (hasOBSupply  ? 0.5 : 0) +
      (hasFVGSupply ? 0.5 : 0),
    ));

    // Reason lists
    const buyReasons: { text: string; warn: boolean }[] = [];
    if (bestBuy) {
      const sb = statusBadge(bestBuy.status);
      buyReasons.push({ text: `${buyTF} Demand · ${sb.label}${bestBuy.quality != null ? ` · Q${bestBuy.quality}` : ""}`, warn: false });
    }
    buyReasons.push({ text: `${bullCount}/5 TFs bullish`, warn: bullCount < 2 });
    if (hasOBDemand)  buyReasons.push({ text: "OB stacked at demand zone",  warn: false });
    if (hasFVGDemand) buyReasons.push({ text: "FVG stacked at demand zone", warn: false });
    if (choch1h?.direction  === "bearish") buyReasons.push({ text: `1H CHoCH Bearish — ${Math.round(choch1h.age_hours)}h ago`, warn: true });
    if (choch15m?.direction === "bearish") buyReasons.push({ text: `15M CHoCH Bearish — ${Math.round(choch15m.age_hours)}h ago`, warn: true });

    const sellReasons: { text: string; warn: boolean }[] = [];
    if (bestSell) {
      const sb = statusBadge(bestSell.status);
      sellReasons.push({ text: `${sellTF} Supply · ${sb.label}${bestSell.quality != null ? ` · Q${bestSell.quality}` : ""}`, warn: false });
    }
    sellReasons.push({ text: `${bearCount}/5 TFs bearish`, warn: bearCount < 2 });
    if (hasOBSupply)  sellReasons.push({ text: "OB stacked at supply zone",  warn: false });
    if (hasFVGSupply) sellReasons.push({ text: "FVG stacked at supply zone", warn: false });
    if (choch1h?.direction  === "bullish") sellReasons.push({ text: `1H CHoCH Bullish — ${Math.round(choch1h.age_hours)}h ago`, warn: true });
    if (choch15m?.direction === "bullish") sellReasons.push({ text: `15M CHoCH Bullish — ${Math.round(choch15m.age_hours)}h ago`, warn: true });

    return { bullCount, bearCount, bestBuy, bestSell, buyConf, sellConf, buyReasons, sellReasons };
  }, [biasData, zonesMTFData, confluenceData, currentPrice]);

  const displaySymbol = symbol.replace("/", "");
  const priceStr = currentPrice > 0 ? fmtFull(currentPrice) : "—";
  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  // ── Column header ──────────────────────────────────────────────────────
  const ColHeader = () => (
    <div className="flex items-center gap-1 px-3 py-1 border-b border-white/[0.05] text-[8px] font-bold uppercase tracking-widest text-white/20">
      <div className="w-7 shrink-0">TF</div>
      <div className="w-[72px] shrink-0">Trend</div>
      <div className="flex-1">Zone</div>
      <div className="w-14 shrink-0 text-right text-indigo-400/40">S/R</div>
      <div className="w-5 shrink-0 text-center text-violet-400/50">OB</div>
      <div className="w-5 shrink-0 text-center text-sky-400/50">FVG</div>
      <div className="w-[88px] shrink-0 text-amber-400/40">CHoCH</div>
      <div className="w-[80px] shrink-0 text-white/20">BOS</div>
    </div>
  );

  // ── TF row ─────────────────────────────────────────────────────────────
  const TFRow = ({ d, side }: { d: typeof tfData[0]; side: "long" | "short" }) => {
    const isLong = side === "long";
    const zone   = isLong ? d.demands[0]  : d.supplies[0];
    const sr     = isLong ? d.supports[0] : d.resistances[0];
    const tp     = trendPill(d.bias?.trend, d.bias?.trend_health);
    const choch  = d.bias?.latest_choch;
    const bos    = d.bias?.latest_bos;
    const chochMatch = choch?.direction === (isLong ? "bullish" : "bearish");
    const bosMatch   = bos?.direction   === (isLong ? "bullish" : "bearish");
    const dist   = zone ? distanceLabel(zone.top, zone.bottom, currentPrice) : null;

    // Zone empty reason
    const zoneEmpty = !zone
      ? (!d.hasZoneData ? "—" : !d.zonesOn ? "⊘ off" : "—")
      : null;

    return (
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/[0.04] hover:bg-white/[0.015]">

        {/* TF */}
        <div className="w-7 shrink-0">
          <span className="text-[10px] font-bold text-white/35">{d.label}</span>
        </div>

        {/* Trend pill */}
        <div className={`w-[72px] shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black text-center ${tp.color} ${tp.bg}`}>
          {tp.label}
        </div>

        {/* Zone */}
        <div className="flex-1 min-w-0">
          {zone ? (
            <div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className={`text-[10px] font-mono font-semibold ${isLong ? "text-emerald-300" : "text-rose-300"}`}>
                  {fmt(zone.bottom)} → {fmt(zone.top)}
                </span>
                {(() => { const sb = statusBadge(zone.status); return <span className={`text-[7px] font-bold px-1 py-px rounded border ${sb.cls}`}>{sb.label}</span>; })()}
                {zone.quality != null && <span className="text-[8px] text-white/20 font-mono">Q{zone.quality}</span>}
              </div>
              {dist && <div className={`text-[8px] font-mono mt-px ${dist.color}`}>{dist.text}</div>}
            </div>
          ) : (
            <span className="text-[9px] text-white/15">{zoneEmpty}</span>
          )}
        </div>

        {/* S/R */}
        <div className="w-14 shrink-0 text-right">
          {sr
            ? <span className={`text-[9px] font-mono ${isLong ? "text-indigo-300" : "text-orange-300"}`}>{fmt(sr.price)}</span>
            : <span className="text-[8px] text-white/15">{d.srOn ? "—" : "⊘"}</span>
          }
        </div>

        {/* OB dot */}
        <div className="w-5 shrink-0 text-center">
          {d.obOn
            ? <span className={`text-[10px] leading-none ${d.hasOB ? "text-violet-400" : "text-white/10"}`}>{d.hasOB ? "●" : "—"}</span>
            : <span className="text-[8px] text-white/10">⊘</span>
          }
        </div>

        {/* FVG dot */}
        <div className="w-5 shrink-0 text-center">
          {d.fvgOn
            ? <span className={`text-[10px] leading-none ${d.hasFVG ? "text-sky-400" : "text-white/10"}`}>{d.hasFVG ? "●" : "—"}</span>
            : <span className="text-[8px] text-white/10">⊘</span>
          }
        </div>

        {/* CHoCH */}
        <div className="w-[88px] shrink-0">
          {d.bosOn && choch ? (
            <span className={`text-[8px] font-mono leading-tight block ${
              chochMatch
                ? (isLong ? "text-emerald-400" : "text-rose-400")
                : "text-amber-400/50"
            }`}>
              {choch.direction === "bullish" ? "↑" : "↓"} {fmt(choch.price)}
              <span className="text-white/20 ml-0.5">{choch.age_hours.toFixed(0)}h</span>
            </span>
          ) : (
            <span className="text-[8px] text-white/12">{d.bosOn ? "—" : "⊘ off"}</span>
          )}
        </div>

        {/* BOS */}
        <div className="w-[80px] shrink-0">
          {d.bosOn && bos ? (
            <span className={`text-[8px] font-mono leading-tight block ${bosMatch ? "text-white/55" : "text-white/20"}`}>
              {bos.direction === "bullish" ? "↑" : "↓"} {fmt(bos.price)}
              <span className="text-white/20 ml-0.5">{bos.age_hours.toFixed(0)}h</span>
            </span>
          ) : (
            <span className="text-[8px] text-white/12">{d.bosOn ? "—" : "⊘ off"}</span>
          )}
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      className="w-full border-b border-white/5 bg-[#080c14] shrink-0 overflow-y-auto overflow-x-auto"
      style={{ maxHeight: "360px" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/[0.06] bg-[#0a0e17] sticky top-0 z-10 min-w-[860px]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white/35 uppercase tracking-widest">⊞ Top-Down Toolkit</span>
          <span className="text-[10px] font-bold font-mono text-primary px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded">{displaySymbol}</span>
          <span className="text-[10px] font-mono text-white/25">@ {priceStr}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[8px] text-white/12 font-mono">mirrors chart toggles · 5m refresh</span>
          {onClose && (
            <button onClick={onClose} className="text-white/20 hover:text-white/60 transition-colors p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Two-column table */}
      <div className="grid grid-cols-2 min-w-[860px]" style={{ borderRight: "1px solid rgba(255,255,255,0.04)" }}>

        {/* LONG side */}
        <div className="border-r border-white/[0.05]">
          <div className="px-3 py-1 bg-emerald-500/[0.05] border-b border-emerald-500/10 flex items-center gap-2">
            <span className="text-[10px] font-black text-emerald-400 tracking-widest">🟢 LONG</span>
            <span className="text-[8px] text-white/25 font-mono">{summary.bullCount}/5 TFs bullish</span>
          </div>
          <ColHeader />
          {tfData.map(d => <TFRow key={d.label} d={d} side="long" />)}
        </div>

        {/* SHORT side */}
        <div>
          <div className="px-3 py-1 bg-rose-500/[0.05] border-b border-rose-500/10 flex items-center gap-2">
            <span className="text-[10px] font-black text-rose-400 tracking-widest">🔴 SHORT</span>
            <span className="text-[8px] text-white/25 font-mono">{summary.bearCount}/5 TFs bearish</span>
          </div>
          <ColHeader />
          {tfData.map(d => <TFRow key={d.label} d={d} side="short" />)}
        </div>
      </div>

      {/* Best Buy / Best Sell summary */}
      <div className="grid grid-cols-2 border-t border-white/[0.08] min-w-[860px]">

        {/* Best Buy */}
        <div className="px-4 py-3 bg-emerald-500/[0.03] border-r border-white/[0.05]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Best Buy Area</span>
            <span className="text-yellow-400 text-[10px] leading-none">{stars(summary.buyConf)}</span>
          </div>
          {summary.bestBuy ? (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[11px] font-mono font-bold text-emerald-200">
                  {fmt(summary.bestBuy.bottom)} → {fmt(summary.bestBuy.top)}
                </span>
                {(() => { const sb = statusBadge(summary.bestBuy.status); return <span className={`text-[7px] font-bold px-1 py-px rounded border ${sb.cls}`}>{sb.label}</span>; })()}
                {currentPrice > 0 && (() => {
                  const d = distanceLabel(summary.bestBuy!.top, summary.bestBuy!.bottom, currentPrice);
                  return <span className={`text-[9px] font-mono ${d.color}`}>{d.text}</span>;
                })()}
              </div>
              <div className="space-y-0.5">
                {summary.buyReasons.map((r, i) => (
                  <div key={i} className={`flex items-center gap-1 text-[8px] ${r.warn ? "text-amber-400/80" : "text-white/40"}`}>
                    <span className="shrink-0">{r.warn ? "⚠" : "✓"}</span>
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-[8px] text-white/15 font-mono">No active demand zone below current price</div>
          )}
        </div>

        {/* Best Sell */}
        <div className="px-4 py-3 bg-rose-500/[0.03]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Best Sell Area</span>
            <span className="text-yellow-400 text-[10px] leading-none">{stars(summary.sellConf)}</span>
          </div>
          {summary.bestSell ? (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[11px] font-mono font-bold text-rose-200">
                  {fmt(summary.bestSell.bottom)} → {fmt(summary.bestSell.top)}
                </span>
                {(() => { const sb = statusBadge(summary.bestSell.status); return <span className={`text-[7px] font-bold px-1 py-px rounded border ${sb.cls}`}>{sb.label}</span>; })()}
                {currentPrice > 0 && (() => {
                  const d = distanceLabel(summary.bestSell!.top, summary.bestSell!.bottom, currentPrice);
                  return <span className={`text-[9px] font-mono ${d.color}`}>{d.text}</span>;
                })()}
              </div>
              <div className="space-y-0.5">
                {summary.sellReasons.map((r, i) => (
                  <div key={i} className={`flex items-center gap-1 text-[8px] ${r.warn ? "text-amber-400/80" : "text-white/40"}`}>
                    <span className="shrink-0">{r.warn ? "⚠" : "✓"}</span>
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-[8px] text-white/15 font-mono">No active supply zone above current price</div>
          )}
        </div>
      </div>
    </div>
  );
}