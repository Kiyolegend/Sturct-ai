import { Switch, Route, Router as WouterRouter } from "wouter";
import { useState, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dashboard } from "@/pages/Dashboard";
import { MobileDashboard } from "@/pages/MobileDashboard";
import { AnalysisPage } from "@/pages/AnalysisPage";
import { FrameworkMonitor } from "@/components/FrameworkMonitor";
import { type ActiveSetup } from "@/hooks/use-trading-api";
import NotFound from "@/pages/not-found";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

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
  const isMobile = useIsMobile();
  return (
    <Switch>
      <Route path="/">
        {() =>
          isMobile
            ? <MobileDashboard activeSetups={activeSetups} symbol={symbol} setSymbol={setSymbol} />
            : <Dashboard activeSetups={activeSetups} symbol={symbol} setSymbol={setSymbol} />
        }
      </Route>
      <Route path="/analysis" component={AnalysisPage} />
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