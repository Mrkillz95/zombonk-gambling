import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Lobby from "@/pages/lobby";
import GamePage from "@/pages/game";
import PartyPage from "@/pages/party";
import PartyRoomPage from "@/pages/party-room";
import History from "@/pages/history";
import ModLogin from "@/pages/mod-login";
import ModDashboard from "@/pages/mod/dashboard";
import ModGames from "@/pages/mod/games";
import RedeemPage from "@/pages/redeem";
import ModRedeem from "@/pages/mod/redeem";
import ModGuard from "@/components/mod-guard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/lobby" component={Lobby} />
      <Route path="/game/:id" component={GamePage} />
      <Route path="/party" component={PartyPage} />
      <Route path="/party/:id" component={PartyRoomPage} />
      <Route path="/history" component={History} />
      <Route path="/mod" component={ModLogin} />
      <Route path="/mod/dashboard">
        <ModGuard>
          <ModDashboard />
        </ModGuard>
      </Route>
      <Route path="/mod/games">
        <ModGuard>
          <ModGames />
        </ModGuard>
      </Route>
      <Route path="/redeem" component={RedeemPage} />
      <Route path="/mod/redeem">
        <ModGuard>
          <ModRedeem />
        </ModGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
