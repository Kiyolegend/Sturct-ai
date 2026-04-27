import React, { useState, useMemo } from "react";
import { TopBar, type ToggleState } from "@/components/TopBar";
import { TradingChart } from "@/components/TradingChart";
import { useTradingAnalysis, useSRLevels, useMTFBias, useSessions } from "@/hooks/use-trading-api";
import { Loader2, AlertTriangle, RefreshCw, Moon } from "lucide-react";

const MARKET_CLOSED_THRESHOLDS: Record<string, number> = {
  "5m":  10 * 60,
  "15m": 20 * 60,
  "1h":  90 * 60,
  "4h":  5 * 60 * 60,
};

export function Dashboard() {
  const [timeframe, setTimeframe] = useState("5m");
  const [symbol, setSymbol] = useState("USD/JPY");
  const [toggles, setToggles] = useState<ToggleState>({
    zigzag: true,
    labels: true,
    zones: true,
    sr15m: true,
    sr1h: true,
    sr4h: true,
    sessions: true,
  });

  const { data, isLoading, error, refetch, isRefetching } = useTradingAnalysis(symbol, timeframe, 500);
  const { data: srData } = useSRLevels(symbol);
  const { data: biasData } = useMTFBias(symbol);
  const { data: sessionsData } = useSessions(symbol, timeframe);

  const isMarketClosed = useMemo(() => {
    if (!data?.candles || data.candles.length === 0) return false;
    const lastCandle = data.candles[data.candles.length - 1];
    const threshold = MARKET_CLOSED_THRESHOLDS[timeframe] ?? 600;
    const nowSec = Math.floor(Date.now() / 1000);
    return (nowSec - lastCandle.time) > threshold;
  }, [data, timeframe]);

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
      />

      <main className="flex-1 relative w-full h-full">
        {isLoading && !data ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e17]/80 backdrop-blur-sm z-50">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
            <p className="text-muted-foreground font-medium tracking-wide animate-pulse">Initializing Trading Engine...</p>
            <p className="text-xs text-muted-foreground/60 mt-2">Loading {timeframe} market structure data for {displaySymbol}</p>
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
            <TradingChart data={data} srLevels={srData?.levels} sessions={sessionsData?.sessions} toggles={toggles} />

            {isRefetching && (
              <div className="absolute bottom-6 right-16 px-3 py-1.5 bg-[#0f1520]/80 backdrop-blur-md border border-white/10 rounded-full flex items-center space-x-2 shadow-lg z-50">
                <Loader2 className="w-3 h-3 text-primary animate-spin" />
                <span className="text-[10px] text-muted-foreground font-mono uppercase">Syncing</span>
              </div>
            )}

            {isMarketClosed && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-[#0f1520]/90 backdrop-blur-md border border-yellow-500/20 rounded-full flex items-center space-x-2 shadow-lg z-40 pointer-events-none">
                <Moon className="w-3 h-3 text-yellow-400" />
                <span className="text-[10px] text-yellow-400 font-mono uppercase tracking-wider">Market closed · Last available data</span>
              </div>
            )}

            <div className="absolute bottom-6 left-6 opacity-30 pointer-events-none select-none z-20 mix-blend-screen">
              <h1 className="text-4xl font-bold tracking-tighter">STRUCT<span className="text-primary">.ai</span></h1>
              <p className="text-xs font-mono mt-1 ml-1 text-white/50">PROFESSIONAL TRADING TERMINAL</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
