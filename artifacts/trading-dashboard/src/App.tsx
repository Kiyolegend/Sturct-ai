import { Switch, Route, Router as WouterRouter } from "wouter";
import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dashboard } from "@/pages/Dashboard";
import { AnalysisPage } from "@/pages/AnalysisPage";
import { ScalpPage } from "@/pages/ScalpPage";
import { FrameworkMonitor } from "@/components/FrameworkMonitor";
import { type ActiveSetup } from "@/hooks/use-trading-api";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
    },
  },
});

function Router({ activeSetups, symbol, setSymbol }: {
  activeSetups: ActiveSetup[];
  symbol: string;
  setSymbol: (s: string) => void;
}) {
  return (
    <Switch>
      <Route path="/">{() => <Dashboard activeSetups={activeSetups} symbol={symbol} setSymbol={setSymbol} />}</Route>
      <Route path="/analysis" component={AnalysisPage} />
      <Route path="/scalp">{() => <ScalpPage symbol={symbol} setSymbol={setSymbol} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [activeSetups, setActiveSetups] = useState<ActiveSetup[]>([]);
  const [symbol, setSymbol] = useState("USD/JPY");

  const handleActiveSetups = useCallback((s: ActiveSetup[]) => setActiveSetups(s), []);
  const handleSwitchSymbol = useCallback((pair: string) => setSymbol(pair), []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <FrameworkMonitor onActiveSetups={handleActiveSetups} onSwitchSymbol={handleSwitchSymbol} />
          <Router activeSetups={activeSetups} symbol={symbol} setSymbol={setSymbol} />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;