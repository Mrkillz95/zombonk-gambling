import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useModGetStats,
  getModGetStatsQueryKey,
  useModListPlayers,
  getModListPlayersQueryKey,
  useModUpdatePlayerBalance,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getModPassword, clearModPassword } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

export default function ModDashboard() {
  const [, setLocation] = useLocation();
  const password = getModPassword();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!password) setLocation("/mod");
  }, [password, setLocation]);

  const req = { headers: { "x-mod-password": password ?? "" } };

  const { data: stats, isLoading: statsLoading } = useModGetStats({
    request: req,
    query: { enabled: !!password, queryKey: getModGetStatsQueryKey() },
  });

  const { data: players, isLoading: playersLoading } = useModListPlayers({
    request: req,
    query: { enabled: !!password, queryKey: getModListPlayersQueryKey() },
  });

  const balanceMutation = useModUpdatePlayerBalance({ request: req });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBalance, setEditBalance] = useState("");

  const handleSaveBalance = (playerId: number) => {
    const newBal = parseInt(editBalance, 10);
    if (isNaN(newBal)) return;
    balanceMutation.mutate(
      { id: playerId, data: { balance: newBal } },
      {
        onSuccess: () => {
          setEditingId(null);
          queryClient.invalidateQueries({ queryKey: getModListPlayersQueryKey() });
          toast({ title: "Balance updated" });
        },
        onError: () => toast({ title: "Failed to update balance", variant: "destructive" }),
      }
    );
  };

  const handleLogout = () => {
    clearModPassword();
    setLocation("/mod");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-primary font-black tracking-tighter text-xl">ZOMBONK MOD</span>
          <div className="flex items-center gap-2">
            <Link href="/mod/games">
              <Button variant="outline" size="sm" data-testid="link-manage-games">Manage Games</Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">Logout</Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Stats */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Overview</h2>
          {statsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Players", value: stats?.totalPlayers ?? 0 },
                { label: "Games", value: stats?.totalGames ?? 0 },
                { label: "Open Games", value: stats?.openGames ?? 0, highlight: true },
                { label: "Total Bets", value: stats?.totalBets ?? 0 },
                { label: "Coins Wagered", value: (stats?.totalWagered ?? 0).toLocaleString() },
              ].map(s => (
                <div key={s.label} className={`bg-card border rounded-xl p-4 text-center ${s.highlight ? "border-primary/40" : "border-border"}`} data-testid={`stat-${s.label.toLowerCase().replace(" ", "-")}`}>
                  <p className={`text-xl font-bold ${s.highlight ? "text-primary" : "text-foreground"}`}>{s.value}</p>
                  <p className="text-muted-foreground text-xs mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Players */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Players</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {playersLoading && (
              <div className="p-4 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded" />)}
              </div>
            )}
            {!playersLoading && (!players || players.length === 0) && (
              <div className="p-8 text-center text-muted-foreground text-sm">No players yet.</div>
            )}
            <div className="divide-y divide-border">
              {players?.map(p => (
                <div key={p.id} data-testid={`row-player-${p.id}`} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">ID #{p.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {editingId === p.id ? (
                      <>
                        <Input
                          data-testid={`input-balance-${p.id}`}
                          type="number"
                          value={editBalance}
                          onChange={e => setEditBalance(e.target.value)}
                          className="w-28 h-8 font-mono text-sm"
                          autoFocus
                        />
                        <Button size="sm" className="h-8" onClick={() => handleSaveBalance(p.id)} data-testid={`button-save-balance-${p.id}`}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <span className="text-primary font-mono font-bold text-sm" data-testid={`text-balance-${p.id}`}>{p.balance.toLocaleString()}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => { setEditingId(p.id); setEditBalance(String(p.balance)); }}
                          data-testid={`button-edit-balance-${p.id}`}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
