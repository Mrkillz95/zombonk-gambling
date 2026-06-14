import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useModGetStats,
  getModGetStatsQueryKey,
  useModListPlayers,
  getModListPlayersQueryKey,
  useModUpdatePlayerBalance,
  useModRigPlayer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getModPassword, clearModPassword } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

type GlobalRig = {
  forceOutcome?: "win" | "lose" | null;
  payoutMult?: number | null;
  message?: string | null;
};

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
  const rigMutation = useModRigPlayer({ request: req });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBalance, setEditBalance] = useState("");
  const [rigOpenId, setRigOpenId] = useState<number | null>(null);
  const [rigEdits, setRigEdits] = useState<Record<number, GlobalRig>>({});

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

  const handleSaveRig = (playerId: number) => {
    const rig = rigEdits[playerId] ?? {};
    rigMutation.mutate(
      {
        id: playerId,
        data: {
          forceOutcome: (rig.forceOutcome as "win" | "lose" | null | undefined) ?? null,
          payoutMult: rig.payoutMult ?? null,
          message: rig.message ?? null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getModListPlayersQueryKey() });
          toast({ title: "Global rig updated" });
        },
        onError: () => toast({ title: "Failed to update rig", variant: "destructive" }),
      }
    );
  };

  const handleClearRig = (playerId: number) => {
    rigMutation.mutate(
      { id: playerId, data: { forceOutcome: null, payoutMult: null, message: null } },
      {
        onSuccess: () => {
          setRigEdits((prev) => { const next = { ...prev }; delete next[playerId]; return next; });
          queryClient.invalidateQueries({ queryKey: getModListPlayersQueryKey() });
          toast({ title: "Global rig cleared" });
        },
        onError: () => toast({ title: "Failed to clear rig", variant: "destructive" }),
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
            <Link href="/mod/redeem">
              <Button variant="outline" size="sm" data-testid="link-manage-redeem">Redemptions</Button>
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
              {players?.map(p => {
                const rig = rigEdits[p.id] ?? (p.globalRig as GlobalRig | null) ?? {};
                const hasActiveRig = (p.globalRig as GlobalRig | null)?.forceOutcome != null;
                return (
                  <div key={p.id} data-testid={`row-player-${p.id}`} className="px-4 py-3 space-y-2">
                    {/* Main row */}
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground truncate">{p.name}</p>
                          {hasActiveRig && (
                            <span className="text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-mono">
                              RIGGED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap mt-0.5">
                          <span className="text-xs text-muted-foreground">ID #{p.id}</span>
                          {p.discordUser && (
                            <span className="text-xs text-blue-400 font-mono" data-testid={`text-discord-${p.id}`}>
                              ⌨ {p.discordUser}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground font-mono" data-testid={`text-password-${p.id}`}>
                            🔑 {p.password || <em className="opacity-50">no password</em>}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
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
                              Coins
                            </Button>
                            <Button
                              size="sm"
                              variant={rigOpenId === p.id ? "secondary" : "outline"}
                              className={`h-8 ${hasActiveRig ? "border-orange-500/40 text-orange-400" : ""}`}
                              onClick={() => {
                                if (rigOpenId === p.id) { setRigOpenId(null); }
                                else {
                                  setRigOpenId(p.id);
                                  setRigEdits(prev => ({ ...prev, [p.id]: (p.globalRig as GlobalRig | null) ?? {} }));
                                }
                              }}
                              data-testid={`button-rig-${p.id}`}
                            >
                              {hasActiveRig ? "Rigged ▾" : "Global Rig ▾"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Global rig panel */}
                    {rigOpenId === p.id && (
                      <div className="bg-background border border-border rounded-lg p-3 space-y-3 ml-0" data-testid={`panel-rig-${p.id}`}>
                        <p className="text-xs font-semibold uppercase tracking-widest text-orange-400">Global Rig — applies to all games</p>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-xs text-muted-foreground w-24">Force outcome:</span>
                          {(["win", "lose", "normal"] as const).map(opt => (
                            <button
                              key={opt}
                              className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                                (rig.forceOutcome ?? "normal") === opt || (opt === "normal" && !rig.forceOutcome)
                                  ? opt === "win" ? "bg-green-500/20 border-green-500/50 text-green-400"
                                    : opt === "lose" ? "bg-red-500/20 border-red-500/50 text-red-400"
                                    : "bg-primary/20 border-primary/50 text-primary"
                                  : "bg-transparent border-border text-muted-foreground hover:border-foreground/30"
                              }`}
                              onClick={() => setRigEdits(prev => ({
                                ...prev,
                                [p.id]: { ...rig, forceOutcome: opt === "normal" ? null : opt }
                              }))}
                              data-testid={`rig-outcome-${opt}-${p.id}`}
                            >
                              {opt.toUpperCase()}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground w-24">Payout mult:</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="e.g. 2"
                            value={rig.payoutMult ?? ""}
                            onChange={e => setRigEdits(prev => ({
                              ...prev,
                              [p.id]: { ...rig, payoutMult: e.target.value ? parseFloat(e.target.value) : null }
                            }))}
                            className="h-7 w-24 text-xs font-mono bg-background"
                            data-testid={`rig-mult-${p.id}`}
                          />
                          <span className="text-xs text-muted-foreground">(only applies on win)</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground w-24">Message:</span>
                          <Input
                            placeholder="Custom message shown to player"
                            value={rig.message ?? ""}
                            onChange={e => setRigEdits(prev => ({
                              ...prev,
                              [p.id]: { ...rig, message: e.target.value || null }
                            }))}
                            className="h-7 flex-1 min-w-40 text-xs bg-background"
                            data-testid={`rig-message-${p.id}`}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleSaveRig(p.id)}
                            disabled={rigMutation.isPending}
                            data-testid={`button-save-rig-${p.id}`}
                          >
                            Save Rig
                          </Button>
                          {hasActiveRig && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() => handleClearRig(p.id)}
                              disabled={rigMutation.isPending}
                              data-testid={`button-clear-rig-${p.id}`}
                            >
                              Clear Rig
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
