/**
 * FrameworkPanel — replaces Market Environment.
 * Walks through SCALP or LIMIT framework step-by-step
 * using live STRUCT.ai data for the active symbol.
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
    return { label: "Full impulse — all TFs aligned, wait for pullback", color: "#f59e0b", good: false };
  if (b1h === b4h && (b15 === opp || b15 === "neutral"))
    return { label: "Shallow 15M pullback — near entry zone", color: "#4ade80", good: true  };
  if ((b1h === opp || b1h === "neutral") && b15 === b4h)
    return { label: "Deep 1H pullback, 15M recovering — prime window", color: "#4ade80", good: true  };
  if (b1h === opp && b15 === opp)
    return { label: "Strong pullback — not yet confirmed", color: "#f59e0b", good: false };
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
  const price   = mtf?.bias_4h.current_price ?? 0;
  const pip     = pipSize(price);

  const strength = strengthInfo(conf4h);
  const phase    = phaseInfo(bias4h, bias1h, bias15m);
  const isBull   = bias4h === "bullish";
  const dir      = bias4h;
  const hasDir   = bias4h !== "neutral";
  const dirColor = isBull ? "#26a69a" : "#ef5350";

  // News block for this symbol
  const newsBlocked = useMemo(() => {
    if (!news?.per_pair) return false;
    const key = Object.keys(news.per_pair).find(k => k === symbol || k.replace("/","") === symbol.replace("/",""));
    return key ? news.per_pair[key].blocked : false;
  }, [news, symbol]);

  // 1H OB + FVG
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

  // 15M OB + FVG
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

  // 15M CHoCH in trade direction (last 6h)
  const choch15m = useMemo(() => {
    if (!data15m?.choch) return null;
    const now = Math.floor(Date.now() / 1000);
    return data15m.choch
      .filter(c => c.direction === dir && c.time >= now - 6 * 3600)
      .sort((a, b) => b.time - a.time)[0] ?? null;
  }, [data15m, dir]);

  // 5M BOS in trade direction (last 90 min)
  const bos5m = useMemo(() => {
    if (!data5m?.bos) return null;
    const now = Math.floor(Date.now() / 1000);
    return data5m.bos
      .filter(b => b.direction === dir && b.time >= now - 90 * 60)
      .sort((a, b) => b.time - a.time)[0] ?? null;
  }, [data5m, dir]);

  // Trade setup calc
  const setup = useMemo(() => {
    if (!price || !hasDir) return null;
    const zone = mode === "limit" ? (ob1h ?? fvg1h) : null;

    // LIMIT: enter at zone edge (sell top of supply / buy bottom of demand)
    // SCALP: enter at current market price
    const entryP = zone
      ? (isBull ? zone.bottom : zone.top)
      : price;

    // SL calculation
    const slLow  = mtf?.bias_15m.last_low_price;
    const slHigh = mtf?.bias_15m.last_high_price;
    let slP: number;
    if (mode === "limit" && zone) {
      // SL just beyond the zone edge — always guaranteed on correct side
      slP = isBull ? zone.bottom - 10 * pip : zone.top + 10 * pip;
    } else {
      // Scalp: use 15M swing high/low
      slP = isBull
        ? (slLow  ? slLow  - 3 * pip : entryP - 20 * pip)
        : (slHigh ? slHigh + 3 * pip : entryP + 20 * pip);
      // Safety guard: SL must always be on the correct side of entry
      if (isBull  && slP >= entryP) slP = entryP - 20 * pip;
      if (!isBull && slP <= entryP) slP = entryP + 20 * pip;
    }

    const levels = srData?.levels ?? [];
    const tpLevel = isBull
      ? levels.filter(l => l.kind === "resistance" && l.price > entryP).sort((a,b) => a.price - b.price)[0]
      : levels.filter(l => l.kind === "support"    && l.price < entryP).sort((a,b) => b.price - a.price)[0];
    const tpP = tpLevel
      ? tpLevel.price
      : isBull ? entryP + 60 * pip : entryP - 60 * pip;

    const risk   = Math.abs(entryP - slP);
    const reward = Math.abs(tpP - entryP);
    const rr     = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;
    return { entry: entryP, sl: slP, tp: tpP, rr };
  }, [price, hasDir, isBull, ob1h, fvg1h, mtf, srData, pip, mode]);

  const scalp_ready  = hasDir && phase.good && choch15m !== null && bos5m !== null && !newsBlocked;
  const limit_ready  = hasDir && phase.good && (ob1h !== null || fvg1h !== null) && !newsBlocked;
  const ready        = mode === "scalp" ? scalp_ready : limit_ready;

  const fmt  = (p: number) => p >= 10 ? p.toFixed(3) : p.toFixed(5);
  const pips = (a: number, b: number) => Math.round(Math.abs(a - b) / pip);
  const ago  = (t: number) => Math.round((Date.now() / 1000 - t) / 60);

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

      {/* News block */}
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
                {strength.caution && (
                  <div style={{ fontSize: 6.5, color: "#f59e0b", marginTop: 2 }}>
                    ⚠ Extended — reduce position size
                  </div>
                )}
              </Step>

              <Step num={2} tf="1H" title="LOCATION" met={ob1h !== null || fvg1h !== null}>
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
                {!ob1h && !fvg1h && (
                  <div style={{ fontSize: 7, color: "#374151" }}>No 1H OB/FVG nearby — wait</div>
                )}
              </Step>

              <Step num={3} tf="15M" title="CONFIRMATION" met={choch15m !== null}>
                {choch15m ? (
                  <div style={{ fontSize: 7.5, color: "#26a69a" }}>
                    CHoCH {choch15m.direction} — {ago(choch15m.time)}m ago ✓
                  </div>
                ) : (
                  <div style={{ fontSize: 7, color: "#374151" }}>Waiting for 15M CHoCH…</div>
                )}
              </Step>

              <Step num={4} tf="5M" title="ENTRY TRIGGER" met={bos5m !== null}>
                {bos5m ? (
                  <div style={{ fontSize: 7.5, color: "#26a69a" }}>
                    BOS {bos5m.direction} — {ago(bos5m.time)}m ago ✓
                  </div>
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
                <div style={{ fontSize: 6.5, color: "#374151", marginTop: 3 }}>
                  {isBull ? "→ Find where pullback ends" : "→ Find where bounce ends"}
                </div>
              </Step>

              <Step num={2} tf="1H" title="HUNTING ZONE" met={ob1h !== null || fvg1h !== null}>
                {(ob1h || fvg1h) ? (
                  <>
                    {ob1h && (
                      <div style={{ fontSize: 7.5, color: isBull ? "#26a69a" : "#ef5350" }}>
                        OB @ {fmt(ob1h.bottom)}–{fmt(ob1h.top)}
                        {fvg1h && <span style={{ color: "#f59e0b" }}> + FVG overlap ★</span>}
                      </div>
                    )}
                    {!ob1h && fvg1h && (
                      <div style={{ fontSize: 7.5, color: "#4ade80" }}>
                        FVG @ {fmt(fvg1h.bottom)}–{fmt(fvg1h.top)}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 7, color: "#374151" }}>No 1H zone — wait for pullback</div>
                )}
              </Step>

              <Step num={3} tf="15M" title="PRECISION ENTRY" met={ob15m !== null || fvg15m !== null}>
                {ob15m && (
                  <div style={{ fontSize: 7.5, color: "#26a69a" }}>
                    15M OB @ {fmt(ob15m.bottom)}–{fmt(ob15m.top)}
                  </div>
                )}
                {!ob15m && fvg15m && (
                  <div style={{ fontSize: 7.5, color: "#4ade80" }}>
                    15M FVG @ {fmt(fvg15m.bottom)}–{fmt(fvg15m.top)}
                  </div>
                )}
                {!ob15m && !fvg15m && (ob1h || fvg1h) && (
                  <div style={{ fontSize: 7, color: "#374151" }}>
                    No 15M zone — place limit at{" "}
                    <span style={{ color: "#94a3b8" }}>
                      {ob1h
                        ? fmt(isBull ? ob1h.bottom : ob1h.top)
                        : fvg1h
                        ? fmt(isBull ? fvg1h.bottom : fvg1h.top)
                        : "—"}
                    </span>
                  </div>
                )}
                {!ob15m && !fvg15m && !ob1h && !fvg1h && (
                  <div style={{ fontSize: 7, color: "#374151" }}>Waiting for 1H zone first</div>
                )}
              </Step>
            </>
          )}

          {/* ── Trade Setup ───────────────────────── */}
          {setup && (
            <div style={{
              marginTop: 8,
              background: ready ? "rgba(38,166,154,0.07)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${ready ? "rgba(38,166,154,0.3)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 4,
              padding: "7px 8px",
            }}>
              <div style={{
                fontSize: 7, fontWeight: 700, letterSpacing: "0.1em",
                color: ready ? dirColor : "#374151",
                textTransform: "uppercase" as const,
                marginBottom: 6,
              }}>
                {ready
                  ? (isBull ? "▲ Long setup ready" : "▼ Short setup ready")
                  : "Setup developing — conditions incomplete"}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {[
                  { label: mode === "limit" ? "LIMIT" : "ENTRY", value: fmt(setup.entry), color: dirColor       },
                  { label: "SL",                                  value: fmt(setup.sl),    color: "#ef5350"      },
                  { label: "TP",                                  value: fmt(setup.tp),    color: "#26a69a"      },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 6, color: "#374151", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: "0.02em" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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