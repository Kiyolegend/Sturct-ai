import React, { useState, useMemo, useEffect, useRef } from "react";
import { TopBar, type ToggleState } from "@/components/TopBar";
import { TradingChart, type FibLevel } from "@/components/TradingChart";
import { HeatmapSidebar } from "@/components/HeatmapSidebar";
import { TradePanel } from "@/components/TradePanel";
import { NewsPanel } from "@/components/NewsPanel";

import { useTradingAnalysis, useSRLevels, useMTFBias, useSessions, useBosChoch, useBrokerTime, type ActiveSetup } from "@/hooks/use-trading-api";
import { Loader2, AlertTriangle, RefreshCw, Moon } from "lucide-react";

const MARKET_CLOSED_THRESHOLDS: Record<string, number> = {
  "5m":  10 * 60,
  "15m": 20 * 60,
  "1h":  90 * 60,
  "4h":  5 * 60 * 60,
};

export function Dashboard({ activeSetups = [], symbol, setSymbol }: { activeSetups?: ActiveSetup[]; symbol: string; setSymbol: (s: string) => void }) {
  const [timeframe, setTimeframe] = useState("5m");
  const [toggles, setToggles] = useState<ToggleState>({
    zigzag:   true,
    labels:   true,
    zones:    true,
    sr15m:    true,
    sr1h:     true,
    sr4h:     true,
    sessions: true,
    bos:      true,
    ob:       false,
    fvg:      false,
    fib:      false,
    d1Zones:  false,
    d1SR:     true,
  });

  

  

  const { data: brokerTimeData } = useBrokerTime();
  const brokerNow = brokerTimeData?.broker_time ?? Math.floor(Date.now() / 1000);

  const { data, isLoading, error, refetch, isRefetching } = useTradingAnalysis(symbol, timeframe, 500);
  const { data: srData }       = useSRLevels(symbol);
  const { data: biasData }     = useMTFBias(symbol);
  const { data: sessionsData } = useSessions(symbol, timeframe);
  const { data: bosChochData } = useBosChoch(symbol);

  const fibLevels = useMemo((): FibLevel[] => {
    const hi = biasData?.bias_4h?.last_high_price as number | undefined;
    const lo = biasData?.bias_4h?.last_low_price  as number | undefined;
    if (!hi || !lo || hi <= lo) return [];
    const range = hi - lo;
    return [
      { pct: -61.8, label: "+161.8%", isKey: false, isExt: true  },
      { pct: -27.2, label: "+127.2%", isKey: false, isExt: true  },
      { pct: 0,     label: "0%",      isKey: false               },
      { pct: 23.6,  label: "23.6%",   isKey: false               },
      { pct: 38.2,  label: "38.2%",   isKey: true                },
      { pct: 50,    label: "50%",     isKey: false               },
      { pct: 61.8,  label: "61.8%",   isKey: true                },
      { pct: 78.6,  label: "78.6%",   isKey: false               },
      { pct: 100,   label: "100%",    isKey: false               },
      { pct: 127.2, label: "127.2%",  isKey: false, isExt: true  },
      { pct: 161.8, label: "161.8%",  isKey: false, isExt: true  },
    ].map(r => ({ ...r, price: hi - (r.pct / 100) * range }));
  }, [biasData?.bias_4h]);

  
  const goldenZoneAlert = useMemo((): "BUY" | "SELL" | "WATCH" | null => {
    if (!fibLevels.length || !data?.candles?.length) return null;
    const candles = data.candles as any[];
    const price = candles[candles.length - 1]?.close as number | undefined;
    if (!price) return null;
    const level382 = fibLevels.find(f => f.pct === 38.2)?.price;
    const level618 = fibLevels.find(f => f.pct === 61.8)?.price;
    if (!level382 || !level618) return null;
    const zoneTop    = level382;
    const zoneBottom = level618;
    if (price >= zoneBottom && price <= zoneTop) {
      const trend = biasData?.bias_4h?.trend;
      if (trend === "bullish") return "BUY";
      if (trend === "bearish") return "SELL";
      return "WATCH";
    }
    return null;
  }, [fibLevels, data?.candles, biasData?.bias_4h?.trend]);
    const pipsToZone = useMemo((): number | null => {
    if (goldenZoneAlert !== null) return null;
    if (!fibLevels.length || !data?.candles?.length) return null;
    const candles = data.candles as any[];
    const price = candles[candles.length - 1]?.close as number | undefined;
    if (!price) return null;
    const level382 = fibLevels.find(f => f.pct === 38.2)?.price;
    const level618 = fibLevels.find(f => f.pct === 61.8)?.price;
    if (!level382 || !level618) return null;
    const pip = price > 50 ? 0.01 : 0.0001;
    if (price > level382) return Math.round((price - level382) / pip);
    if (price < level618) return Math.round((level618 - price) / pip);
    return null;
  }, [goldenZoneAlert, fibLevels, data?.candles]);

    const swingAge = useMemo((): string | null => {
    const t = (biasData?.bias_4h as any)?.last_swing_time as number | undefined;
    if (!t || !brokerNow) return null;
    const mins = Math.round((brokerNow - t) / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
  }, [biasData?.bias_4h, brokerNow]);

    const swingAgeColor = useMemo((): string => {
    const t = (biasData?.bias_4h as any)?.last_swing_time as number | undefined;
    if (!t || !brokerNow) return "text-slate-600";
    const mins = Math.round((brokerNow - t) / 60);
    if (mins <= 480) return "text-slate-500";
    if (mins <= 960) return "text-yellow-500/70";
    return "text-red-500/70";
  }, [biasData?.bias_4h, brokerNow]);

  const [wsConnected,  setWsConnected]  = useState(false);
  const [clickedPrice, setClickedPrice] = useState<number | null>(null);
  const [slLine,       setSlLine]       = useState<number | null>(null);
  const [tpLine,       setTpLine]       = useState<number | null>(null);
  const [prefill, setPrefill] = useState<{ direction: "BUY"|"SELL"; sl: number; tp: number; entry?: number; orderType?: "MARKET"|"LIMIT"; comment?: string } | null>(null);

  const symbolRef       = useRef(symbol);
  const lastPrefillRef  = useRef<string>("");
  useEffect(() => {
    symbolRef.current      = symbol;
    lastPrefillRef.current = "";
  }, [symbol]);

  

    

  // ── Framework-based active setups (existing) ──────────────────────────────
  useEffect(() => {
    const scalp = activeSetups.find(s => s.mode === "scalp" && s.pair === symbol);
    const limit = activeSetups.find(s => s.mode === "limit" && s.pair === symbol);
    const setup = scalp ?? limit;
    if (setup && setup.sl && setup.tp) {
      const key = `${symbol}-${setup.mode}-${setup.direction}-${setup.sl}`;
      if (key === lastPrefillRef.current) return;
      lastPrefillRef.current = key;
      setPrefill({
        direction: setup.direction === "bullish" ? "BUY" : "SELL",
        sl:        setup.sl,
        tp:        setup.tp,
        entry:     setup.entry ?? undefined,
        orderType: setup.mode === "limit" ? "LIMIT" : "MARKET",
        comment:   "STRUCT.ai-Framework",
      });
    }
  }, [activeSetups, symbol]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/trading-api/ws`);
    ws.onopen    = () => setWsConnected(true);
    ws.onclose   = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "candle" && msg.symbol === symbolRef.current) {
          refetch();
        }
      } catch {}
    };
    ws.onerror = () => ws.close();
    return () => ws.close();
  }, [refetch]);

  const isMarketClosed = useMemo(() => {
    if (!data?.candles || data.candles.length === 0) return false;
    const lastCandle = data.candles[data.candles.length - 1];
    const threshold  = MARKET_CLOSED_THRESHOLDS[timeframe] ?? 600;
    return (brokerNow - lastCandle.time) > threshold;
  }, [data, timeframe, brokerNow]);

  const displaySymbol = symbol.replace("/", "");

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0e17] text-white overflow-hidden font-sans">
      <TopBar
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        toggles={toggles}
        setToggles={setToggles}
        symbol={displaySymbol}
        setSymbol={setSymbol}
        trend={data?.trend?.trend}
        bias15m={biasData?.bias_15m?.trend}
        bias1h={biasData?.bias_1h?.trend}
        bias4h={biasData?.bias_4h?.trend}
        biasd1={biasData?.bias_d1?.trend}
        activeSetups={activeSetups}
      />

      <div className="flex-1 flex flex-row min-h-0">
        <HeatmapSidebar activeSymbol={symbol} onSelectSymbol={setSymbol}>

          

          <TradePanel
            symbol={symbol}
            currentPrice={data?.candles?.at(-1)?.close ?? 0}
            clickedPrice={clickedPrice}
            onClickedPriceConsumed={() => setClickedPrice(null)}
            onSLChange={setSlLine}
            onTPChange={setTpLine}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
          />

          <NewsPanel />

        </HeatmapSidebar>

        <main className="flex-1 relative h-full">
          {isLoading && !data ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e17]/80 backdrop-blur-sm z-50">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground font-medium tracking-wide animate-pulse">
                Initializing Trading Engine...
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                Loading {timeframe} market structure data for {displaySymbol}
              </p>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e17] z-50 p-6 text-center">
              <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
                <AlertTriangle className="w-10 h-10 text-red-500" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Connection Failed</h2>
              <p className="text-muted-foreground max-w-md mb-8">
                {error instanceof Error ? error.message : "Unable to connect to the Trading API."}
                <br /><br />
                Ensure the Python backend is running and the MT5 bridge is active.
              </p>
              <button
                onClick={() => refetch()}
                className="flex items-center space-x-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Connection</span>
              </button>
            </div>
          ) : (
            <>
              <TradingChart
                data={data}
                srLevels={srData?.levels}
                sessions={sessionsData?.sessions}
                toggles={toggles}
                bosChochData={bosChochData}
                onPriceClick={setClickedPrice}
                slLine={slLine}
                tpLine={tpLine}
                fibLevels={fibLevels}
              />


              {!goldenZoneAlert && pipsToZone !== null && pipsToZone <= 80 && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md border border-white/10 bg-white/5 font-mono text-xs text-slate-400 tracking-wide pointer-events-none">
                  <span className="text-yellow-400 animate-pulse">◎</span>
                  {pipsToZone} pips to golden zone
                  {swingAge && (
                   <span className={`${swingAgeColor} text-[10px] ml-1`}>· 4H swing {swingAge}</span>
                   )}
                </div>
         )}
              {goldenZoneAlert && (
                <div className={`absolute top-14 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-full flex items-center gap-2 backdrop-blur-md border font-mono text-xs font-bold tracking-widest uppercase shadow-xl pointer-events-none
                  ${goldenZoneAlert === "BUY"
                    ? "bg-green-500/15 border-green-400/40 text-green-300"
                    : goldenZoneAlert === "SELL"
                    ? "bg-red-500/15 border-red-400/40 text-red-300"
                    : "bg-yellow-500/15 border-yellow-400/40 text-yellow-300"
                  }`}>
                  <span className="animate-pulse">⚡</span>
                  {goldenZoneAlert === "BUY"   && "GOLDEN ZONE — BUY SETUP"}
                  {goldenZoneAlert === "SELL"  && "GOLDEN ZONE — SELL SETUP"}
                  {goldenZoneAlert === "WATCH" && "GOLDEN ZONE — WATCH"}
                  <span className={`${swingAgeColor} text-[10px] ml-1 opacity-60`}>38.2–61.8% · 4H</span>
                </div>
              )}

              <div className={`absolute bottom-6 right-6 px-3 py-1.5 backdrop-blur-md border rounded-full flex items-center space-x-2 shadow-lg z-50 ${wsConnected ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
                <span className={`text-[10px] font-mono uppercase tracking-wider ${wsConnected ? "text-green-400" : "text-red-400"}`}>
                  {wsConnected ? "LIVE" : "OFFLINE"}
                </span>
              </div>

              {isRefetching && (
                <div className="absolute bottom-6 right-16 px-3 py-1.5 bg-[#0f1520]/80 backdrop-blur-md border border-white/10 rounded-full flex items-center space-x-2 shadow-lg z-50">
                  <Loader2 className="w-3 h-3 text-primary animate-spin" />
                  <span className="text-[10px] text-muted-foreground font-mono uppercase">Syncing</span>
                </div>
              )}

              {isMarketClosed && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-[#0f1520]/90 backdrop-blur-md border border-yellow-500/20 rounded-full flex items-center space-x-2 shadow-lg z-40 pointer-events-none">
                  <Moon className="w-3 h-3 text-yellow-400" />
                  <span className="text-[10px] text-yellow-400 font-mono uppercase tracking-wider">
                    Market closed · Last available data
                  </span>
                </div>
              )}

              <div className="absolute bottom-6 left-6 opacity-30 pointer-events-none select-none z-20 mix-blend-screen">
                <h1 className="text-4xl font-bold tracking-tighter">
                  STRUCT<span className="text-primary">.ai</span>
                </h1>
                <p className="text-xs font-mono mt-1 ml-1 text-white/50">PROFESSIONAL TRADING TERMINAL</p>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}