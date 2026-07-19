import { useChochAlerts, dismissChochAlert } from "@/hooks/use-choch-alerts";
import { useBrokerTime } from "@/hooks/use-trading-api";
import { X } from "lucide-react";

function fmt(p: number) { return p > 50 ? p.toFixed(3) : p.toFixed(5); }

function countdown(expiresAt: number, nowSec: number) {
  const remain = expiresAt - nowSec;
  if (remain <= 0) return "expired";
  const h = Math.floor(remain / 3600);
  const m = Math.floor((remain % 3600) / 60);
  return `${h}h ${m}m left`;
}

export function ChochAlertPanel() {
  const alerts = useChochAlerts();
  const { data: brokerTimeData } = useBrokerTime();
  const brokerNow = brokerTimeData?.broker_time ?? Math.floor(Date.now() / 1000);
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-16 right-3 z-[100] flex flex-col gap-2 w-72">
      {alerts.map((a) => {
        const bull = a.direction === "bullish";
        return (
          <button
            key={a.id}
            onClick={() => dismissChochAlert(a.id)}
            className={`relative text-left rounded border px-3 py-2 shadow-lg backdrop-blur
              ${bull ? "bg-teal-500/10 border-teal-500/40" : "bg-red-500/10 border-red-500/40"}`}
          >
            <X className="absolute top-1.5 right-1.5 w-3.5 h-3.5 opacity-60" />
            <div className="text-xs font-bold uppercase">
              {a.symbol} · {a.tf.toUpperCase()} · {bull ? "Bullish" : "Bearish"} CHoCH
            </div>
            <div className="text-[11px] opacity-80">
              {fmt(a.price)} — {a.brokenLabel} broken
            </div>
            <div className="text-[10px] opacity-60 mt-0.5">{countdown(a.expiresAt, brokerNow)}</div>
          </button>
        );
      })}
    </div>
  );
}