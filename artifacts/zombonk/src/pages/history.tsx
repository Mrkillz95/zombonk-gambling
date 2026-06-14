import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetPlayerBets, getGetPlayerBetsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredPlayer } from "@/lib/player-store";

export default function History() {
  const [, setLocation] = useLocation();
  const stored = getStoredPlayer();

  useEffect(() => {
    if (!stored) setLocation("/");
  }, [stored, setLocation]);

  const { data: bets, isLoading } = useGetPlayerBets(stored?.id ?? 0, {
    query: {
      enabled: !!stored?.id,
      queryKey: getGetPlayerBetsQueryKey(stored?.id ?? 0),
    },
  });

  const wins = bets?.filter((b) => b.won).length ?? 0;
  const losses = (bets?.length ?? 0) - wins;
  const totalWagered = bets?.reduce((s, b) => s + b.wager, 0) ?? 0;
  const totalPayout = bets?.reduce((s, b) => s + b.payout, 0) ?? 0;
  const net = totalPayout - totalWagered;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/lobby">
            <Button variant="ghost" size="sm" data-testid="link-back">Back to Lobby</Button>
          </Link>
          <span className="text-foreground font-bold">{stored?.name ?? ""}'s History</span>
          <div className="w-24" />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Wins", value: wins, color: "text-primary" },
            { label: "Losses", value: losses, color: "text-destructive" },
            { label: "Wagered", value: `${totalWagered.toLocaleString()}`, color: "text-foreground" },
            {
              label: "Net",
              value: `${net >= 0 ? "+" : ""}${net.toLocaleString()}`,
              color: net >= 0 ? "text-primary" : "text-destructive",
            },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center" data-testid={`stat-${s.label.toLowerCase()}`}>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-muted-foreground text-xs mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Bets table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-bold text-foreground">All Bets</h2>
          </div>

          {isLoading && (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
            </div>
          )}

          {!isLoading && (!bets || bets.length === 0) && (
            <div className="p-8 text-center text-muted-foreground">
              No bets yet. Head to the lobby to start playing.
            </div>
          )}

          <div className="divide-y divide-border">
            {bets?.map((bet) => (
              <div
                key={bet.id}
                data-testid={`row-bet-${bet.id}`}
                className="px-4 py-3 flex items-center gap-4"
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 w-14 justify-center text-xs ${
                    bet.won
                      ? "border-primary/40 text-primary"
                      : "border-destructive/40 text-destructive"
                  }`}
                >
                  {bet.won ? "WIN" : "LOSS"}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{bet.gameTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {bet.gameType?.replace("_", " ").toUpperCase()} ·{" "}
                    {new Date(bet.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono text-muted-foreground">
                    -{bet.wager.toLocaleString()}
                  </p>
                  {bet.won && (
                    <p className="text-sm font-mono font-bold text-primary">
                      +{bet.payout.toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
