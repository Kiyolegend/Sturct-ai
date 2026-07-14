import React, { useState, useMemo, useEffect, useRef } from "react";
import { TopBar, type ToggleState } from "@/components/TopBar";
import { TradingChart, type FibLevel } from "@/components/TradingChart";
import { HeatmapSidebar } from "@/components/HeatmapSidebar";
import { TradePanel } from "@/components/TradePanel";
import { NewsPanel } from "@/components/NewsPanel";

import { useTradingAnalysis, useSRLevels, useMTFBias, useSessions, useBrokerTime, type ActiveSetup } from "@/hooks/use-trading-api";
import { Loader2, AlertTriangle, RefreshCw, Moon, LineChart, ListOrdered, Newspaper, LayoutGrid } from "lucide-react";

const MARKET_CLOSED_THRESHOLDS: Record<string, number> = {
  "5m":  10 * 60,
  "15m": 20 * 60,
  "1h":  90 * 60,
  "4h":  5 * 60 * 60,
  "d1":  5 * 24 * 60 * 60,
};

const CANDLE_LIMITS: Record<string, number> = {
  "5m":  2000,
  "15m": 2000,
  "1h":  2000,
  "4h":  1500,
  "d1":  1200,
};

type MobileTab = "chart" | "trade" | "pairs" | "news";

export function MobileDashboard({ activeSetups = [], symbol, setSymbol }: { activeSetups?: ActiveSetup[]; symbol: string; setSymbol: (s: string) => void }) {
  const [timeframe, setTimeframe] = useState("5m");
  const [activeTab, setActiveTab] = useState<MobileTab>("chart");
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
    fibD1:    false,
    d1Zones:  false,
    d1SR:     true,
  });

  const { data: brokerTimeData } = useBrokerTime();
  const brokerNow = brokerTimeData?.broker_time ?? 0;

  const { data, isLoading, error, refetch, isRefetching } = useTradingAnalysis(symbol, timeframe, CANDLE_LIMITS[timeframe] ?? 500);
  const { data: srData }       = useSRLevels(symbol);
  const { data: biasData }     = useMTFBias(symbol);
  const { data: sessionsData } = useSessions(symbol, timeframe === "d1" ? "5m" : timeframe);

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

  const fibD1Levels = useMemo((): FibLevel[] => {
    const hi = biasData?.bias_d1?.last_high_price as number | undefined;
    const lo = biasData?.bias_d1?.last_low_price  as number | undefined;
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
  }, [biasData?.bias_d1]);

  const [wsConnected,  setWsConnected]  = useState(false);
  const [clickedPrice, setClickedPrice] = useState<number | null>(null);
  const [slLine,       setSlLine]       = useState<number | null>(null);
  const [tpLine,       setTpLine]       = useState<number | null>(null);
  const [prefill, setPrefill] = useState<{ direction: "BUY"|"SELL"; sl: number; tp: number; entry?: number; orderType?: "MARKET"|"LIMIT"; comment?: string } | null>(null);

  const symbolRef       = useRef(symbol);
  const lastPrefillRef  = useRef<string>("");
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    symbolRef.current      = symbol;
    lastPrefillRef.current = "";
  }, [symbol]);

  // ── Framework-based active setups (same as desktop) ───────────────────────
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
    let ws: WebSocket;
    let dead = false;

    const connect = () => {
      if (dead) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/trading-api/ws`);
      ws.onopen    = () => setWsConnected(true);
      ws.onclose   = () => {
        setWsConnected(false);
        setTimeout(connect, 3000);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "candle" && msg.symbol === symbolRef.current) {
            refetch();
          }
        } catch {}
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => { dead = true; ws?.close(); };
  }, [refetch]);

    // Polling fallback — chart always stays live even when WS is unstable
  useEffect(() => {
    const interval = wsConnected ? 30_000 : 5_000;
    const id = setInterval(() => refetch(), interval);
    return () => clearInterval(id);
  }, [wsConnected, refetch]);

  const isMarketClosed = useMemo(() => {
    if (!data?.candles || data.candles.length === 0) return false;
    const lastCandle = data.candles[data.candles.length - 1];
    const threshold  = MARKET_CLOSED_THRESHOLDS[timeframe] ?? 600;
    return (brokerNow - lastCandle.time) > threshold;
  }, [data, timeframe, brokerNow]);

  const displaySymbol = symbol.replace("/", "");

  const TABS: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
    { id: "chart", label: "Chart", icon: <LineChart className="w-5 h-5" /> },
    { id: "trade", label: "Trade", icon: <ListOrdered className="w-5 h-5" /> },
    { id: "pairs", label: "Pairs", icon: <LayoutGrid className="w-5 h-5" /> },
    { id: "news",  label: "News",  icon: <Newspaper className="w-5 h-5" /> },
  ];

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#0a0e17] text-white overflow-hidden font-sans">
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

      <div className="flex-1 relative min-h-0">
        <main className={`absolute inset-0 h-full ${activeTab === "chart" ? "block" : "hidden"}`}>
          {isLoading && !data ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e17]/80 backdrop-blur-sm z-50">
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <p className="text-muted-foreground font-medium tracking-wide animate-pulse text-sm text-center px-6">
                Initializing Trading Engine...
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2 text-center px-6">
                Loading {timeframe} market structure data for {displaySymbol}
              </p>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e17] z-50 p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Connection Failed</h2>
              <p className="text-muted-foreground max-w-md mb-8 text-sm">
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
                onPriceClick={setClickedPrice}
                slLine={slLine}
                tpLine={tpLine}
                fibLevels={fibLevels}
                fibD1Levels={fibD1Levels}
                timeframe={timeframe}
              />

              <div className={`absolute bottom-2 right-2 px-2.5 py-1 backdrop-blur-md border rounded-full flex items-center space-x-1.5 shadow-lg z-30 ${wsConnected ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
                <span className={`text-[9px] font-mono uppercase tracking-wider ${wsConnected ? "text-green-400" : "text-red-400"}`}>
                  {wsConnected ? "LIVE" : "OFFLINE"}
                </span>
              </div>

              {isRefetching && (
                <div className="absolute bottom-2 left-2 px-2.5 py-1 bg-[#0f1520]/80 backdrop-blur-md border border-white/10 rounded-full flex items-center space-x-1.5 shadow-lg z-30">
                  <Loader2 className="w-3 h-3 text-primary animate-spin" />
                  <span className="text-[9px] text-muted-foreground font-mono uppercase">Syncing</span>
                </div>
              )}

              {isMarketClosed && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-[#0f1520]/90 backdrop-blur-md border border-yellow-500/20 rounded-full flex items-center space-x-1.5 shadow-lg z-30 pointer-events-none">
                  <Moon className="w-3 h-3 text-yellow-400" />
                  <span className="text-[9px] text-yellow-400 font-mono uppercase tracking-wider">
                    Market closed
                  </span>
                </div>
              )}
            </>
          )}
        </main>

        {activeTab === "trade" && (
          <div className="absolute inset-0 h-full overflow-y-auto bg-[#0a0e17] z-20">
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
          </div>
        )}

        {activeTab === "pairs" && (
          <div className="absolute inset-0 h-full overflow-y-auto bg-[#0a0e17] z-20">
            <HeatmapSidebar activeSymbol={symbol} onSelectSymbol={(s) => { setSymbol(s); setActiveTab("chart"); }} forceVisible />
          </div>
        )}

        {activeTab === "news" && (
          <div className="absolute inset-0 h-full overflow-y-auto bg-[#0a0e17] z-20">
            <NewsPanel />
          </div>
        )}
      </div>

      <nav className="shrink-0 border-t border-white/5 bg-[#0a0e17]/95 backdrop-blur-md flex items-stretch" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === tab.id ? "text-primary" : "text-white/40"
            }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium tracking-wide">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}