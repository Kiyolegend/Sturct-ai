import React, { useState, useEffect } from "react";
import { login, installSecureFetch, lock, getStoredDeviceKey } from "@/lib/secureApi";
import { PanicButton } from "@/components/PanicButton";

installSecureFetch();

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  marginBottom: 10,
  background: "#0a0e17",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  color: "#fff",
  fontSize: 12,
};

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [deviceKey, setDeviceKey] = useState(() => getStoredDeviceKey());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

useEffect(() => {
  const onExpired = () => setUnlocked(false);
  window.addEventListener("struct:session-expired", onExpired);
  return () => window.removeEventListener("struct:session-expired", onExpired);
}, []);

  const needsDeviceKey = getStoredDeviceKey() === "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(password, totp, passphrase, deviceKey);
      setUnlocked(true);
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  if (unlocked) {
    return (
      <>
        {children}
        <PanicButton
          onRevoked={() => {
            lock();
            setUnlocked(false);
          }}
        />
      </>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0e17",
        fontFamily: "'Roboto Mono', monospace",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 300,
          background: "#0f1420",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: "#4ade80", marginBottom: 16, letterSpacing: "0.1em" }}>
          STRUCT.ai — SECURE ACCESS
        </div>
        {needsDeviceKey && (
          <>
            <input
              type="password"
              placeholder="Device key (first time on this device only)"
              value={deviceKey}
              onChange={(e) => setDeviceKey(e.target.value)}
              style={inputStyle}
              autoFocus
            />
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: -6, marginBottom: 10 }}>
              This device isn't recognized yet — enter the device key once and this browser will remember it.
            </div>
          </>
        )}
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          autoFocus={!needsDeviceKey}
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="6-digit code"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          style={inputStyle}
          maxLength={6}
        />
        <input
          type="password"
          placeholder="Encryption passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          style={inputStyle}
        />
        {error && <div style={{ color: "#ef5350", fontSize: 11, marginBottom: 10 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "8px 0",
            background: "#4ade80",
            border: "none",
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {loading ? "Verifying..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}