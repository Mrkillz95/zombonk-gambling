import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useModGetStats,
  getModGetStatsQueryKey,
  useModListPlayers,
  getModListPlayersQueryKey,
  useModUpdatePlayerBalance,
  useModRigPlayer,
  useModDeletePlayer,
  useModGetSettings,
  getModGetSettingsQueryKey,
  useModUpdateSettings,
  useModSetAllBalances,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getModPassword, clearModPassword } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

type GlobalRig = {
  forceOutcome?: "win" | "lose" | null;
  winRatio?: number | null;
  payoutMult?: number | null;
  applyAfterBalance?: number | null;
  message?: string | null;
};

function rigLabel(rig: GlobalRig | null): string | null {
  if (!rig) return null;
  if (rig.forceOutcome === "win") return "ALWAYS WIN";
  if (rig.forceOutcome === "lose") return "ALWAYS LOSE";
  if (rig.winRatio != null) return `${rig.winRatio}% WIN`;
  return null;
}

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
  const deleteMutation = useModDeletePlayer({ request: req });

  const handleDeletePlayer = (id: number, name: string) => {
    if (!window.confirm(`Permanently delete "${name}" (#${id})?\n\nThis removes the account along with all of its bets and redemption history. This cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getModListPlayersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getModGetStatsQueryKey() });
          toast({ title: `Deleted ${name}` });
        },
        onError: () => {
          toast({ title: "Failed to delete player", variant: "destructive" });
        },
      }
    );
  };

  const { data: settings } = useModGetSettings({
    request: req,
    query: { enabled: !!password, queryKey: getModGetSettingsQueryKey() },
  });
  const settingsMutation = useModUpdateSettings({ request: req });
  const setAllMutation = useModSetAllBalances({ request: req });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBalance, setEditBalance] = useState("");
  const [rigOpenId, setRigOpenId] = useState<number | null>(null);
  const [rigEdits, setRigEdits] = useState<Record<number, GlobalRig>>({});
  const [startingBalanceInput, setStartingBalanceInput] = useState("");
  const [setAllInput, setSetAllInput] = useState("");

  useEffect(() => {
    if (settings) setStartingBalanceInput(String(settings.startingBalance));
  }, [settings]);

  const handleSaveStartingBalance = () => {
    const amount = parseInt(startingBalanceInput, 10);
    if (isNaN(amount) || amount < 0) {
      toast({ title: "Enter a valid amount (0 or more)", variant: "destructive" });
      return;
    }
    settingsMutation.mutate(
      { data: { startingBalance: amount } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getModGetSettingsQueryKey() });
          toast({ title: "Starting balance saved" });
        },
        onError: () => toast({ title: "Failed to save starting balance", variant: "destructive" }),
      }
    );
  };

  const handleSetAllBalances = () => {
    const amount = parseInt(setAllInput, 10);
    if (isNaN(amount) || amount < 0) {
      toast({ title: "Enter a valid amount (0 or more)", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Set EVERY player's balance to ${amount.toLocaleString()} coins? This cannot be undone.`)) return;
    setAllMutation.mutate(
      { data: { balance: amount } },
      {
        onSuccess: (res) => {
          setSetAllInput("");
          queryClient.invalidateQueries({ queryKey: getModListPlayersQueryKey() });
          toast({ title: `Updated ${res.updated} player${res.updated === 1 ? "" : "s"}` });
        },
        onError: () => toast({ title: "Failed to set balances", variant: "destructive" }),
      }
    );
  };

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

  const patchRig = (playerId: number, rig: GlobalRig) => {
    setRigEdits(prev => ({ ...prev, [playerId]: rig }));
  };

  const handleSaveRig = (playerId: number) => {
    const rig = rigEdits[playerId] ?? {};
    rigMutation.mutate(
      {
        id: playerId,
        data: {
          forceOutcome: rig.forceOutcome ?? null,
          winRatio: rig.winRatio ?? null,
          payoutMult: rig.payoutMult ?? null,
          applyAfterBalance: rig.applyAfterBalance ?? null,
          message: rig.message ?? null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getModListPlayersQueryKey() });
          toast({ title: "Global rig saved" });
        },
        onError: () => toast({ title: "Failed to save rig", variant: "destructive" }),
      }
    );
  };

  const handleClearRig = (playerId: number) => {
    rigMutation.mutate(
      { id: playerId, data: { forceOutcome: null, winRatio: null, payoutMult: null, applyAfterBalance: null, message: null } },
      {
        onSuccess: () => {
          setRigEdits(prev => { const n = { ...prev }; delete n[playerId]; return n; });
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

        {/* Economy */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Economy</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="font-medium text-foreground text-sm">Starting balance</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">Coins each new player gets when they sign up.</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  value={startingBalanceInput}
                  onChange={e => setStartingBalanceInput(e.target.value)}
                  className="font-mono"
                  placeholder="0"
                  data-testid="input-starting-balance"
                />
                <Button onClick={handleSaveStartingBalance} disabled={settingsMutation.isPending} data-testid="button-save-starting-balance">Save</Button>
              </div>
            </div>
            <div className="bg-card border border-orange-500/30 rounded-xl p-4">
              <p className="font-medium text-foreground text-sm">Set everyone's balance</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">Overwrite every existing player's balance to this amount.</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  value={setAllInput}
                  onChange={e => setSetAllInput(e.target.value)}
                  className="font-mono"
                  placeholder="e.g. 1000"
                  data-testid="input-set-all-balance"
                />
                <Button variant="destructive" onClick={handleSetAllBalances} disabled={setAllMutation.isPending} data-testid="button-set-all-balance">Apply to all</Button>
              </div>
            </div>
          </div>
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
                const savedRig = (p.globalRig as GlobalRig | null) ?? null;
                const rig: GlobalRig = rigEdits[p.id] ?? savedRig ?? {};
                const label = rigLabel(savedRig);
                const hasActiveRig = !!label;

                return (
                  <div key={p.id} data-testid={`row-player-${p.id}`} className="px-4 py-3 space-y-2">
                    {/* Main row */}
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-foreground truncate">{p.name}</p>
                          {hasActiveRig && (
                            <span className="text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5 font-mono">
                              {label}
                              {savedRig?.applyAfterBalance ? ` ≥${savedRig.applyAfterBalance}` : ""}
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
                          {p.ipAddress && (
                            <span className="text-xs text-muted-foreground font-mono" data-testid={`text-ip-${p.id}`}>
                              🌐 {p.ipAddress}
                            </span>
                          )}
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
                                  setRigEdits(prev => ({ ...prev, [p.id]: savedRig ?? {} }));
                                }
                              }}
                              data-testid={`button-rig-${p.id}`}
                            >
                              {hasActiveRig ? "Rigged ▾" : "Global Rig ▾"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                              onClick={() => handleDeletePlayer(p.id, p.name)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-player-${p.id}`}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Global rig panel */}
                    {rigOpenId === p.id && (
                      <div className="bg-background border border-border rounded-lg p-4 space-y-4" data-testid={`panel-rig-${p.id}`}>
                        <p className="text-xs font-semibold uppercase tracking-widest text-orange-400">Global Rig — all games</p>

                        {/* Win/Loss Ratio */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-foreground">Win/Loss Ratio</span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {rig.forceOutcome === "win" ? "Always Win (100%)"
                                : rig.forceOutcome === "lose" ? "Always Lose (0%)"
                                : rig.winRatio != null ? `${rig.winRatio}% win / ${100 - rig.winRatio}% lose`
                                : "Not set"}
                            </span>
                          </div>

                          {/* Preset buttons */}
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { label: "OFF", action: () => patchRig(p.id, { ...rig, forceOutcome: null, winRatio: null }) },
                              { label: "0%", action: () => patchRig(p.id, { ...rig, forceOutcome: "lose", winRatio: null }) },
                              { label: "10%", action: () => patchRig(p.id, { ...rig, forceOutcome: null, winRatio: 10 }) },
                              { label: "25%", action: () => patchRig(p.id, { ...rig, forceOutcome: null, winRatio: 25 }) },
                              { label: "50%", action: () => patchRig(p.id, { ...rig, forceOutcome: null, winRatio: 50 }) },
                              { label: "75%", action: () => patchRig(p.id, { ...rig, forceOutcome: null, winRatio: 75 }) },
                              { label: "100%", action: () => patchRig(p.id, { ...rig, forceOutcome: "win", winRatio: null }) },
                            ].map(({ label, action }) => {
                              const isActive =
                                label === "OFF" ? rig.forceOutcome == null && rig.winRatio == null
                                : label === "0%" ? rig.forceOutcome === "lose"
                                : label === "100%" ? rig.forceOutcome === "win"
                                : rig.winRatio === parseInt(label);
                              return (
                                <button
                                  key={label}
                                  onClick={action}
                                  className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                                    isActive
                                      ? label === "0%" ? "bg-red-500/20 border-red-500/50 text-red-400"
                                        : label === "100%" ? "bg-green-500/20 border-green-500/50 text-green-400"
                                        : label === "OFF" ? "bg-muted border-border text-muted-foreground"
                                        : "bg-orange-500/20 border-orange-500/50 text-orange-400"
                                      : "bg-transparent border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                                  }`}
                                  data-testid={`rig-preset-${label.replace("%","pct")}-${p.id}`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>

                          {/* Custom % input */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground shrink-0">Custom %:</span>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              placeholder="0–100"
                              value={rig.winRatio != null && rig.forceOutcome == null ? String(rig.winRatio) : ""}
                              onChange={e => {
                                const v = e.target.value === "" ? null : Math.min(100, Math.max(0, parseInt(e.target.value, 10)));
                                patchRig(p.id, { ...rig, forceOutcome: null, winRatio: isNaN(v as number) ? null : v });
                              }}
                              className="h-7 w-20 text-xs font-mono bg-background"
                              data-testid={`rig-ratio-${p.id}`}
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </div>

                        {/* Activate at balance threshold */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-muted-foreground shrink-0">Activate at balance:</span>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="e.g. 5000"
                            value={rig.applyAfterBalance ?? ""}
                            onChange={e => patchRig(p.id, { ...rig, applyAfterBalance: e.target.value ? parseInt(e.target.value, 10) : null })}
                            className="h-7 w-24 text-xs font-mono bg-background"
                            data-testid={`rig-after-balance-${p.id}`}
                          />
                          <span className="text-xs text-muted-foreground">coins or more (0 = immediately)</span>
                        </div>

                        {/* Payout multiplier */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-muted-foreground shrink-0">Payout mult:</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="e.g. 2"
                            value={rig.payoutMult ?? ""}
                            onChange={e => patchRig(p.id, { ...rig, payoutMult: e.target.value ? parseFloat(e.target.value) : null })}
                            className="h-7 w-24 text-xs font-mono bg-background"
                            data-testid={`rig-mult-${p.id}`}
                          />
                          <span className="text-xs text-muted-foreground">(on rigged wins)</span>
                        </div>

                        {/* Custom message */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-muted-foreground shrink-0">Message:</span>
                          <Input
                            placeholder="Custom message shown to player"
                            value={rig.message ?? ""}
                            onChange={e => patchRig(p.id, { ...rig, message: e.target.value || null })}
                            className="h-7 flex-1 min-w-40 text-xs bg-background"
                            data-testid={`rig-message-${p.id}`}
                          />
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-8 text-xs"
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
                              className="h-8 text-xs text-red-400 hover:text-red-300"
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
