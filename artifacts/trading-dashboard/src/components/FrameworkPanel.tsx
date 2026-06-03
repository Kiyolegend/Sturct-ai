/**
 * FrameworkPanel — replaces Market Environment.
 * Walks through SCALP or LIMIT framework step-by-step
 * using live STRUCT.ai data for the active symbol.
 *
 * Stale-price / invalidation guards:
 *  - scalp_chasing    → BOS trigger is >20 pips behind current price (do not chase)
 *  - scalp_tp_hit     → price already reached TP before entry (setup missed)
 *  - limit_zone_status→ "approaching" | "entering" | "blown" (price passed through zone)
 * Price used for drift is data5m.current_price (60s refresh) not MTF bias (5min refresh).
 */

import React, { useState, useMemo } from "react";
import {
  useMTFBias,
  useSRLevels,
  useTradingAnalysis,
  useNewsStatus,
} from "@/hooks/use-trading-api";
import { detectOrderBlocks, detectFVGs, pipSize } from "@/components/TradingChart";

type Mode = "scalp" | "limit";
type Bias = "bullish" | "bearish" | "neutral";
type ZoneStatus = "approaching" | "entering" | "blown" | "none";

interface Props {
  symbol: string;
}

function strengthInfo(conf: number): { label: string; color: string; caution: boolean } {
  if (conf >= 82) return { label: "Extended",   color: "#f59e0b", caution: true  };
  if (conf >= 65) return { label: "Strong",     color: "#26a69a", caution: false };
  if (conf >= 45) return { label: "Developing", color: "#94a3b8", caution: false };
  return              { label: "Early",       color: "#475569", caution: false };
}

function phaseInfo(b4h: Bias, b1h: Bias, b15: Bias): { label: string; color: string; good: boolean } {
  if (b4h === "neutral") return { label: "No 4H trend", color: "#475569", good: false };
  const opp = b4h === "bullish" ? "bearish" : "bullish";
  if (b1h === b4h && b15 === b4h)
    return { label: "Impulse — all TFs aligned, wait for pullback to begin", color: "#f59e0b", good: false };
  if (b1h === b4h && (b15 === opp || b15 === "neutral"))
    return { label: "Pullback early stage — 15M turning, 1H still with trend", color: "#4ade80", good: true };
  if ((b1h === opp || b1h === "neutral") && b15 === b4h)
    return { label: "Pullback late stage — 1H deep, 15M recovering — prime window", color: "#4ade80", good: true };
  if (b1h === opp && b15 === opp)
    return { label: "Pullback mid-stage — 1H & 15M both correcting, wait", color: "#f59e0b", good: false };
  return { label: "Mixed signals — wait for clarity", color: "#475569", good: false };
}

function Step({ num, tf, title, met, children }: {
  num: number; tf: string; title: string; met: boolean | null; children: React.ReactNode;
}) {
  const bg = met === true ? "#26a69a" : met === false ? "#374151" : "#1f2937";
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <span style={{
          width: 15, height: 15, borderRadius: "50%", background: bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 7, fontWeight: 700, color: "#0a0e17", flexShrink: 0,
          boxShadow: met === true ? "0 0 6px #26a69a88" : "none",
        }}>{num}</span>
        <span style={{ fontSize: 7, fontWeight: 700, color: "#374151", letterSpacing: "0.1em" }}>{tf}</span>
        <span style={{ fontSize: 7.5, fontWeight: 700, color: "#475569" }}>{title}</span>
      </div>
      <div style={{ paddingLeft: 21 }}>{children}</div>
    </div>
  );
}

export function FrameworkPanel({ symbol }: Props) {
  const [mode, setMode] = useState<Mode>("scalp");

  const { data: mtf }      = useMTFBias(symbol);
  const { data: srData }   = useSRLevels(symbol);
  const { data: news }     = useNewsStatus();
  const { data: data1h }   = useTradingAnalysis(symbol, "1h",  150);
  const { data: data15m }  = useTradingAnalysis(symbol, "15m", 200);
  const { data: data5m }   = useTradingAnalysis(symbol, "5m",  100);

  const bias4h  = (mtf?.bias_4h.trend  ?? "neutral") as Bias;
  const bias1h  = (mtf?.bias_1h.trend  ?? "neutral") as Bias;
  const bias15m = (mtf?.bias_15m.trend ?? "neutral") as Bias;
  const conf4h  = mtf?.bias_4h.confidence ?? 0;

  // price: used for all SL/TP/entry calculations (MTF bias, 5min refresh)
  // livePrice: used for drift/invalidation checks (data5m, 60s refresh — more current)
  const price     = mtf?.bias_4h.current_price ?? 0;
  const livePrice = data5m?.candles?.at(-1)?.close ?? price;
  const pip       = pipSize(price);

  const strength = strengthInfo(conf4h);
  const phase    = phaseInfo(bias4h, bias1h, bias15m);
  const isBull   = bias4h === "bullish";
  const dir      = bias4h;
  const hasDir   = bias4h !== "neutral";
  const dirColor = isBull ? "#26a69a" : "#ef5350";

  const retraceInfo = useMemo(() => {
    const hi = mtf?.bias_4h.last_high_price as number | undefined;
    const lo = mtf?.bias_4h.last_low_price  as number | undefined;
    if (!hi || !lo || !price || !hasDir) return null;
    const legSize = hi - lo;
    if (legSize < 10 * pip) return null;
    // pct: 0% = price at the swing extreme (no retrace), 100% = fully retraced
    // negative = impulse extending beyond last swing
    const rawPct = isBull
      ? ((hi - price) / legSize) * 100
      : ((price - lo) / legSize) * 100;
    const pct = Math.round(rawPct);
    if (pct < 0) {
      const ext = Math.abs(pct);
      return {
        text:  `Impulse +${ext}% beyond last swing`,
        color: ext > 30 ? "#f59e0b" : "#94a3b8",
        kind:  "impulse" as const,
      };
    }
    let text: string; let color: string;
    if      (pct < 20) { text = `Pullback ${pct}% — early, just started`;     color = "#94a3b8"; }
    else if (pct < 38) { text = `Pullback ${pct}% — shallow, 38% zone`;       color = "#4ade80"; }
    else if (pct < 55) { text = `Pullback ${pct}% — mid-zone ★ 50–61% ideal`; color = "#26a69a"; }
    else if (pct < 72) { text = `Pullback ${pct}% — deep, 78% zone`;          color = "#4ade80"; }
    else if (pct < 90) { text = `Pullback ${pct}% — very deep, near full`;    color = "#f59e0b"; }
    else               { text = `Pullback ${pct}% — extreme, trend risk`;     color = "#ef5350"; }
    return { text, color, kind: "pullback" as const };
  }, [mtf, price, isBull, hasDir, pip]);

  const newsBlocked = useMemo(() => {
    if (!news?.per_pair) return false;
    const key = Object.keys(news.per_pair).find(k => k === symbol || k.replace("/","") === symbol.replace("/",""));
    return key ? news.per_pair[key].blocked : false;
  }, [news, symbol]);

  const ob1h = useMemo(() => {
    if (!data1h?.candles?.length || !price) return null;
    const obs = detectOrderBlocks(data1h.candles, price);
    return obs.find(o => o.type === dir) ?? null;
  }, [data1h, price, dir]);

  const fvg1h = useMemo(() => {
    if (!data1h?.candles?.length || !price) return null;
    const fvgs = detectFVGs(data1h.candles, price);
    return fvgs.find(f => f.type === dir) ?? null;
  }, [data1h, price, dir]);

  const ob15m = useMemo(() => {
    if (!data15m?.candles?.length || !price) return null;
    const obs = detectOrderBlocks(data15m.candles, price);
    return obs.find(o => o.type === dir) ?? null;
  }, [data15m, price, dir]);

  const fvg15m = useMemo(() => {
    if (!data15m?.candles?.length || !price) return null;
    const fvgs = detectFVGs(data15m.candles, price);
    return fvgs.find(f => f.type === dir) ?? null;
  }, [data15m, price, dir]);

  const zone1h = useMemo(() => {
    if (!data1h?.zones?.length || !price || !hasDir) return null;
    const maxDist = 80 * pip;
    return data1h.zones
      .filter((z: any) => {
        const center = (z.top + z.bottom) / 2;
        const inDir = isBull ? center < price : center > price;
        return inDir && Math.abs(center - price) <= maxDist;
      })
      .sort((a: any, b: any) => {
        const da = Math.abs((a.top + a.bottom) / 2 - price);
        const db = Math.abs((b.top + b.bottom) / 2 - price);
        return da - db;
      })[0] ?? null;
  }, [data1h, price, isBull, hasDir, pip]);

  const choch15m = useMemo(() => {
    if (!data15m?.choch) return null;
    const now = Math.floor(Date.now() / 1000);
    return data15m.choch
      .filter((c: any) => c.direction === dir && c.time >= now - 3 * 3600)
      .sort((a: any, b: any) => b.time - a.time)[0] ?? null;
  }, [data15m, dir]);

  const bos15m = useMemo(() => {
    if (!data15m?.bos) return null;
    const now = Math.floor(Date.now() / 1000);
    return data15m.bos
      .filter((b: any) => b.direction === dir && b.time >= now - 2 * 3600)
      .sort((a: any, b: any) => b.time - a.time)[0] ?? null;
  }, [data15m, dir]);

  const bos5m = useMemo(() => {
    if (!data5m?.bos) return null;
    const now = Math.floor(Date.now() / 1000);
    return data5m.bos
      .filter((b: any) => b.direction === dir && b.time >= now - 30 * 60)
      .sort((a: any, b: any) => b.time - a.time)[0] ?? null;
  }, [data5m, dir]);

  const sl5m = useMemo(() => {
    if (!data5m?.structure_labels?.length || !hasDir) return null;
    const labels = isBull
      ? data5m.structure_labels.filter((s: any) => s.label === "HL" || s.label === "EQL" || s.label === "LL")
      : data5m.structure_labels.filter((s: any) => s.label === "LH" || s.label === "EQH" || s.label === "HH");

    if (!labels.length) return null;
    return (labels[labels.length - 1]?.price as number) ?? null;
  }, [data5m, isBull, hasDir]);

  const hunting1hBounds = useMemo(() => {
    const zones = [ob1h, fvg1h, zone1h].filter(Boolean) as { top: number; bottom: number }[];
    if (!zones.length) return null;
    return {
      bottom: Math.min(...zones.map(z => z.bottom)),
      top:    Math.max(...zones.map(z => z.top)),
    };
  }, [ob1h, fvg1h, zone1h]);

  const ob15mInZone = useMemo(() => {
    if (!ob15m || !hunting1hBounds) return false;
    return ob15m.top >= hunting1hBounds.bottom && ob15m.bottom <= hunting1hBounds.top;
  }, [ob15m, hunting1hBounds]);

  const fvg15mInZone = useMemo(() => {
    if (!fvg15m || !hunting1hBounds) return false;
    return fvg15m.top >= hunting1hBounds.bottom && fvg15m.bottom <= hunting1hBounds.top;
  }, [fvg15m, hunting1hBounds]);

  const setup = useMemo(() => {
    if (!price || !hasDir) return null;
    const zone = mode === "limit" ? (ob1h ?? fvg1h ?? zone1h) : null;
    const entryP = zone ? (isBull ? zone.bottom : zone.top) : price;

    const slLow  = mtf?.bias_15m.last_low_price;
    const slHigh = mtf?.bias_15m.last_high_price;
    let slP: number;
    if (mode === "limit" && zone) {
      const zone15m = ob15m ?? fvg15m;
      const sl1h = isBull ? zone.bottom - 10 * pip : zone.top + 10 * pip;
      if (zone15m) {
        const sl15m = isBull ? zone15m.bottom - 5 * pip : zone15m.top + 5 * pip;
        slP = isBull ? Math.min(sl1h, sl15m) : Math.max(sl1h, sl15m);
      } else {
        slP = sl1h;
      }
    } else {
      slP = isBull
        ? (sl5m  ? sl5m  - 3 * pip : slLow  ? slLow  - 3 * pip : entryP - 20 * pip)
        : (sl5m  ? sl5m  + 3 * pip : slHigh ? slHigh + 3 * pip : entryP + 20 * pip);
      if (isBull  && slP >= entryP) slP = entryP - 20 * pip;
      if (!isBull && slP <= entryP) slP = entryP + 20 * pip;
      const zoneCheck = ob1h ?? fvg1h ?? zone1h;
      if (zoneCheck) {
        if (isBull  && slP > zoneCheck.bottom) slP = zoneCheck.bottom - 3 * pip;
        if (!isBull && slP < zoneCheck.top)    slP = zoneCheck.top    + 3 * pip;
      }
    }

    const levels = (srData?.levels ?? []).filter((l: any) => l.timeframe !== "15m");
    const tpLevel = isBull
      ? levels.filter((l: any) => l.kind === "resistance" && l.price > entryP).sort((a: any, b: any) => a.price - b.price)[0]
      : levels.filter((l: any) => l.kind === "support"    && l.price < entryP).sort((a: any, b: any) => b.price - a.price)[0];
    const tpP = tpLevel
      ? tpLevel.price
      : isBull ? entryP + 60 * pip : entryP - 60 * pip;

    const risk   = Math.abs(entryP - slP);
    const reward = Math.abs(tpP - entryP);
    const rr     = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;
    return { entry: entryP, sl: slP, tp: tpP, rr };
  }, [price, hasDir, isBull, ob1h, fvg1h, zone1h, ob15m, fvg15m, sl5m, mtf, srData, pip, mode]);

  // ── STALE PRICE / INVALIDATION GUARDS ────────────────────────────────────────

  const scalp_drift = useMemo(() => {
    if (!bos5m || !livePrice) return 0;
    return Math.round(Math.abs(livePrice - bos5m.price) / pip);
  }, [bos5m, livePrice, pip]);

  const scalp_chasing = scalp_drift > 20;

  const scalp_tp_hit = useMemo(() => {
    if (!setup || !livePrice) return false;
    return isBull ? livePrice >= setup.tp : livePrice <= setup.tp;
  }, [setup, livePrice, isBull]);

  const limit_zone_status = useMemo((): ZoneStatus => {
    if (mode !== "limit" || !livePrice) return "none";
    const zone = ob1h ?? fvg1h ?? zone1h;
    if (!zone) return "none";
    if (isBull) {
      if (livePrice < zone.bottom - 5 * pip) return "blown";
      if (livePrice < zone.top    + 5 * pip) return "entering";
      return "approaching";
    } else {
      if (livePrice > zone.top    + 5 * pip) return "blown";
      if (livePrice > zone.bottom - 5 * pip) return "entering";
      return "approaching";
    }
  }, [mode, livePrice, ob1h, fvg1h, zone1h, isBull, pip]);

    // How many pips price has moved AWAY from the 1H zone (positive = further away)
  const limit_zone_distance = useMemo(() => {
    if (mode !== "limit" || !livePrice) return 0;
    const zone = ob1h ?? fvg1h ?? zone1h;
    if (!zone) return 0;
    return isBull
      ? Math.round((livePrice - zone.top) / pip)
      : Math.round((zone.bottom - livePrice) / pip);
  }, [mode, livePrice, ob1h, fvg1h, zone1h, isBull, pip]);

  const limit_out_of_reach = limit_zone_distance > 50;

  // ── READY FLAGS ───────────────────────────────────────────────────────────────
  const scalp_signal_ok = !scalp_chasing && !scalp_tp_hit;
  const scalp_ready = hasDir && phase.good && (ob1h !== null || fvg1h !== null || zone1h !== null) &&
    (choch15m !== null || bos15m !== null) && bos5m !== null && scalp_signal_ok && !newsBlocked && (setup?.rr ?? 0) >= 2.5;

  const limit_ready = hasDir && phase.good && (ob1h !== null || fvg1h !== null || zone1h !== null) &&
    (ob15mInZone || fvg15mInZone) && limit_zone_status !== "blown" && !limit_out_of_reach && !newsBlocked && (setup?.rr ?? 0) >= 2.5;

  const ready = mode === "scalp" ? scalp_ready : limit_ready;

  const fmt  = (p: number) => p >= 50 ? p.toFixed(3) : p.toFixed(5);
  const pips = (a: number, b: number) => Math.round(Math.abs(a - b) / pip);
  const ago  = (t: number) => Math.round((Date.now() / 1000 - t) / 60);

  const invalidReason: string | null = useMemo(() => {
    if (mode === "scalp") {
      if (scalp_tp_hit)   return "SETUP MISSED — TP level already reached before entry";
      if (scalp_chasing)  return `DO NOT TRADE — price drifted ${scalp_drift}p from signal, chasing`;
    }
    if (mode === "limit") {
      if (limit_zone_status === "blown") return "ZONE BLOWN — price passed through zone, setup invalidated";
      if (limit_out_of_reach) return `ZONE OUT OF REACH — price moved ${limit_zone_distance}p from zone, do not chase`;
    }
    return null;
  }, [mode, scalp_tp_hit, scalp_chasing, scalp_drift, limit_zone_status, limit_out_of_reach, limit_zone_distance]);

  return (
    <div style={{
      background: "#0a0e17",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      padding: "8px 10px 8px",
      fontFamily: "'Roboto Mono', monospace",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 7.5, fontWeight: 700, color: "#475569", letterSpacing: "0.1em" }}>
          FRAMEWORK
        </span>
        <div style={{ display: "flex", gap: 3 }}>
          {(["scalp", "limit"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "2px 7px", borderRadius: 3, cursor: "pointer",
              border:   `1px solid ${mode === m ? "#3b82f6" : "rgba(255,255,255,0.08)"}`,
              background: mode === m ? "rgba(59,130,246,0.2)" : "transparent",
              color:    mode === m ? "#93c5fd" : "#374151",
              fontSize: 7, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const,
            }}>{m}</button>
          ))}
        </div>
      </div>

      {newsBlocked && (
        <div style={{
          background: "rgba(239,83,80,0.1)", border: "1px solid rgba(239,83,80,0.3)",
          borderRadius: 3, padding: "4px 7px", marginBottom: 8,
          fontSize: 7, color: "#ef5350", fontWeight: 700,
        }}>⛔ NEWS BLOCK — Do not trade</div>
      )}

      {!hasDir && (
        <div style={{ fontSize: 7, color: "#374151", paddingBottom: 4 }}>
          4H has no clear bias — framework inactive.
        </div>
      )}

      {hasDir && (
        <>
          {/* ── SCALP ─────────────────────────────── */}
          {mode === "scalp" && (
            <>
              <Step num={1} tf="4H" title="DIRECTION" met={true}>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: dirColor }}>
                  {isBull ? "BULLISH" : "BEARISH"}
                  <span style={{ color: strength.color, fontWeight: 400, fontSize: 7.5 }}>
                    {" "}— {strength.label}
                  </span>
                </div>
                <div style={{ fontSize: 7, color: phase.color, marginTop: 2 }}>{phase.label}</div>
                {retraceInfo && (
                  <div style={{ fontSize: 6.5, color: retraceInfo.color, marginTop: 1 }}>
                    {retraceInfo.text}
                  </div>
                )}
                {strength.caution && (
                  <div style={{ fontSize: 6.5, color: "#f59e0b", marginTop: 2 }}>
                    ⚠ Extended — reduce position size
                  </div>
                )}
              </Step>

              <Step num={2} tf="1H" title="LOCATION" met={ob1h !== null || fvg1h !== null || zone1h !== null}>
                {ob1h && (
                  <div style={{ fontSize: 7.5, color: "#26a69a" }}>
                    OB {fmt(ob1h.bottom)}–{fmt(ob1h.top)}
                    <span style={{ color: "#374151", fontSize: 7 }}> {pips((ob1h.top + ob1h.bottom) / 2, price)}p away</span>
                  </div>
                )}
                {fvg1h && (
                  <div style={{ fontSize: 7.5, color: "#4ade80" }}>
                    FVG {fmt(fvg1h.bottom)}–{fmt(fvg1h.top)}
                  </div>
                )}
                {zone1h && (
                  <div style={{ fontSize: 7.5, color: "#a78bfa" }}>
                    S/D {fmt(zone1h.bottom)}–{fmt(zone1h.top)}
                    <span style={{ color: "#374151", fontSize: 7 }}> {zone1h.touches} touches</span>
                  </div>
                )}
                {!ob1h && !fvg1h && !zone1h && (
                  <div style={{ fontSize: 7, color: "#374151" }}>No 1H zone nearby — wait</div>
                )}
              </Step>

              <Step num={3} tf="15M" title="CONFIRMATION" met={choch15m !== null || bos15m !== null}>
                {choch15m ? (
                  <div style={{ fontSize: 7.5, color: "#26a69a" }}>
                    CHoCH {choch15m.direction} — {ago(choch15m.time)}m ago ✓
                  </div>
                ) : bos15m ? (
                  <div style={{ fontSize: 7.5, color: "#4ade80" }}>
                    BOS {bos15m.direction} — {ago(bos15m.time)}m ago ✓
                  </div>
                ) : (
                  <div style={{ fontSize: 7, color: "#374151" }}>Waiting for 15M CHoCH or BOS…</div>
                )}
              </Step>

              <Step num={4} tf="5M" title="ENTRY TRIGGER" met={bos5m !== null && !scalp_chasing && !scalp_tp_hit}>
                {bos5m ? (
                  <>
                    <div style={{ fontSize: 7.5, color: scalp_chasing ? "#ef5350" : scalp_tp_hit ? "#f59e0b" : "#26a69a" }}>
                      BOS {bos5m.direction} — {ago(bos5m.time)}m ago
                      {" "}
                      {scalp_chasing
                        ? `⚠ +${scalp_drift}p drift`
                        : scalp_tp_hit
                        ? "⚠ TP hit"
                        : "✓"}
                    </div>
                    <div style={{ fontSize: 6.5, color: "#374151", marginTop: 2 }}>
                      Triggered @ {fmt(bos5m.price)} · SL anchored to {sl5m ? "5M" : "15M"} swing {isBull ? "low" : "high"}
                    </div>
                    {scalp_chasing && (
                      <div style={{ fontSize: 6.5, color: "#ef5350", marginTop: 2 }}>
                        Price moved {scalp_drift}p since trigger — do not chase
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 7, color: "#374151" }}>Waiting for 5M BOS…</div>
                )}
              </Step>
            </>
          )}

          {/* ── LIMIT ─────────────────────────────── */}
          {mode === "limit" && (
            <>
              <Step num={1} tf="4H" title="STORY" met={true}>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: dirColor }}>
                  {isBull ? "BULLISH" : "BEARISH"}
                  <span style={{ color: strength.color, fontWeight: 400, fontSize: 7.5 }}>
                    {" "}— {strength.label}
                  </span>
                </div>
                <div style={{ fontSize: 7, color: phase.color, marginTop: 2 }}>{phase.label}</div>
                {retraceInfo && (
                  <div style={{ fontSize: 6.5, color: retraceInfo.color, marginTop: 1 }}>
                    {retraceInfo.text}
                  </div>
                )}
                <div style={{ fontSize: 6.5, color: "#374151", marginTop: 3 }}>
                  {isBull ? "→ Find where pullback ends" : "→ Find where bounce ends"}
                </div>
              </Step>

              <Step num={2} tf="1H" title="HUNTING ZONE" met={ob1h !== null || fvg1h !== null || zone1h !== null}>
                {(ob1h || fvg1h || zone1h) ? (
                  <>
                    {ob1h && (
                      <div style={{ fontSize: 7.5, color: isBull ? "#26a69a" : "#ef5350" }}>
                        OB @ {fmt(ob1h.bottom)}–{fmt(ob1h.top)}
                        {fvg1h  && <span style={{ color: "#f59e0b" }}> + FVG overlap ★</span>}
                        {zone1h && <span style={{ color: "#a78bfa" }}> + S/D ★</span>}
                      </div>
                    )}
                    {!ob1h && fvg1h && (
                      <div style={{ fontSize: 7.5, color: "#4ade80" }}>
                        FVG @ {fmt(fvg1h.bottom)}–{fmt(fvg1h.top)}
                        {zone1h && <span style={{ color: "#a78bfa" }}> + S/D ★</span>}
                      </div>
                    )}
                    {!ob1h && !fvg1h && zone1h && (
                      <div style={{ fontSize: 7.5, color: "#a78bfa" }}>
                        S/D @ {fmt(zone1h.bottom)}–{fmt(zone1h.top)}
                        <span style={{ color: "#374151", fontSize: 7 }}> {zone1h.touches} touches</span>
                      </div>
                    )}
                    {limit_zone_status === "approaching" && (
                      <div style={{ fontSize: 6.5, color: "#374151", marginTop: 2 }}>
                        Price approaching zone — limit pending
                      </div>
                    )}
                    {limit_zone_status === "entering" && (
                      <div style={{ fontSize: 6.5, color: "#4ade80", marginTop: 2 }}>
                        ▶ Price entering zone — monitor for fill
                      </div>
                    )}
                    {limit_zone_status === "blown" && (
                      <div style={{ fontSize: 6.5, color: "#ef5350", marginTop: 2 }}>
                        ✕ Price blew through zone — setup invalidated
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 7, color: "#374151" }}>No 1H zone — wait for pullback</div>
                )}
              </Step>

              <Step num={3} tf="15M" title="PRECISION ENTRY" met={(ob15m !== null && ob15mInZone) || (fvg15m !== null && fvg15mInZone)}>
                {ob15m && ob15mInZone && (
                  <div style={{ fontSize: 7.5, color: "#26a69a" }}>
                    15M OB @ {fmt(ob15m.bottom)}–{fmt(ob15m.top)} ✓
                  </div>
                )}
                {!ob15mInZone && fvg15m && fvg15mInZone && (
                  <div style={{ fontSize: 7.5, color: "#4ade80" }}>
                    15M FVG @ {fmt(fvg15m.bottom)}–{fmt(fvg15m.top)} ✓
                  </div>
                )}
                {ob15m && !ob15mInZone && (
                  <div style={{ fontSize: 7, color: "#f59e0b" }}>
                    ⚠ 15M OB @ {fmt(ob15m.bottom)}–{fmt(ob15m.top)} — outside 1H zone, skip
                  </div>
                )}
                {!ob15m && fvg15m && !fvg15mInZone && (
                  <div style={{ fontSize: 7, color: "#f59e0b" }}>
                    ⚠ 15M FVG @ {fmt(fvg15m.bottom)}–{fmt(fvg15m.top)} — outside 1H zone, skip
                  </div>
                )}
                {!ob15m && !fvg15m && (ob1h || fvg1h || zone1h) && (
                  <div style={{ fontSize: 7, color: "#374151" }}>
                    No 15M zone — place limit at{" "}
                    <span style={{ color: "#94a3b8" }}>
                      {ob1h
                        ? fmt(isBull ? ob1h.bottom : ob1h.top)
                        : fvg1h
                        ? fmt(isBull ? fvg1h.bottom : fvg1h.top)
                        : zone1h
                        ? fmt(isBull ? zone1h.bottom : zone1h.top)
                        : "—"}
                    </span>
                  </div>
                )}
                {!ob15m && !fvg15m && !ob1h && !fvg1h && !zone1h && (
                  <div style={{ fontSize: 7, color: "#374151" }}>Waiting for 1H zone first</div>
                )}
              </Step>
            </>
          )}

          {/* ── Trade Setup Box ───────────────────────── */}
          {setup && (
            <div style={{
              marginTop: 8,
              background: invalidReason
                ? "rgba(239,83,80,0.06)"
                : ready
                ? "rgba(38,166,154,0.07)"
                : "rgba(255,255,255,0.02)",
              border: `1px solid ${
                invalidReason
                  ? "rgba(239,83,80,0.35)"
                  : ready
                  ? "rgba(38,166,154,0.3)"
                  : "rgba(255,255,255,0.06)"
              }`,
              borderRadius: 4,
              padding: "7px 8px",
            }}>
              <div style={{
                fontSize: 7, fontWeight: 700, letterSpacing: "0.08em",
                color: invalidReason ? "#ef5350" : ready ? dirColor : "#374151",
                textTransform: "uppercase" as const,
                marginBottom: invalidReason ? 4 : 6,
              }}>
                {invalidReason
                  ? `⚠ ${invalidReason}`
                  : ready
                  ? (isBull ? "▲ Long setup ready" : "▼ Short setup ready")
                  : "Setup developing — conditions incomplete"}
              </div>

              {!invalidReason && mode === "limit" && limit_zone_status === "entering" && (
                <div style={{
                  fontSize: 6.5, color: "#4ade80", fontWeight: 700,
                  marginBottom: 5, letterSpacing: "0.06em",
                }}>
                  ▶ PRICE IN ZONE — check if limit filled
                </div>
              )}

              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4,
                opacity: invalidReason ? 0.35 : 1,
              }}>
                {[
                  { label: mode === "limit" ? "LIMIT" : "ENTRY", value: fmt(setup.entry), color: dirColor  },
                  { label: "SL",                                  value: fmt(setup.sl),    color: "#ef5350" },
                  { label: "TP",                                  value: fmt(setup.tp),    color: "#26a69a" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 6, color: "#374151", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: "0.02em" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{
                marginTop: 5, display: "flex",
                justifyContent: "space-between", alignItems: "center",
                opacity: invalidReason ? 0.35 : 1,
              }}>
                <span style={{ fontSize: 6.5, color: "#374151" }}>
                  SL {pips(setup.entry, setup.sl)}p · TP {pips(setup.entry, setup.tp)}p
                </span>
                <span style={{
                  fontSize: 7.5, fontWeight: 700,
                  color: setup.rr >= 2.5 ? "#26a69a" : setup.rr >= 1.5 ? "#f59e0b" : "#ef5350",
                }}>
                  1:{setup.rr}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default FrameworkPanel;