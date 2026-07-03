import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { LoginGate } from "@/components/LoginGate";

createRoot(document.getElementById("root")!).render(
  <LoginGate>
    <App />
  </LoginGate>,
);