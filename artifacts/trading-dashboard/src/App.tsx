import { Switch, Route, Router as WouterRouter } from "wouter";
import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dashboard } from "@/pages/Dashboard";
import { AnalysisPage } from "@/pages/AnalysisPage";
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

function Router({ activeSetups }: { activeSetups: ActiveSetup[] }) {
  return (
    <Switch>
      <Route path="/">{() => <Dashboard activeSetups={activeSetups} />}</Route>
      <Route path="/analysis" component={AnalysisPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [activeSetups, setActiveSetups] = useState<ActiveSetup[]>([]);
  const handleActiveSetups = useCallback((s: ActiveSetup[]) => setActiveSetups(s), []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <FrameworkMonitor onActiveSetups={handleActiveSetups} />
          <Router activeSetups={activeSetups} />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;