import { useMemo, useEffect, useState } from "react";
import { useMTFBias, useTradingAnalysis, useNewsStatus, useSRLevels } from "./use-trading-api";
import { detectOrderBlocks, detectFVGs, pipSize } from "@/components/TradingChart";

function phaseGood(b4h: string, b1h: string, b15: string): boolean {
  if (b4h === "neutral") return false;
  const opp = b4h === "bullish" ? "bearish" : "bullish";
  if (b1h === b4h && (b15 === opp || b15 === "neutral")) return true;
  if ((b1h === opp || b1h === "neutral") && b15 === b4h) return true;
  return false;
}

export function useFrameworkCheck(symbol: string) {
  const { data: mtf }     = useMTFBias(symbol);
  const { data: data1h }  = useTradingAnalysis(symbol, "1h",  150);
  const { data: data15m } = useTradingAnalysis(symbol, "15m", 200);
  const { data: data5m }  = useTradingAnalysis(symbol, "5m",  100);
  const { data: news }    = useNewsStatus();
  const { data: srLevels } = useSRLevels(symbol);
  const [stickyReady, setStickyReady] = useState(false);

  const status = useMemo(() => {
    const price   = mtf?.bias_4h.current_price ?? 0;
    const bias4h  = mtf?.bias_4h.trend  ?? "neutral";
    const bias1h  = mtf?.bias_1h.trend  ?? "neutral";
    const bias15m = mtf?.bias_15m.trend ?? "neutral";
    const pip     = pipSize(price);
    const isBull  = bias4h === "bullish";
    const dir     = bias4h;
    const hasDir  = bias4h !== "neutral";

    if (!hasDir || !price) return { limit_ready: false };

    const newsBlocked = (() => {
      if (!news?.per_pair) return false;
      const key = Object.keys(news.per_pair).find(
        k => k === symbol || k.replace("/","") === symbol.replace("/","")
      );
      return key ? news.per_pair[key].blocked : false;
    })();

    const ob1h = data1h?.candles?.length
      ? detectOrderBlocks(data1h.candles, price).find(o => o.type === dir) ?? null
      : null;

    const fvg1h = data1h?.candles?.length
      ? detectFVGs(data1h.candles, price).find(f => f.type === dir) ?? null
      : null;

    const zone1h = (() => {
      if (!data1h?.zones?.length) return null;
      const maxDist = 80 * pip;
      return data1h.zones
        .filter((z: any) => {
          const center = (z.top + z.bottom) / 2;
          const inDir = isBull ? center < price : center > price;
          return inDir && Math.abs(center - price) <= maxDist;
        })
        .sort((a: any, b: any) =>
          Math.abs((a.top+a.bottom)/2 - price) - Math.abs((b.top+b.bottom)/2 - price)
        )[0] ?? null;
    })();

    const has1hZone = ob1h !== null || fvg1h !== null || zone1h !== null;

    const zone = ob1h ?? fvg1h ?? zone1h;
    const zoneWidth = zone ? zone.top - zone.bottom : 0;
    const entryP = zone
      ? (isBull ? zone.bottom + zoneWidth * 0.30 : zone.top - zoneWidth * 0.30)
      : price;

    const ob15m = data15m?.candles?.length
      ? detectOrderBlocks(data15m.candles, price).find(o => o.type === dir) ?? null
      : null;
    const fvg15m = data15m?.candles?.length
      ? detectFVGs(data15m.candles, price).find(f => f.type === dir) ?? null
      : null;

    const slBuffer = Math.max(10 * pip, zoneWidth * 0.25);
    const zone15   = ob15m ?? fvg15m;
    const sl1h     = zone ? (isBull ? zone.bottom - slBuffer : zone.top + slBuffer) : price;
    let slP = sl1h;
    if (zone15) {
      const sl15m = isBull ? zone15.bottom - 5 * pip : zone15.top + 5 * pip;
      slP = isBull ? Math.min(sl1h, sl15m) : Math.max(sl1h, sl15m);
    }

    const hi = mtf?.bias_4h.last_high_price as number | undefined;
    const lo = mtf?.bias_4h.last_low_price  as number | undefined;
    const srData = srLevels?.levels ?? [];
    const srFiltered = srData.filter((l: any) => l.timeframe !== "15m");
    const tpCands = isBull
      ? srFiltered.filter((l: any) => l.kind === "resistance" && l.price > entryP)
          .sort((a: any,b: any) => a.price - b.price)
      : srFiltered.filter((l: any) => l.kind === "support" && l.price < entryP)
          .sort((a: any,b: any) => b.price - a.price);

    const originTp = isBull ? hi : lo;
    const fibFallback = (hi && lo && hi > lo)
      ? (isBull ? hi + 0.618 * (hi - lo) : lo - 0.618 * (hi - lo))
      : isBull ? entryP + (symbol.includes('JPY') ? 60 : 40) * pip
               : entryP - (symbol.includes('JPY') ? 60 : 40) * pip;
    const srTp = tpCands[0]?.price ?? fibFallback;           
    let tpP = srTp;
    if (originTp && ((isBull && originTp > entryP) || (!isBull && originTp < entryP))) {
      tpP = isBull ? Math.max(originTp, srTp) : Math.min(originTp, srTp);
    }

    const risk   = Math.abs(entryP - slP);
    const reward = Math.abs(tpP   - entryP);
    const rr     = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;

    const livePrice = data5m?.candles?.at(-1)?.close ?? price;
    const zoneDistance = zone
      ? (isBull
          ? Math.round((livePrice - zone.top) / pip)
          : Math.round((zone.bottom - livePrice) / pip))
      : 999;

    const zoneStatus = zone
      ? (isBull
          ? livePrice < zone.bottom - 5*pip ? "blown"
            : livePrice < zone.top  + 5*pip ? "entering" : "approaching"
          : livePrice > zone.top   + 5*pip ? "blown"
            : livePrice > zone.bottom - 5*pip ? "entering" : "approaching")
      : "none";

    const limit_ready =
      hasDir &&
      has1hZone &&
      zoneStatus !== "blown" &&
      zoneDistance <= 50 &&
      !newsBlocked &&
      rr >= (stickyReady ? 2.0 : 2.5);

    return {
      limit_ready,
      direction:          bias4h,
      limit_rr:           rr,
      limit_entry:        Math.round(entryP * 100000) / 100000,
      limit_sl:           Math.round(slP    * 100000) / 100000,
      limit_tp:           Math.round(tpP    * 100000) / 100000,
      limit_zone_status:  zoneStatus,
      phase_good:         phaseGood(bias4h, bias1h, bias15m),
      has_15m_confluence: (ob15m !== null && ob15m.type === dir) || (fvg15m !== null && fvg15m.type === dir),
      retrace_pct: (() => {
        const leg = (hi ?? 0) - (lo ?? 0);
        if (!hi || !lo || leg <= 0) return null;
        const raw = isBull ? ((hi - price) / leg) * 100 : ((price - lo) / leg) * 100;
        return Math.round(raw);
      })(),
};
}, [mtf, data1h, data15m, data5m, news, srLevels, symbol, stickyReady]);
useEffect(() => {
  setStickyReady(status.limit_ready);
}, [status.limit_ready]);
  return status;
}
