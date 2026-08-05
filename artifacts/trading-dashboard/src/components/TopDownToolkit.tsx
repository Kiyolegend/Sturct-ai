import React, { useMemo } from "react";
import { X } from "lucide-react";
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
  onClose?: () => void;
}

function getPip(price: number): number {
  if (price > 10000) return 1;
  if (price > 500)   return 0.1;
  if (price > 50)    return 0.01;
  return 0.0001;
}

function fmt(price: number): string {
  return price.toFixed(price > 10000 ? 0 : price > 500 ? 2 : 3);
}

function distanceLabel(zoneTop: number, zoneBottom: number, current: number): string {
  if (!current) return "";
  const p = getPip(current);
  if (current >= zoneBottom && current <= zoneTop) return "▶ INSIDE";
  if (current > zoneTop) return `↑ ${Math.round((current - zoneTop) / p)}p above`;
  return `↓ ${Math.round((zoneBottom - current) / p)}p below`;
}

function statusColor(s?: string) {
  if (s === "fresh")           return "text-emerald-400";
  if (s === "tested_once")     return "text-yellow-400";
  if (s === "tested_multiple") return "text-orange-400";
  if (s === "broken")          return "text-slate-500";
  return "text-slate-400";
}

function statusLabel(s?: string) {
  if (s === "fresh")           return "Fresh";
  if (s === "tested_once")     return "Tested";
  if (s === "tested_multiple") return "Worn";
  if (s === "broken")          return "Broken";
  return "—";
}

function trendColor(t?: string) {
  if (t === "bullish") return "text-emerald-400";
  if (t === "bearish") return "text-red-400";
  return "text-orange-400";
}

const TF_KEYS = [
  { label: "W1",  biasKey: "bias_w1"  as const, zoneKey: "zones_w1" as const, srTf: "w1"  },
  { label: "D1",  biasKey: "bias_d1"  as const, zoneKey: "zones_d1" as const, srTf: "d1"  },
  { label: "4H",  biasKey: "bias_4h"  as const, zoneKey: "zones_4h" as const, srTf: "4h"  },
  { label: "1H",  biasKey: "bias_1h"  as const, zoneKey: "zones_1h" as const, srTf: "1h"  },
  { label: "15M", biasKey: "bias_15m" as const, zoneKey: undefined,            srTf: "15m" },
] as const;

export function TopDownToolkit({
  symbol,
  biasData,
  zonesMTFData,
  srData,
  confluenceData,
  currentPrice,
  onClose,
}: TopDownToolkitProps) {

  const tfData = useMemo(() => TF_KEYS.map(({ label, biasKey, zoneKey, srTf }) => {
    const bias = biasData?.[biasKey] as MTFBias | undefined;
    const allZones: ZoneMTF[] = zoneKey ? (zonesMTFData?.[zoneKey] ?? []) as ZoneMTF[] : [];
    const demands  = allZones.filter(z => z.kind === "demand"  && z.status !== "broken").sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
    const supplies = allZones.filter(z => z.kind === "supply"  && z.status !== "broken").sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
    const supports    = (srData?.levels ?? []).filter(l => l.kind === "support"    && (l.timeframe as string) === srTf).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2);
    const resistances = (srData?.levels ?? []).filter(l => l.kind === "resistance" && (l.timeframe as string) === srTf).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2);
    const cfHits = (confluenceData?.confluence ?? []).filter(c => c.zone_timeframe === srTf);
    const hasOB  = cfHits.some(c => c.has_ob);
    const hasFVG = cfHits.some(c => c.has_fvg);
    return { label, bias, demands, supplies, supports, resistances, hasOB, hasFVG };
  }), [biasData, zonesMTFData, srData, confluenceData]);

  const summary = useMemo(() => {
    const biases = TF_KEYS.map(k => (biasData?.[k.biasKey] as MTFBias | undefined)?.trend);
    const bullCount = biases.filter(b => b === "bullish").length;
    const bearCount = biases.filter(b => b === "bearish").length;

    const allDemands = (["zones_w1","zones_d1","zones_4h","zones_1h"] as const)
      .flatMap(k => (zonesMTFData?.[k] ?? []) as ZoneMTF[])
      .filter(z => z.kind === "demand" && z.status !== "broken");
    const allSupplies = (["zones_w1","zones_d1","zones_4h","zones_1h"] as const)
      .flatMap(k => (zonesMTFData?.[k] ?? []) as ZoneMTF[])
      .filter(z => z.kind === "supply" && z.status !== "broken");

    const bestBuy  = allDemands.filter(z => currentPrice >= z.bottom)
      .sort((a, b) => (currentPrice - a.top) - (currentPrice - b.top))[0];
    const bestSell = allSupplies.filter(z => currentPrice <= z.top)
      .sort((a, b) => (a.bottom - currentPrice) - (b.bottom - currentPrice))[0];

    const hasOBDemand  = (confluenceData?.confluence ?? []).some(c => c.zone_kind === "demand" && c.has_ob);
    const hasFVGDemand = (confluenceData?.confluence ?? []).some(c => c.zone_kind === "demand" && c.has_fvg);
    const hasOBSupply  = (confluenceData?.confluence ?? []).some(c => c.zone_kind === "supply" && c.has_ob);
    const hasFVGSupply = (confluenceData?.confluence ?? []).some(c => c.zone_kind === "supply" && c.has_fvg);

    const buyConf  = Math.min(5, Math.round(bullCount * 0.6 + (bestBuy?.status  === "fresh" ? 1.5 : bestBuy?.status  === "tested_once" ? 1 : 0) + (hasOBDemand  ? 0.5 : 0) + (hasFVGDemand ? 0.5 : 0)));
    const sellConf = Math.min(5, Math.round(bearCount * 0.6 + (bestSell?.status === "fresh" ? 1.5 : bestSell?.status === "tested_once" ? 1 : 0) + (hasOBSupply  ? 0.5 : 0) + (hasFVGSupply ? 0.5 : 0)));

    return { bullCount, bearCount, bestBuy, bestSell, buyConf, sellConf };
  }, [biasData, zonesMTFData, confluenceData, currentPrice]);

  const displaySymbol = symbol.replace("/", "");
  const priceStr = currentPrice > 0 ? currentPrice.toFixed(currentPrice > 10000 ? 0 : currentPrice > 500 ? 2 : 5) : "—";
  const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  const TFRow = ({ label, bias, zone, support, hasOB, hasFVG, side }: {
    label: string;
    bias?: MTFBias;
    zone?: ZoneMTF;
    support?: { price: number };
    hasOB: boolean;
    hasFVG: boolean;
    side: "long" | "short";
  }) => {
    const choch = bias?.latest_choch;
    const bos   = bias?.latest_bos;
    const isLong = side === "long";
    const chochMatch = choch?.direction === (isLong ? "bullish" : "bearish");
    const bosMatch   = bos?.direction   === (isLong ? "bullish" : "bearish");

    return (
      <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
        <td className="px-2 py-1.5 w-9">
          <span className="text-white/50 font-bold text-[10px]">{label}</span>
        </td>
        <td className="px-2 py-1.5 min-w-[140px]">
          {zone ? (
            <div className="leading-tight">
              <span className="text-white/80 text-[10px]">{fmt(zone.bottom)} → {fmt(zone.top)}</span>
              <span className={`ml-1 text-[9px] ${statusColor(zone.status)}`}>{statusLabel(zone.status)}</span>
              {zone.quality != null && <span className="text-white/25 text-[9px] ml-1">Q{zone.quality}</span>}
              {currentPrice > 0 && (
                <div className="text-white/30 text-[9px]">{distanceLabel(zone.top, zone.bottom, currentPrice)}</div>
              )}
            </div>
          ) : <span className="text-white/20 text-[10px]">—</span>}
        </td>
        <td className="px-2 py-1.5 min-w-[64px]">
          {support
            ? <span className={`text-[10px] ${isLong ? "text-emerald-400/70" : "text-red-400/70"}`}>{fmt(support.price)}</span>
            : <span className="text-white/20 text-[10px]">—</span>}
        </td>
        <td className="px-2 py-1.5 text-center w-9 text-[10px]">
          <span className={hasOB  ? "text-emerald-400" : "text-white/20"}>{hasOB  ? "✅" : "❌"}</span>
        </td>
        <td className="px-2 py-1.5 text-center w-9 text-[10px]">
          <span className={hasFVG ? "text-sky-400"     : "text-white/20"}>{hasFVG ? "✅" : "❌"}</span>
        </td>
        <td className="px-2 py-1.5 min-w-[100px] text-[10px] font-mono">
          {choch
            ? <span className={chochMatch ? (isLong ? "text-emerald-400" : "text-red-400") : "text-white/25"}>
                {chochMatch ? (isLong ? "✅ Bull " : "✅ Bear ") : "❌ "}{fmt(choch.price)}
                <span className="text-white/25 ml-1">{choch.age_hours.toFixed(0)}h</span>
              </span>
            : <span className="text-white/20">—</span>}
        </td>
        <td className="px-2 py-1.5 min-w-[100px] text-[10px] font-mono">
          {bos
            ? <span className={bosMatch ? (isLong ? "text-emerald-400" : "text-red-400") : "text-white/25"}>
                {bosMatch ? (isLong ? "✅ Bull " : "✅ Bear ") : "❌ "}{fmt(bos.price)}
                <span className="text-white/25 ml-1">{bos.age_hours.toFixed(0)}h</span>
              </span>
            : <span className="text-white/20">—</span>}
        </td>
        <td className="px-2 py-1.5 min-w-[60px] text-[10px] font-mono">
          <span className={`font-bold ${trendColor(bias?.trend)}`}>
            {bias?.trend === "bullish" ? "BULL" : bias?.trend === "bearish" ? "BEAR" : "CONS"}
          </span>
          {bias?.trend_health != null && (
            <span className="text-white/25 ml-1">{Math.round(bias.trend_health)}%</span>
          )}
        </td>
      </tr>
    );
  };

  const ColHeader = () => (
    <thead>
      <tr className="border-b border-white/[0.06]">
        {["TF","Zone","S/R","OB","FVG","CHoCH","BOS","Trend"].map(h => (
          <th key={h} className="px-2 py-1 text-left text-[9px] text-white/25 font-medium uppercase tracking-wider">{h}</th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="w-full border-b border-white/5 bg-[#080c14] shrink-0 overflow-x-auto overflow-y-auto" style={{ maxHeight: "295px" }}>

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 py-1 border-b border-white/[0.06] bg-[#0a0e17] sticky top-0 z-10 min-w-[900px]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">⊞ Top-Down Toolkit</span>
          <span className="text-[10px] font-bold font-mono text-primary px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded">{displaySymbol}</span>
          <span className="text-[10px] font-mono text-white/30">@ {priceStr}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-white/20 font-mono">Data from STRUCT.ai engines · refreshes every 5m</span>
          {onClose && (
            <button onClick={onClose} className="text-white/20 hover:text-white/60 transition-colors p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Two-column table ── */}
      <div className="flex min-w-[900px]">

        {/* LONG side */}
        <div className="flex-1 border-r border-white/[0.06]">
          <div className="px-3 py-1 border-b border-emerald-500/10 bg-emerald-500/[0.04]">
            <span className="text-[10px] font-bold text-emerald-400 tracking-widest">🟢 LONG</span>
            <span className="text-[9px] text-white/30 ml-2">{summary.bullCount}/5 TFs bullish</span>
          </div>
          <table className="w-full">
            <ColHeader />
            <tbody>
              {tfData.map(d => (
                <TFRow key={d.label} label={d.label} bias={d.bias} zone={d.demands[0]} support={d.supports[0]} hasOB={d.hasOB} hasFVG={d.hasFVG} side="long" />
              ))}
            </tbody>
          </table>
        </div>

        {/* SHORT side */}
        <div className="flex-1">
          <div className="px-3 py-1 border-b border-red-500/10 bg-red-500/[0.04]">
            <span className="text-[10px] font-bold text-red-400 tracking-widest">🔴 SHORT</span>
            <span className="text-[9px] text-white/30 ml-2">{summary.bearCount}/5 TFs bearish</span>
          </div>
          <table className="w-full">
            <ColHeader />
            <tbody>
              {tfData.map(d => (
                <TFRow key={d.label} label={d.label} bias={d.bias} zone={d.supplies[0]} support={d.resistances[0]} hasOB={d.hasOB} hasFVG={d.hasFVG} side="short" />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Summary row ── */}
      <div className="flex border-t border-white/10 min-w-[900px]">
        <div className="flex-1 px-3 py-1.5 border-r border-white/[0.06] bg-emerald-500/[0.03]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-emerald-400 uppercase">Best Buy Area</span>
            <span className="text-yellow-400 text-[11px] leading-none">{stars(summary.buyConf)}</span>
          </div>
          {summary.bestBuy ? (
            <div className="text-[10px] font-mono mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="text-emerald-300">{fmt(summary.bestBuy.bottom)} → {fmt(summary.bestBuy.top)}</span>
              <span className={statusColor(summary.bestBuy.status)}>{statusLabel(summary.bestBuy.status)}</span>
              <span className="text-white/30">{summary.bullCount > 0 ? `${summary.bullCount}/5 TFs bullish` : "no TF alignment"}</span>
              {currentPrice > 0 && <span className="text-white/25">{distanceLabel(summary.bestBuy.top, summary.bestBuy.bottom, currentPrice)}</span>}
            </div>
          ) : (
            <div className="text-[10px] text-white/20 font-mono mt-0.5">No active demand zone above current price</div>
          )}
        </div>
        <div className="flex-1 px-3 py-1.5 bg-red-500/[0.03]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-red-400 uppercase">Best Sell Area</span>
            <span className="text-yellow-400 text-[11px] leading-none">{stars(summary.sellConf)}</span>
          </div>
          {summary.bestSell ? (
            <div className="text-[10px] font-mono mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="text-red-300">{fmt(summary.bestSell.bottom)} → {fmt(summary.bestSell.top)}</span>
              <span className={statusColor(summary.bestSell.status)}>{statusLabel(summary.bestSell.status)}</span>
              <span className="text-white/30">{summary.bearCount > 0 ? `${summary.bearCount}/5 TFs bearish` : "no TF alignment"}</span>
              {currentPrice > 0 && <span className="text-white/25">{distanceLabel(summary.bestSell.top, summary.bestSell.bottom, currentPrice)}</span>}
            </div>
          ) : (
            <div className="text-[10px] text-white/20 font-mono mt-0.5">No active supply zone below current price</div>
          )}
        </div>
      </div>
    </div>
  );
}