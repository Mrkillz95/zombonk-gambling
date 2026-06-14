import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useModListGames,
  getModListGamesQueryKey,
  useModCreateGame,
  useModUpdateGame,
  useModDeleteGame,
  useModResolveGame,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getModPassword } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

type GameType = "slots" | "coin_flip" | "match_bet" | "number_pick" | "mystery_box";

interface OptionInput {
  label: string;
  odds: number;
  emoji: string;
  weight: number;
}

interface GameFormState {
  title: string;
  type: GameType;
  // coin_flip / match_bet / mystery_box options
  options: OptionInput[];
  // slots config
  reelCount: number;
  slotItems: { label: string; emoji: string; weight: number; payout: number }[];
  // number_pick config
  numMin: number;
  numMax: number;
  numOdds: number;
}

const DEFAULT_FORM: GameFormState = {
  title: "",
  type: "coin_flip",
  options: [
    { label: "Heads", odds: 2, emoji: "", weight: 1 },
    { label: "Tails", odds: 2, emoji: "", weight: 1 },
  ],
  reelCount: 3,
  slotItems: [
    { label: "Cherry", emoji: "CH", weight: 5, payout: 2 },
    { label: "Bar", emoji: "BR", weight: 4, payout: 3 },
    { label: "Seven", emoji: "7", weight: 2, payout: 5 },
    { label: "Skull", emoji: "SK", weight: 1, payout: 10 },
  ],
  numMin: 1,
  numMax: 10,
  numOdds: 8,
};

const TYPE_DEFAULTS: Record<GameType, Partial<GameFormState>> = {
  coin_flip: {
    options: [
      { label: "Heads", odds: 2, emoji: "", weight: 1 },
      { label: "Tails", odds: 2, emoji: "", weight: 1 },
    ],
  },
  match_bet: {
    options: [
      { label: "Option A", odds: 2, emoji: "", weight: 1 },
      { label: "Option B", odds: 2, emoji: "", weight: 1 },
    ],
  },
  mystery_box: {
    options: [
      { label: "Box 1", odds: 1.5, emoji: "", weight: 3 },
      { label: "Box 2", odds: 3, emoji: "", weight: 2 },
      { label: "Box 3", odds: 7, emoji: "", weight: 1 },
    ],
  },
  slots: {},
  number_pick: {},
};

const STATUS_COLORS: Record<string, string> = {
  open: "border-green-500/30 text-green-400",
  closed: "border-yellow-500/30 text-yellow-400",
  resolved: "border-muted-foreground/30 text-muted-foreground",
};

export default function ModGames() {
  const [, setLocation] = useLocation();
  const password = getModPassword();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!password) setLocation("/mod");
  }, [password, setLocation]);

  const req = { headers: { "x-mod-password": password ?? "" } };

  const { data: games, isLoading } = useModListGames({
    request: req,
    query: { enabled: !!password, queryKey: getModListGamesQueryKey() },
  });

  const createMutation = useModCreateGame({ request: req });
  const updateMutation = useModUpdateGame({ request: req });
  const deleteMutation = useModDeleteGame({ request: req });
  const resolveMutation = useModResolveGame({ request: req });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<GameFormState>(DEFAULT_FORM);
  const [resolvingGame, setResolvingGame] = useState<{ id: number; options: any[] } | null>(null);
  const [winningOptionId, setWinningOptionId] = useState<number | null>(null);
  const [editStatusId, setEditStatusId] = useState<number | null>(null);

  const resetForm = () => setForm(DEFAULT_FORM);

  const handleTypeChange = (type: GameType) => {
    setForm(prev => ({
      ...prev,
      type,
      ...(TYPE_DEFAULTS[type] ?? {}),
    }));
  };

  const buildPayload = () => {
    const config: any = {};
    let options: OptionInput[] = [];

    if (form.type === "slots") {
      config.reelCount = form.reelCount;
      config.items = form.slotItems;
    } else if (form.type === "number_pick") {
      config.min = form.numMin;
      config.max = form.numMax;
      config.odds = form.numOdds;
    } else {
      options = form.options;
    }

    return { title: form.title, type: form.type, config, options };
  };

  const handleCreate = () => {
    if (!form.title.trim()) return;
    const payload = buildPayload();
    createMutation.mutate(
      { data: payload as any },
      {
        onSuccess: () => {
          setShowCreate(false);
          resetForm();
          queryClient.invalidateQueries({ queryKey: getModListGamesQueryKey() });
          toast({ title: "Game created" });
        },
        onError: () => toast({ title: "Failed to create game", variant: "destructive" }),
      }
    );
  };

  const handleStatusChange = (id: number, status: string) => {
    updateMutation.mutate(
      { id, data: { status: status as any } },
      {
        onSuccess: () => {
          setEditStatusId(null);
          queryClient.invalidateQueries({ queryKey: getModListGamesQueryKey() });
          toast({ title: `Game ${status}` });
        },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this game?")) return;
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getModListGamesQueryKey() });
          toast({ title: "Game deleted" });
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  };

  const handleResolve = () => {
    if (!resolvingGame || !winningOptionId) return;
    resolveMutation.mutate(
      { id: resolvingGame.id, data: { winningOptionId } },
      {
        onSuccess: () => {
          setResolvingGame(null);
          setWinningOptionId(null);
          queryClient.invalidateQueries({ queryKey: getModListGamesQueryKey() });
          toast({ title: "Game resolved, winners paid out" });
        },
        onError: () => toast({ title: "Failed to resolve", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/mod/dashboard">
              <Button variant="ghost" size="sm" data-testid="link-dashboard">Dashboard</Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-bold text-foreground">Games</span>
          </div>
          <Button
            size="sm"
            onClick={() => { setShowCreate(!showCreate); resetForm(); }}
            data-testid="button-new-game"
          >
            {showCreate ? "Cancel" : "New Game"}
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Create form */}
        {showCreate && (
          <div className="bg-card border border-primary/30 rounded-xl p-6 space-y-5">
            <h2 className="font-bold text-foreground">Create New Game</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium uppercase">Title</label>
                <Input
                  data-testid="input-game-title"
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="Game title..."
                  className="h-10"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium uppercase">Type</label>
                <select
                  data-testid="select-game-type"
                  value={form.type}
                  onChange={e => handleTypeChange(e.target.value as GameType)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                >
                  <option value="coin_flip">Coin Flip</option>
                  <option value="match_bet">Match Bet</option>
                  <option value="mystery_box">Mystery Box</option>
                  <option value="number_pick">Number Pick</option>
                  <option value="slots">Slot Machine</option>
                </select>
              </div>
            </div>

            {/* Coin flip / Match bet / Mystery box - options editor */}
            {(form.type === "coin_flip" || form.type === "match_bet" || form.type === "mystery_box") && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Options</label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setForm(p => ({ ...p, options: [...p.options, { label: "", odds: 2, emoji: "", weight: 1 }] }))}
                    data-testid="button-add-option"
                  >
                    Add Option
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.options.map((opt, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`option-row-${i}`}>
                      <Input
                        data-testid={`input-option-label-${i}`}
                        className="col-span-4 h-9 text-sm"
                        placeholder="Label"
                        value={opt.label}
                        onChange={e => setForm(p => { const o = [...p.options]; o[i] = { ...o[i], label: e.target.value }; return { ...p, options: o }; })}
                      />
                      <div className="col-span-2 flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Odds</span>
                        <Input
                          data-testid={`input-option-odds-${i}`}
                          className="h-9 text-sm font-mono"
                          type="number"
                          step="0.1"
                          min="1"
                          value={opt.odds}
                          onChange={e => setForm(p => { const o = [...p.options]; o[i] = { ...o[i], odds: parseFloat(e.target.value) || 1 }; return { ...p, options: o }; })}
                        />
                      </div>
                      {form.type === "mystery_box" && (
                        <div className="col-span-2 flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">Wt</span>
                          <Input
                            data-testid={`input-option-weight-${i}`}
                            className="h-9 text-sm font-mono"
                            type="number"
                            min="1"
                            value={opt.weight}
                            onChange={e => setForm(p => { const o = [...p.options]; o[i] = { ...o[i], weight: parseInt(e.target.value) || 1 }; return { ...p, options: o }; })}
                          />
                        </div>
                      )}
                      <div className="col-span-2 col-start-12">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9 w-full text-destructive hover:text-destructive"
                          onClick={() => setForm(p => ({ ...p, options: p.options.filter((_, j) => j !== i) }))}
                          data-testid={`button-remove-option-${i}`}
                        >
                          X
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Slots config */}
            {form.type === "slots" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Reels</label>
                  <Input
                    data-testid="input-reel-count"
                    type="number" min="2" max="5"
                    value={form.reelCount}
                    onChange={e => setForm(p => ({ ...p, reelCount: parseInt(e.target.value) || 3 }))}
                    className="w-20 h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground font-medium uppercase">Slot Items (symbols)</label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setForm(p => ({ ...p, slotItems: [...p.slotItems, { label: "", emoji: "", weight: 1, payout: 2 }] }))}
                      data-testid="button-add-slot-item"
                    >
                      Add Item
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-xs text-muted-foreground px-1">
                    <span>Name</span><span>Icon</span><span>Weight</span><span>Payout</span>
                  </div>
                  {form.slotItems.map((item, i) => (
                    <div key={i} className="grid grid-cols-4 gap-2" data-testid={`slot-item-${i}`}>
                      <Input data-testid={`input-slot-label-${i}`} className="h-9 text-sm" placeholder="Label" value={item.label} onChange={e => setForm(p => { const s = [...p.slotItems]; s[i] = { ...s[i], label: e.target.value }; return { ...p, slotItems: s }; })} />
                      <Input data-testid={`input-slot-emoji-${i}`} className="h-9 text-sm text-center" placeholder="Icon" value={item.emoji} onChange={e => setForm(p => { const s = [...p.slotItems]; s[i] = { ...s[i], emoji: e.target.value }; return { ...p, slotItems: s }; })} />
                      <Input data-testid={`input-slot-weight-${i}`} className="h-9 text-sm font-mono" type="number" min="1" value={item.weight} onChange={e => setForm(p => { const s = [...p.slotItems]; s[i] = { ...s[i], weight: parseInt(e.target.value) || 1 }; return { ...p, slotItems: s }; })} />
                      <div className="flex gap-1">
                        <Input data-testid={`input-slot-payout-${i}`} className="h-9 text-sm font-mono" type="number" min="1" value={item.payout} onChange={e => setForm(p => { const s = [...p.slotItems]; s[i] = { ...s[i], payout: parseInt(e.target.value) || 1 }; return { ...p, slotItems: s }; })} />
                        <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-destructive shrink-0" onClick={() => setForm(p => ({ ...p, slotItems: p.slotItems.filter((_, j) => j !== i) }))} data-testid={`button-remove-slot-${i}`}>X</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Number pick config */}
            {form.type === "number_pick" && (
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Min</label>
                  <Input data-testid="input-num-min" type="number" value={form.numMin} onChange={e => setForm(p => ({ ...p, numMin: parseInt(e.target.value) || 1 }))} className="h-10 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Max</label>
                  <Input data-testid="input-num-max" type="number" value={form.numMax} onChange={e => setForm(p => ({ ...p, numMax: parseInt(e.target.value) || 10 }))} className="h-10 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Payout</label>
                  <Input data-testid="input-num-odds" type="number" step="0.5" value={form.numOdds} onChange={e => setForm(p => ({ ...p, numOdds: parseFloat(e.target.value) || 5 }))} className="h-10 font-mono" />
                </div>
              </div>
            )}

            <Button
              className="w-full h-11 font-semibold"
              onClick={handleCreate}
              disabled={!form.title.trim() || createMutation.isPending}
              data-testid="button-create-game"
            >
              {createMutation.isPending ? "Creating..." : "Create Game"}
            </Button>
          </div>
        )}

        {/* Resolve modal */}
        {resolvingGame && (
          <div className="bg-card border border-accent/30 rounded-xl p-6 space-y-4">
            <h2 className="font-bold text-foreground">Resolve Game</h2>
            <p className="text-sm text-muted-foreground">Select the winning option to pay out all bettors.</p>
            <div className="space-y-2">
              {resolvingGame.options.map((opt: any) => (
                <button
                  key={opt.id}
                  data-testid={`button-resolve-option-${opt.id}`}
                  onClick={() => setWinningOptionId(opt.id)}
                  className={`w-full h-11 rounded-lg border-2 flex items-center justify-between px-4 font-medium transition-all ${
                    winningOptionId === opt.id
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border bg-background text-foreground hover:border-accent/50"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-sm text-muted-foreground">{opt.odds}x</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={handleResolve}
                disabled={!winningOptionId || resolveMutation.isPending}
                data-testid="button-confirm-resolve"
              >
                {resolveMutation.isPending ? "Resolving..." : "Confirm & Pay Out"}
              </Button>
              <Button variant="outline" onClick={() => { setResolvingGame(null); setWinningOptionId(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Games list */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">All Games</h2>
          {isLoading && (
            <div className="space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          )}
          {!isLoading && (!games || games.length === 0) && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
              No games yet. Create one above.
            </div>
          )}
          <div className="space-y-3">
            {games?.map(game => (
              <div key={game.id} data-testid={`card-mod-game-${game.id}`} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-foreground">{game.title}</span>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[game.status] ?? ""}`}>
                        {game.status.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{game.type.replace("_", " ")}</span>
                    </div>
                    {game.options && game.options.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {game.options.map(o => (
                          <span key={o.id} className={`text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground ${o.isWinner ? "border border-accent text-accent" : ""}`}>
                            {o.label} {o.odds}x{o.isWinner ? " WIN" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {game.status === "open" && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(game.id, "closed")} data-testid={`button-close-${game.id}`}>
                        Close
                      </Button>
                    )}
                    {game.status === "closed" && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(game.id, "open")} data-testid={`button-reopen-${game.id}`}>
                        Reopen
                      </Button>
                    )}
                    {game.status !== "resolved" && game.type === "match_bet" && game.options && game.options.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs border-accent/40 text-accent hover:bg-accent/10"
                        onClick={() => { setResolvingGame({ id: game.id, options: game.options ?? [] }); setWinningOptionId(null); }}
                        data-testid={`button-resolve-${game.id}`}
                      >
                        Resolve
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleDelete(game.id)}
                      data-testid={`button-delete-${game.id}`}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
