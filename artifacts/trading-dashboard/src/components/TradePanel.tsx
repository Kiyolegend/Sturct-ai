import React, { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, X, CheckCircle, Loader2 } from "lucide-react";

// FIX 1 — relative URL (was "http://localhost:8001/trading-api")
const API = "/trading-api";
// FIX 2 — threshold >50 matches TradingChart/FrameworkPanel (was >10); DEC added
const PIP = (price: number) => price > 50 ? 0.01 : 0.0001;
const DEC = (price: number) => price > 50 ? 3 : 5;
const RISK_PER_PIP = (lots: number, price: number) =>
  price > 50 ? (lots * 100000 * 0.01) / price : lots * 100000 * 0.0001;

interface TradePanelProps {
  symbol:                   string;
  currentPrice:             number;
  clickedPrice?:            number | null;
  onClickedPriceConsumed?:  () => void;
  onSLChange?:  (v: number | null) => void;
  onTPChange?:  (v: number | null) => void;
  prefill?:     { direction: "BUY" | "SELL"; sl: number; tp: number; entry?: number; orderType?: "MARKET" | "LIMIT"; comment?: string } | null;
  onPrefillConsumed?: () => void;
}

type Direction  = "BUY" | "SELL";
type OrderType  = "MARKET" | "LIMIT";
type Stage      = "form" | "confirm" | "sending" | "result";

interface Position {
  ticket: number; symbol: string; type: string; volume: number;
  price_open: number; price_current: number; sl: number; tp: number; profit: number;
}

export function TradePanel({ symbol, currentPrice, clickedPrice, onClickedPriceConsumed, onSLChange, onTPChange, prefill, onPrefillConsumed  }: TradePanelProps) {
  const pip          = PIP(currentPrice);
  const defaultSL    = (price: number, dir: Direction) =>
    dir === "BUY" ? +(price - 20 * pip).toFixed(DEC(price)) : +(price + 20 * pip).toFixed(DEC(price));
  const defaultTP    = (price: number, dir: Direction) =>
    dir === "BUY" ? +(price + 40 * pip).toFixed(DEC(price)) : +(price - 40 * pip).toFixed(DEC(price));

  const [direction,        setDirection]        = useState<Direction>("BUY");
  const [orderType,        setOrderType]        = useState<OrderType>("MARKET");
  const [limitPrice,       setLimitPrice]       = useState(currentPrice.toFixed(DEC(currentPrice)));
  const [sl,               setSL]               = useState(() => defaultSL(currentPrice, "BUY").toFixed(DEC(currentPrice)));
  const [tp,               setTP]               = useState(() => defaultTP(currentPrice, "BUY").toFixed(DEC(currentPrice)));
  const [lots,             setLots]             = useState("0.02");
  const [stage,            setStage]            = useState<Stage>("form");
  const [resultMsg,        setResultMsg]        = useState("");
  const [resultOk,         setResultOk]         = useState(false);
  const [positions,        setPositions]        = useState<Position[]>([]);
  const [beTickets, setBeTickets] = useState<Set<number>>(new Set());
  const [chartClickTarget, setChartClickTarget] = useState<'entry' | 'sl' | 'tp' | null>(null);
  const [wasPrefilled,     setWasPrefilled]     = useState(false);
  // BUG 7 fix: state-based close confirmation replaces window.confirm (blocked in sandboxed iframes)
  const [confirmCloseTicket, setConfirmCloseTicket] = useState<number | null>(null);
  // BUG 2 fix: store order_id from POST /trade/open response to correlate with polling results
  const orderIdRef = useRef<string | null>(null);
  const commentRef  = useRef<string>("STRUCT.ai");

  // Auto-update SL/TP when direction, symbol, orderType change, or price first loads
  // BUG 4 fix: was `currentPrice > 0 ? "loaded" : ""` — a string that locked to "loaded" and
  // never changed again, so price updates never triggered this effect.
  // Now uses numeric 0→1 transition (same single-fire on load) plus orderType so switching
  // MARKET↔LIMIT recalculates defaults from the correct reference price.
  useEffect(() => {
    if (wasPrefilled) return;
    const p = orderType === "LIMIT" ? parseFloat(limitPrice) : currentPrice;
    setSL(defaultSL(p, direction).toFixed(DEC(p)));
    setTP(defaultTP(p, direction).toFixed(DEC(p)));
  }, [direction, symbol, currentPrice > 0 ? 1 : 0, orderType]);

    // Scalp pre-fill — fires when Dashboard pushes a scalp setup for this symbol
  useEffect(() => {
    if (!prefill) return;
    setDirection(prefill.direction);
    setSL(prefill.sl.toFixed(DEC(prefill.sl)));
    setTP(prefill.tp.toFixed(DEC(prefill.tp)));
    if (prefill.orderType) setOrderType(prefill.orderType);
    if (prefill.entry)     setLimitPrice(prefill.entry.toFixed(DEC(prefill.entry)));
    commentRef.current = prefill.comment ?? "STRUCT.ai";
    setWasPrefilled(true);
    onPrefillConsumed?.();
  }, [prefill]);

  // Chart click routing — SL, TP, Entry, or default (switch to LIMIT)
  // BUG 5 fix: added direction and chartClickTarget to deps — previously only [clickedPrice]
  // caused defaultSL/defaultTP to run with stale direction/chartClickTarget closure values.
  useEffect(() => {
    if (!clickedPrice) return;
    if (chartClickTarget === 'sl') {
      setSL(clickedPrice.toFixed(DEC(clickedPrice)));
    } else if (chartClickTarget === 'tp') {
      setTP(clickedPrice.toFixed(DEC(clickedPrice)));
    } else if (chartClickTarget === 'entry') {
      setLimitPrice(clickedPrice.toFixed(DEC(clickedPrice)));
      setSL(defaultSL(clickedPrice, direction).toFixed(DEC(clickedPrice)));
      setTP(defaultTP(clickedPrice, direction).toFixed(DEC(clickedPrice)));
    } else {
      setOrderType("LIMIT");
      setLimitPrice(clickedPrice.toFixed(DEC(clickedPrice)));
      setSL(defaultSL(clickedPrice, direction).toFixed(DEC(clickedPrice)));
      setTP(defaultTP(clickedPrice, direction).toFixed(DEC(clickedPrice)));
    }
    setChartClickTarget(null);
    setWasPrefilled(false);
    onClickedPriceConsumed?.();
  }, [clickedPrice, chartClickTarget, direction]);

  useEffect(() => {
    const v = parseFloat(sl);
    onSLChange?.(isNaN(v) ? null : v);
  }, [sl]);
  // Emit TP to parent
  useEffect(() => {
    const v = parseFloat(tp);
    onTPChange?.(isNaN(v) ? null : v);
  }, [tp]);
  // Clear lines on sending/result, restore on form
  useEffect(() => {
    if (stage === 'sending' || stage === 'result') {
      onSLChange?.(null);
      onTPChange?.(null);
    } else if (stage === 'form') {
      const sv = parseFloat(sl);
      const tv = parseFloat(tp);
      onSLChange?.(isNaN(sv) ? null : sv);
      onTPChange?.(isNaN(tv) ? null : tv);
    }
  }, [stage]);

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

  useEffect(() => {
    const poll = () =>
      fetch(`${API}/trade/breakeven-status`)
        .then(r => r.json())
        .then(d => setBeTickets(new Set<number>(d.tickets || [])))
        .catch(() => {});
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // FIX 3 — Poll for execution results with 30s timeout
  useEffect(() => {
    if (stage !== "sending") return;
    // BUG 3 fix: accurate timeout message — the order is still queued server-side and
    // WILL execute when the MT5 bridge reconnects. The old message said "may not have
    // executed" which is the opposite of the actual risk (zombie order).
    const timeout = setTimeout(() => {
      setResultMsg("MT5 bridge has not responded in 30s. The order is still queued and will execute when the bridge reconnects — verify in MT5 before placing another order.");
      setResultOk(false);
      setStage("result");
    }, 30000);
    const id = setInterval(() => {
      fetch(`${API}/trade/results`)
        .then(r => r.json())
        .then(d => {
          if (d.results?.length > 0) {
            // BUG 2 fix: match by order_id so a stale result from a previous trade
            // (that wasn't consumed before the next order was placed) cannot be shown
            // as the current trade's confirmation. Falls back to d.results[0] only
            // when no order_id is stored (should not happen in normal flow).
            const r = orderIdRef.current
              ? (d.results.find((x: { order_id: string }) => x.order_id === orderIdRef.current) ?? d.results[0])
              : d.results[0];
            setResultOk(r.status === "FILLED");
            setResultMsg(r.status === "FILLED"
              ? `Filled @ ${r.fill_price} (ticket ${r.ticket})`
              : `${r.status}: ${r.message}`);
            setStage("result");
          }
        }).catch(() => {});
    }, 1000);
    return () => { clearInterval(id); clearTimeout(timeout); };
  }, [stage]);

  const entryPrice = orderType === "MARKET" ? currentPrice : parseFloat(limitPrice);
  const slPips     = Math.abs(entryPrice - parseFloat(sl)) / pip;
  const tpPips     = Math.abs(entryPrice - parseFloat(tp)) / pip;
  const riskUSD    = slPips * RISK_PER_PIP(parseFloat(lots), currentPrice);
  const rewardUSD  = tpPips * RISK_PER_PIP(parseFloat(lots), currentPrice);

  const sendOrder = useCallback(async () => {
    setStage("sending");
    try {
      // BUG 1 fix: fetch() does NOT throw on 4xx/5xx — must check resp.ok manually.
      // Previously a 400/422/500 from FastAPI was silently swallowed and the UI would
      // spin for 30s then show a misleading "no MT5 response" timeout message.
      const resp = await fetch(`${API}/trade/open`, {
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
          comment:    commentRef.current,

        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        setResultMsg(`Order rejected by API (${resp.status}): ${errText}`);
        setResultOk(false);
        setStage("result");
        return;
      }
      // BUG 2 fix: store the order_id returned by the API so the polling effect can
      // filter results by this specific order rather than taking d.results[0] blindly.
      const data = await resp.json();
      orderIdRef.current = data.order_id ?? null;
    } catch {
      setResultMsg("Network error — order not sent");
      setResultOk(false);
      setStage("result");
    }
  }, [symbol, direction, orderType, limitPrice, sl, tp, lots]);

  const reset = () => {
    setStage("form");
    setResultMsg("");
    setLimitPrice(currentPrice.toFixed(DEC(currentPrice)));
    setSL(defaultSL(currentPrice, direction).toFixed(DEC(currentPrice)));
    setTP(defaultTP(currentPrice, direction).toFixed(DEC(currentPrice)));
    setChartClickTarget(null);
    setWasPrefilled(false);
    // BUG 2 fix: clear stored order_id so a new trade starts fresh
    orderIdRef.current = null;
    commentRef.current = "STRUCT.ai";
  };

  // BUG 7+8 fix: replaced window.confirm (blocked/auto-dismissed in sandboxed iframes)
  // with state-based inline confirmation. Also checks HTTP response status (BUG 8 —
  // previously .catch only caught network errors, not 4xx/5xx from the API).
  const closePosition = (ticket: number) => {
    setConfirmCloseTicket(ticket);
  };

  const confirmClose = (ticket: number) => {
    setConfirmCloseTicket(null);
    fetch(`${API}/trade/close`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ticket }),
    }).then(r => {
      if (!r.ok) r.text().then(t => console.error(`Close failed (${r.status}): ${t}`));
    }).catch(e => console.error("Close request failed — check MT5 manually", e));
  };

  const isBuy = direction === "BUY";
  const btnBuy  = `px-4 py-2 rounded font-bold text-sm transition-all ${isBuy  ? "bg-emerald-500 text-white" : "bg-white/5 text-white/40 hover:bg-white/10"}`;
  const btnSell = `px-4 py-2 rounded font-bold text-sm transition-all ${!isBuy ? "bg-red-500 text-white"     : "bg-white/5 text-white/40 hover:bg-white/10"}`;
  
  const slInvalid = isNaN(parseFloat(sl)) || (isBuy ? parseFloat(sl) >= entryPrice : parseFloat(sl) <= entryPrice);
  const tpInvalid = isNaN(parseFloat(tp)) || (isBuy ? parseFloat(tp) <= entryPrice : parseFloat(tp) >= entryPrice);
  // BUG 6 fix: added entryPrice > 0 guard — without it canSubmit was true when currentPrice
  // is still 0 (before the MT5 bridge has pushed any data), allowing a BUY/SELL with price: 0.
  const canSubmit  = !slInvalid && !tpInvalid && parseFloat(lots) > 0 && parseFloat(lots) <= 1 && entryPrice > 0;

  // BUG 9 fix: only show positions for the currently active symbol — previously positions
  // from all pairs were shown regardless of which pair was selected in the dashboard.
  const visiblePositions = positions.filter(
    p => p.symbol.replace("m", "").toLowerCase() === symbol.replace("/", "").toLowerCase()
  );

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
          {/* Scalp pre-fill banner */}
          {wasPrefilled && (
            <div className="text-[10px] text-teal-400 bg-teal-500/10 rounded px-2 py-1 border border-teal-500/20 font-semibold">
              ⚡ SCALP PRE-FILLED — verify SL/TP then click execute
            </div>
          )}
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

          {/* LIMIT PRICE — click to target, then click chart to set */}
          {orderType === "LIMIT" && (
            <div className="flex items-center gap-2">
              <span className="text-white/40 w-16">Entry</span>
              <input
                type="number"
                step={pip}
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                onClick={() => setChartClickTarget('entry')}
                className={`flex-1 bg-white/5 border rounded px-2 py-1 text-white focus:outline-none transition-colors ${
                  chartClickTarget === 'entry'
                    ? 'border-orange-400 ring-1 ring-orange-400/30'
                    : 'border-white/10 focus:border-white/30'
                }`}
              />
            </div>
          )}

          {/* SL — click to target, then click chart to set */}
          <div className="flex items-center gap-2">
            <span className="text-red-400/70 w-16">SL</span>
            <input
              type="number"
              step={pip}
              value={sl}
              onChange={e => setSL(e.target.value)}
              onClick={() => setChartClickTarget('sl')}
              className={`flex-1 bg-white/5 border rounded px-2 py-1 text-white focus:outline-none transition-colors ${
                chartClickTarget === 'sl'
                  ? 'border-orange-400 ring-1 ring-orange-400/30'
                  : 'border-red-500/20 focus:border-red-500/40'
              }`}
            />
            <span className="text-white/30">{slPips.toFixed(1)}p</span>
          </div>

          {/* TP — click to target, then click chart to set */}
          <div className="flex items-center gap-2">
            <span className="text-emerald-400/70 w-16">TP</span>
            <input
              type="number"
              step={pip}
              value={tp}
              onChange={e => setTP(e.target.value)}
              onClick={() => setChartClickTarget('tp')}
              className={`flex-1 bg-white/5 border rounded px-2 py-1 text-white focus:outline-none transition-colors ${
                chartClickTarget === 'tp'
                  ? 'border-orange-400 ring-1 ring-orange-400/30'
                  : 'border-emerald-500/20 focus:border-emerald-500/40'
              }`}
            />
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

          {/* Chart click target hint */}
          {chartClickTarget && (
            <div className="text-[10px] text-orange-400/80 text-center py-0.5 bg-orange-400/5 rounded border border-orange-400/20">
              Click chart to set {chartClickTarget === 'sl' ? 'Stop Loss' : chartClickTarget === 'tp' ? 'Take Profit' : 'Entry'} price
            </div>
          )}

          {/* FIX 4 — SL/TP wrong-side validation warnings */}
          {isBuy  && parseFloat(sl) >= entryPrice && (
            <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">
              ⚠ SL must be BELOW entry for a BUY
            </div>
          )}
          {!isBuy && parseFloat(sl) <= entryPrice && (
            <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">
              ⚠ SL must be ABOVE entry for a SELL
            </div>
          )}
          {isBuy  && parseFloat(tp) <= entryPrice && (
            <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">
              ⚠ TP must be ABOVE entry for a BUY
            </div>
          )}
          {!isBuy && parseFloat(tp) >= entryPrice && (
            <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">
              ⚠ TP must be BELOW entry for a SELL
            </div>
          )}

          
          {/* SUBMIT */}
          <button onClick={() => setStage("confirm")}
            disabled={!canSubmit}
            className={`w-full py-2 rounded font-bold text-sm ${isBuy ? "bg-emerald-500 hover:bg-emerald-400" : "bg-red-500 hover:bg-red-400"} text-white ${!canSubmit ? "opacity-40 cursor-not-allowed" : ""}`}>
            {isBuy ? "▲ BUY" : "▼ SELL"} {symbol}
          </button>
        </div>
      )}

      {/* OPEN POSITIONS — BUG 9 fix: filtered to current symbol only (was showing all pairs) */}
      {visiblePositions.length > 0 && (
        <div className="mt-1 border-t border-white/5 pt-2 flex flex-col gap-1">
          <div className="text-white/30 uppercase text-[10px] font-semibold">Open Positions</div>
          {visiblePositions.map(p => (
            <div key={p.ticket} className="flex flex-col bg-white/5 rounded px-2 py-1 gap-1">
              <div className="flex items-center gap-1">
                <span className={p.type === "BUY" ? "text-emerald-400" : "text-red-400"}>{p.type}</span>
                <span className="text-white/60 flex-1">{p.symbol.replace("m","")} {p.volume}</span>
                {beTickets.has(p.ticket) && (
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
                    BE ✅
                  </span>
                )}
                <span className={p.profit >= 0 ? "text-emerald-400" : "text-red-400"}>{p.profit >= 0 ? "+" : ""}{p.profit.toFixed(2)}</span>
                <button onClick={() => closePosition(p.ticket)}
                  className="ml-1 text-white/20 hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
              {/* BUG 7 fix: inline confirm row — replaces window.confirm which is blocked in iframes */}
              {confirmCloseTicket === p.ticket && (
                <div className="flex items-center gap-1">
                  <span className="text-red-400/80 flex-1 text-[10px]">Close #{p.ticket}?</span>
                  <button onClick={() => confirmClose(p.ticket)}
                    className="px-2 py-0.5 bg-red-500 hover:bg-red-400 text-white rounded text-[10px] font-bold">
                    Yes
                  </button>
                  <button onClick={() => setConfirmCloseTicket(null)}
                    className="px-2 py-0.5 bg-white/5 hover:bg-white/10 text-white/60 rounded text-[10px]">
                    No
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}