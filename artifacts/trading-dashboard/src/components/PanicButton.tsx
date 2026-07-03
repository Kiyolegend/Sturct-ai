import React, { useState } from "react";

export function PanicButton({ onRevoked }: { onRevoked: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const revoke = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const nativeFetch = window.__nativeFetch ?? window.fetch;
      const res = await nativeFetch("/trading-api/auth/revoke-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totp_code: totp }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed" }));
        throw new Error(err.detail ?? "Failed");
      }
      setStatus("All sessions revoked. Reloading...");
      setTimeout(() => {
        onRevoked();
        window.location.reload();
      }, 800);
    } catch (e: any) {
      setStatus(e.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 9999, fontFamily: "'Roboto Mono', monospace" }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={panicBtnStyle} title="Revoke all remote access sessions">
          Panic
        </button>
      ) : (
        <div style={panelStyle}>
          <div style={{ fontSize: 11, color: "#ef5350", fontWeight: 700, marginBottom: 8 }}>
            Revoke ALL sessions (phone + laptop). You'll need to log in again everywhere.
          </div>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            style={inputStyle}
          />
          {status && <div style={{ fontSize: 11, marginBottom: 8, color: "#ccc" }}>{status}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={revoke} disabled={loading} style={{ ...panicBtnStyle, flex: 1 }}>
              {loading ? "Revoking..." : "Confirm Revoke"}
            </button>
            <button onClick={() => setOpen(false)} style={{ ...cancelBtnStyle, flex: 1 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const panicBtnStyle: React.CSSProperties = {
  background: "#ef5350",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#aaa",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 6,
  padding: "8px 14px",
  fontSize: 12,
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  width: 260,
  background: "#0f1420",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  marginBottom: 8,
  background: "#0a0e17",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  color: "#fff",
  fontSize: 12,
};