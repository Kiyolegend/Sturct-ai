import { createRoot } from "react-dom/client";
import React from "react";
import App from "./App";
import "./index.css";
import { LoginGate } from "@/components/LoginGate";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "#0a0e17", color: "#ef5350",
          fontFamily: "'Roboto Mono', monospace", padding: 24, textAlign: "center",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
            STRUCT.ai — RENDER ERROR
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", maxWidth: 600, marginBottom: 24 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{
              padding: "8px 20px", background: "#4ade80", border: "none",
              borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <LoginGate>
      <App />
    </LoginGate>
  </ErrorBoundary>,
);