import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, X, CheckCircle, Loader2 } from "lucide-react";

const API = "http://localhost:8001/trading-api";
const PIP = (price: number) => price > 10 ? 0.01 : 0.0001;
const RISK_PER_PIP = (lots: number, price: number) =>
  price > 10 ? lots * 1000 * 0.01 : lots * 100000 * 0.0001;

interface TradePanelProps {
  symbol:                   string;
  currentPrice:             number;
  clickedPrice?:            number | null;
  onClickedPriceConsumed?:  () => void;
}

type Direction  = "BUY" | "SELL";
type OrderType  = "MARKET" | "LIMIT";
type Stage      = "form" | "confirm" | "sending" | "result";

interface Position {
  ticket: number; symbol: string; type: string; volume: number;
  price_open: number; price_current: number; sl: number; tp: number; profit: number;
}

export function TradePanel({ symbol, currentPrice, clickedPrice, onClickedPriceConsumed }: TradePanelProps) {
  const pip          = PIP(currentPrice);
  const defaultSL    = (price: number, dir: Direction) =>
    dir === "BUY" ? +(price - 20 * pip).toFixed(5) : +(price + 20 * pip).toFixed(5);
  const defaultTP    = (price: number, dir: Direction) =>
    dir === "BUY" ? +(price + 40 * pip).toFixed(5) : +(price - 40 * pip).toFixed(5);

  const [direction,  setDirection]  = useState<Direction>("BUY");
  const [orderType,  setOrderType]  = useState<OrderType>("MARKET");
  const [limitPrice, setLimitPrice] = useState(currentPrice.toFixed(5));
  const [sl,         setSL]         = useState(() => defaultSL(currentPrice, "BUY").toFixed(5));
  const [tp,         setTP]         = useState(() => defaultTP(currentPrice, "BUY").toFixed(5));
  const [lots,       setLots]       = useState("0.02");
  const [stage,      setStage]      = useState<Stage>("form");
  const [resultMsg,  setResultMsg]  = useState("");
  const [resultOk,   setResultOk]   = useState(false);
  const [positions,  setPositions]  = useState<Position[]>([]);

  // Auto-update SL/TP when direction or symbol changes
  useEffect(() => {
    const p = orderType === "LIMIT" ? parseFloat(limitPrice) : currentPrice;
    setSL(defaultSL(p, direction).toFixed(5));
    setTP(defaultTP(p, direction).toFixed(5));
  }, [direction, symbol]);


  useEffect(() => {
    if (!clickedPrice) return;
    setOrderType("LIMIT");
    setLimitPrice(clickedPrice.toFixed(5));
    setSL(defaultSL(clickedPrice, direction).toFixed(5));
    setTP(defaultTP(clickedPrice, direction).toFixed(5));
    onClickedPriceConsumed?.();
  }, [clickedPrice]);


  // Poll open positions
  useEffect(() => {
    const poll = () =>
      fetch(`${API}/trade/positions`)
        .then(r => r.json())
        .then(d => setPositions(d.positions || []))
        .catch(() => {});
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // Poll for execution results
  useEffect(() => {
    if (stage !== "sending") return;
    const id = setInterval(() => {
      fetch(`${API}/trade/results`)
        .then(r => r.json())
        .then(d => {
          if (d.results?.length > 0) {
            const r = d.results[0];
            setResultOk(r.status === "FILLED");
            setResultMsg(r.status === "FILLED"
              ? `Filled @ ${r.fill_price} (ticket ${r.ticket})`
              : `${r.status}: ${r.message}`);
            setStage("result");
          }
        }).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  const entryPrice = orderType === "MARKET" ? currentPrice : parseFloat(limitPrice);
  const slPips     = Math.abs(entryPrice - parseFloat(sl)) / pip;
  const tpPips     = Math.abs(entryPrice - parseFloat(tp)) / pip;
  const riskUSD    = slPips * RISK_PER_PIP(parseFloat(lots), currentPrice);
  const rewardUSD  = tpPips * RISK_PER_PIP(parseFloat(lots), currentPrice);

  const sendOrder = useCallback(async () => {
    setStage("sending");
    try {
      await fetch(`${API}/trade/open`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          symbol,
          direction,
          order_type: orderType,
          price:      orderType === "LIMIT" ? parseFloat(limitPrice) : null,
          sl:         parseFloat(sl),
          tp:         parseFloat(tp),
          lots:       parseFloat(lots),
        }),
      });
    } catch {
      setResultMsg("Network error — order not sent");
      setResultOk(false);
      setStage("result");
    }
  }, [symbol, direction, orderType, limitPrice, sl, tp, lots]);

  const reset = () => {
    setStage("form");
    setResultMsg("");
    setLimitPrice(currentPrice.toFixed(5));
    setSL(defaultSL(currentPrice, direction).toFixed(5));
    setTP(defaultTP(currentPrice, direction).toFixed(5));
  };

  const closePosition = (ticket: number) => {
    fetch(`${API}/trade/close`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ticket }),
    });
  };

  const isBuy = direction === "BUY";
  const btnBuy  = `px-4 py-2 rounded font-bold text-sm transition-all ${isBuy  ? "bg-emerald-500 text-white" : "bg-white/5 text-white/40 hover:bg-white/10"}`;
  const btnSell = `px-4 py-2 rounded font-bold text-sm transition-all ${!isBuy ? "bg-red-500 text-white"     : "bg-white/5 text-white/40 hover:bg-white/10"}`;

  return (
    <div className="flex flex-col gap-2 p-3 bg-[#0f1520] border-t border-white/5 text-xs">
      <div className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">Manual Trade — {symbol}</div>

      {/* RESULT */}
      {stage === "result" && (
        <div className={`flex items-start gap-2 p-2 rounded border ${resultOk ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
          {resultOk ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
          <div className="flex-1 text-white/80">{resultMsg}</div>
          <button onClick={reset} className="text-white/30 hover:text-white/70"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* SENDING */}
      {stage === "sending" && (
        <div className="flex items-center gap-2 p-2 rounded bg-white/5 text-white/60">
          <Loader2 className="w-4 h-4 animate-spin" />
          Sending to MT5…
        </div>
      )}

      {/* CONFIRM */}
      {stage === "confirm" && (
        <div className="flex flex-col gap-2 p-2 rounded border border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center gap-1 text-yellow-400 font-bold">
            <AlertTriangle className="w-3 h-3" /> Confirm Live Order
          </div>
          <div className="text-white/70 space-y-0.5">
            <div><span className="text-white/40">Pair:</span> {symbol}</div>
            <div><span className="text-white/40">Type:</span> <span className={isBuy ? "text-emerald-400" : "text-red-400"}>{direction} {orderType}</span></div>
            {orderType === "LIMIT" && <div><span className="text-white/40">Entry:</span> {limitPrice}</div>}
            <div><span className="text-white/40">SL:</span> {sl} <span className="text-white/30">({slPips.toFixed(1)}p / −${riskUSD.toFixed(2)})</span></div>
            <div><span className="text-white/40">TP:</span> {tp} <span className="text-white/30">({tpPips.toFixed(1)}p / +${rewardUSD.toFixed(2)})</span></div>
            <div><span className="text-white/40">Lots:</span> {lots}</div>
          </div>
          <div className="flex gap-2 mt-1">
            <button onClick={sendOrder} className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded font-bold">Send Order</button>
            <button onClick={() => setStage("form")} className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* FORM */}
      {stage === "form" && (
        <div className="flex flex-col gap-2">
          {/* BUY / SELL */}
          <div className="flex gap-1">
            <button className={btnBuy}  onClick={() => setDirection("BUY")}>BUY</button>
            <button className={btnSell} onClick={() => setDirection("SELL")}>SELL</button>
            <div className="flex-1" />
            <button onClick={() => setOrderType(orderType === "MARKET" ? "LIMIT" : "MARKET")}
              className="px-2 py-1 rounded text-[10px] bg-white/5 text-white/50 hover:bg-white/10">
              {orderType}
            </button>
          </div>

          {/* LIMIT PRICE */}
          {orderType === "LIMIT" && (
            <div className="flex items-center gap-2">
              <span className="text-white/40 w-16">Entry</span>
              <input type="number" step={pip} value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-white/30" />
            </div>
          )}

          {/* SL / TP */}
          <div className="flex items-center gap-2">
            <span className="text-red-400/70 w-16">SL</span>
            <input type="number" step={pip} value={sl}
              onChange={e => setSL(e.target.value)}
              className="flex-1 bg-white/5 border border-red-500/20 rounded px-2 py-1 text-white focus:outline-none focus:border-red-500/40" />
            <span className="text-white/30">{slPips.toFixed(1)}p</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400/70 w-16">TP</span>
            <input type="number" step={pip} value={tp}
              onChange={e => setTP(e.target.value)}
              className="flex-1 bg-white/5 border border-emerald-500/20 rounded px-2 py-1 text-white focus:outline-none focus:border-emerald-500/40" />
            <span className="text-white/30">{tpPips.toFixed(1)}p</span>
          </div>

          {/* LOTS */}
          <div className="flex items-center gap-2">
            <span className="text-white/40 w-16">Lots</span>
            <input type="number" step={0.01} min={0.01} max={1} value={lots}
              onChange={e => setLots(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-white/30" />
            <span className="text-white/30">−${riskUSD.toFixed(2)}</span>
          </div>

          {/* R:R */}
          <div className="flex justify-between text-[10px] text-white/30 px-0.5">
            <span>R:R {(rewardUSD / (riskUSD || 1)).toFixed(1)}</span>
            <span>+${rewardUSD.toFixed(2)} potential</span>
          </div>

          {/* SUBMIT */}
          <button onClick={() => setStage("confirm")}
            className={`w-full py-2 rounded font-bold text-sm ${isBuy ? "bg-emerald-500 hover:bg-emerald-400" : "bg-red-500 hover:bg-red-400"} text-white`}>
            {isBuy ? "▲ BUY" : "▼ SELL"} {symbol}
          </button>
        </div>
      )}

      {/* OPEN POSITIONS */}
      {positions.length > 0 && (
        <div className="mt-1 border-t border-white/5 pt-2 flex flex-col gap-1">
          <div className="text-white/30 uppercase text-[10px] font-semibold">Open Positions</div>
          {positions.map(p => (
            <div key={p.ticket} className="flex items-center gap-1 bg-white/5 rounded px-2 py-1">
              <span className={p.type === "BUY" ? "text-emerald-400" : "text-red-400"}>{p.type}</span>
              <span className="text-white/60 flex-1">{p.symbol.replace("m","")} {p.volume}</span>
              <span className={p.profit >= 0 ? "text-emerald-400" : "text-red-400"}>{p.profit >= 0 ? "+" : ""}{p.profit.toFixed(2)}</span>
              <button onClick={() => closePosition(p.ticket)}
                className="ml-1 text-white/20 hover:text-red-400 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}