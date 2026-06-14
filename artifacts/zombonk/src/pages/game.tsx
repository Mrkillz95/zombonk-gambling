import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetGame, getGetGameQueryKey,
  usePlayGame,
  useGetPlayer, getGetPlayerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ────────────────────────────────────────────────────────────────

const GAME_LABELS: Record<string, string> = {
  slots: "Slot Machine", coin_flip: "Coin Flip", match_bet: "Match Bet",
  number_pick: "Number Pick", mystery_box: "Mystery Box", dice: "Dice Roll",
  roulette: "Roulette", wheel: "Spin the Wheel", card_draw: "Card Draw",
  over_under: "Over / Under", trivia: "Trivia", jackpot: "Jackpot",
  color_pick: "Color Pick", hi_lo: "Hi-Lo", lucky_spin: "Lucky Spin",
};

// Types where player picks an option
const OPTION_TYPES = new Set(["coin_flip","match_bet","mystery_box","roulette","card_draw","over_under","trivia","color_pick","hi_lo","lucky_spin"]);
// Types where player enters a number
const NUMBER_TYPES = new Set(["number_pick","dice","jackpot"]);
// Types with no player choice (just click play)
const AUTO_TYPES = new Set(["wheel"]);

// ── Slot Machine ───────────────────────────────────────────────────────────
function SlotMachine({ config, isSpinning, result }: { config: any; isSpinning: boolean; result: string[] | null }) {
  const items = config?.items ?? [{ label: "Cherry" }, { label: "Bar" }, { label: "Seven" }, { label: "Skull" }];
  const reelCount = config?.reelCount ?? 3;
  const [display, setDisplay] = useState<string[]>(Array(reelCount).fill(items[0]?.label ?? "?"));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isSpinning) {
      timerRef.current = setInterval(() => {
        setDisplay(Array(reelCount).fill(null).map(() => items[Math.floor(Math.random() * items.length)]?.label ?? "?"));
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (result) setDisplay(result);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isSpinning, result]);

  return (
    <div className="flex gap-3 justify-center my-2">
      {Array(reelCount).fill(null).map((_, i) => (
        <div key={i} className={`w-20 h-20 bg-background border-2 rounded-lg flex items-center justify-center transition-all ${isSpinning ? "border-primary/60 shadow-[0_0_12px_hsl(142_71%_45%/0.3)]" : "border-border"}`}>
          <span className="text-base font-black text-foreground text-center leading-none px-1">{display[i] ?? "?"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Option button grid ─────────────────────────────────────────────────────
function OptionGrid({ options, selected, onSelect, columns = 2 }: {
  options: any[]; selected: number | null; onSelect: (id: number) => void; columns?: number;
}) {
  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(columns, options.length)}, 1fr)` }}>
      {options.map((opt) => (
        <button
          key={opt.id}
          data-testid={`button-option-${opt.id}`}
          onClick={() => onSelect(opt.id)}
          className={`h-14 rounded-lg border-2 flex flex-col items-center justify-center font-bold transition-all px-2 ${selected === opt.id ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-foreground hover:border-primary/50"}`}
        >
          <span className="text-sm leading-tight text-center">{opt.label}</span>
          <span className="text-xs text-muted-foreground font-normal mt-0.5">{opt.odds}x</span>
        </button>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const stored = getStoredPlayer();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const gameId = parseInt(id ?? "0", 10);

  useEffect(() => { if (!stored) setLocation("/"); }, [stored]);

  const { data: game, isLoading } = useGetGame(gameId, { query: { enabled: !!gameId, queryKey: getGetGameQueryKey(gameId) } });
  const { data: player } = useGetPlayer(stored?.id ?? 0, { query: { enabled: !!stored?.id, queryKey: getGetPlayerQueryKey(stored?.id ?? 0) } });
  const playMutation = usePlayGame();

  const [wager, setWager] = useState(10);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [numPick, setNumPick] = useState("");
  const [result, setResult] = useState<any | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  if (isLoading) return (
    <div className="min-h-screen bg-background p-8 max-w-xl mx-auto"><Skeleton className="h-8 w-48 mb-4" /><Skeleton className="h-48 rounded-xl" /></div>
  );
  if (!game) return (
    <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Game not found.</p></div>
  );

  const config = game.config as any;
  const isOpen = game.status === "open";
  const type = game.type as string;

  const canPlay = () => {
    if (!wager || wager <= 0 || wager > (player?.balance ?? 0)) return false;
    if (OPTION_TYPES.has(type) && !selectedOptionId) return false;
    if (NUMBER_TYPES.has(type) && !numPick) return false;
    return true;
  };

  const handlePlay = () => {
    if (!stored || !game) return;
    setResult(null);
    if (type === "slots" || type === "wheel") setIsSpinning(true);

    playMutation.mutate(
      { id: gameId, data: { playerId: stored.id, wager, optionId: selectedOptionId ?? undefined, pick: numPick || undefined } },
      {
        onSuccess: (res) => {
          if (type === "slots" || type === "wheel") {
            setTimeout(() => { setIsSpinning(false); setResult(res); }, 1200);
          } else {
            setResult(res);
          }
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(stored.id) });
        },
        onError: (err: any) => {
          setIsSpinning(false);
          toast({ title: err?.data?.error ?? "Something went wrong", variant: "destructive" });
        },
      }
    );
  };

  // Number input bounds per type
  const numMin = type === "dice" ? (config?.dice || 1) : type === "jackpot" ? 1 : (config?.min || 1);
  const numMax = type === "dice" ? ((config?.sides || 6) * (config?.dice || 1)) : type === "jackpot" ? (config?.tickets || 100) : (config?.max || 10);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/lobby"><Button variant="ghost" size="sm" data-testid="link-back">← Lobby</Button></Link>
          {player && (
            <Badge variant="outline" className="border-primary/40 text-primary font-mono font-bold" data-testid="text-balance">
              {player.balance.toLocaleString()} coins
            </Badge>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start justify-between mb-1">
            <h1 className="text-xl font-black text-foreground">{game.title}</h1>
            <Badge variant="outline" className={isOpen ? "border-green-500/30 text-green-400" : "border-destructive/30 text-destructive"}>
              {game.status.toUpperCase()}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">{GAME_LABELS[type] ?? type}</p>
        </div>

        {isOpen && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">

            {/* ── SLOTS ── */}
            {type === "slots" && (
              <>
                <SlotMachine config={config} isSpinning={isSpinning} result={result?.reels ?? null} />
                {config?.items && (
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {config.items.map((item: any) => (
                      <div key={item.label} className="flex justify-between text-muted-foreground bg-background rounded px-2 py-1">
                        <span>{item.label}</span><span className="text-accent font-mono">{item.payout}x</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── WHEEL ── */}
            {type === "wheel" && (
              <div className="space-y-2">
                <div className={`w-32 h-32 mx-auto rounded-full border-4 flex items-center justify-center font-black text-lg transition-all ${isSpinning ? "border-primary animate-spin" : "border-border"}`}>
                  {result && !isSpinning ? <span className="text-primary text-sm text-center px-2">{result.reels?.[0]}</span> : <span className="text-muted-foreground text-sm">SPIN</span>}
                </div>
                {config?.sections && (
                  <div className="grid grid-cols-2 gap-1.5 text-xs mt-2">
                    {config.sections.map((s: any, i: number) => (
                      <div key={i} className="flex justify-between text-muted-foreground bg-background rounded px-2 py-1">
                        <span>{s.label}</span><span className={s.payout > 0 ? "text-primary font-mono" : "text-destructive/60 font-mono"}>{s.payout > 0 ? `${s.payout}x` : "Lose"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── COIN FLIP ── */}
            {type === "coin_flip" && game.options && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Choose your side</p>
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={2} />
              </div>
            )}

            {/* ── MATCH BET / TRIVIA ── */}
            {(type === "match_bet" || type === "trivia") && game.options && (
              <div className="space-y-2">
                {type === "trivia" && config?.question && (
                  <div className="bg-background rounded-lg p-3 text-sm font-medium text-foreground border border-border">
                    {config.question}
                  </div>
                )}
                {type === "match_bet" && <p className="text-sm text-muted-foreground">Pick your outcome</p>}
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={1} />
                <p className="text-xs text-muted-foreground/70">Moderator will resolve this game and pay out winners.</p>
              </div>
            )}

            {/* ── NUMBER PICK ── */}
            {type === "number_pick" && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Pick a number between {config?.min ?? 1} and {config?.max ?? 10}</p>
                <Input data-testid="input-number-pick" type="number" min={numMin} max={numMax} value={numPick} onChange={(e) => setNumPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold" placeholder={`${numMin} – ${numMax}`} />
                <p className="text-xs text-muted-foreground text-right">Payout: {config?.odds ?? 5}x</p>
              </div>
            )}

            {/* ── DICE ── */}
            {type === "dice" && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Roll {config?.dice ?? 1}d{config?.sides ?? 6} — pick your number ({numMin}–{numMax})
                </p>
                <Input data-testid="input-number-pick" type="number" min={numMin} max={numMax} value={numPick} onChange={(e) => setNumPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold" placeholder={`${numMin} – ${numMax}`} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{config?.dice ?? 1} dice × {config?.sides ?? 6} sides</span>
                  <span>Payout: {config?.odds ?? (config?.sides ?? 6)}x</span>
                </div>
              </div>
            )}

            {/* ── JACKPOT ── */}
            {type === "jackpot" && (
              <div className="space-y-3">
                <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-black text-accent">{(config?.jackpot ?? 10000).toLocaleString()} coins</div>
                  <div className="text-xs text-muted-foreground mt-1">JACKPOT</div>
                </div>
                <p className="text-sm text-muted-foreground">Pick ticket #{numMin}–{numMax}</p>
                <Input data-testid="input-number-pick" type="number" min={1} max={config?.tickets ?? 100} value={numPick} onChange={(e) => setNumPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold" placeholder={`1 – ${config?.tickets ?? 100}`} />
                <p className="text-xs text-muted-foreground text-center">Odds: 1 in {config?.tickets ?? 100} tickets</p>
              </div>
            )}

            {/* ── ROULETTE ── */}
            {type === "roulette" && game.options && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Place your bet</p>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, game.options.length)}, 1fr)` }}>
                  {game.options.map((opt) => {
                    const lower = opt.label.toLowerCase();
                    const bg = lower.includes("red") ? "bg-red-950 border-red-600 text-red-300 hover:border-red-400"
                      : lower.includes("black") ? "bg-zinc-900 border-zinc-500 text-zinc-200 hover:border-zinc-300"
                      : lower.includes("green") ? "bg-green-950 border-green-600 text-green-300 hover:border-green-400"
                      : "border-border bg-background text-foreground hover:border-primary/50";
                    const sel = selectedOptionId === opt.id;
                    return (
                      <button key={opt.id} data-testid={`button-option-${opt.id}`} onClick={() => setSelectedOptionId(opt.id)}
                        className={`h-16 rounded-lg border-2 flex flex-col items-center justify-center font-bold transition-all ${sel ? "ring-2 ring-white/30 " : ""}${bg}`}>
                        <span className="text-sm">{opt.label}</span>
                        <span className="text-xs opacity-70 font-normal">{opt.odds}x</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── CARD DRAW ── */}
            {type === "card_draw" && game.options && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Pick a card suit</p>
                <div className="grid grid-cols-2 gap-2">
                  {game.options.map((opt) => {
                    const lower = opt.label.toLowerCase();
                    const isRed = lower.includes("heart") || lower.includes("diamond");
                    return (
                      <button key={opt.id} data-testid={`button-option-${opt.id}`} onClick={() => setSelectedOptionId(opt.id)}
                        className={`h-16 rounded-lg border-2 flex flex-col items-center justify-center font-bold transition-all ${selectedOptionId === opt.id ? "border-primary bg-primary/15 text-primary" : "border-border bg-background hover:border-primary/50"}`}>
                        <span className={`text-xl ${isRed ? "text-red-400" : "text-foreground"}`}>{opt.emoji ?? opt.label}</span>
                        <span className="text-xs text-muted-foreground font-normal mt-0.5">{opt.odds}x</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── OVER / UNDER ── */}
            {type === "over_under" && game.options && (
              <div className="space-y-2">
                <div className="bg-background border border-border rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Line</p>
                  <p className="text-3xl font-black text-foreground">{config?.line ?? 50}</p>
                  <p className="text-xs text-muted-foreground">out of 100</p>
                </div>
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={2} />
              </div>
            )}

            {/* ── HI / LO ── */}
            {type === "hi_lo" && game.options && (
              <div className="space-y-2">
                <div className="bg-background border border-border rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Shown number</p>
                  <p className="text-3xl font-black text-foreground">{config?.shown ?? "?"}</p>
                  <p className="text-xs text-muted-foreground">Will the next number be higher or lower?</p>
                </div>
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={2} />
              </div>
            )}

            {/* ── MYSTERY BOX / COLOR PICK / LUCKY SPIN ── */}
            {(type === "mystery_box" || type === "color_pick" || type === "lucky_spin") && game.options && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {type === "color_pick" ? "Pick a color" : type === "lucky_spin" ? "Pick your spin tier" : "Choose a box"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {game.options.map((opt) => (
                    <button key={opt.id} data-testid={`button-option-${opt.id}`} onClick={() => setSelectedOptionId(opt.id)}
                      className={`h-16 rounded-lg border-2 flex flex-col items-center justify-center font-bold transition-all ${selectedOptionId === opt.id ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-foreground hover:border-primary/50"}`}>
                      {type === "mystery_box" && <div className="text-lg mb-0.5">?</div>}
                      {opt.emoji && <div className="text-lg mb-0.5">{opt.emoji}</div>}
                      <span className="text-sm leading-tight">{opt.label}</span>
                      <span className="text-xs text-muted-foreground font-normal">{opt.odds}x</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Wager ── */}
            <div className="space-y-2 pt-2 border-t border-border">
              <label className="text-sm text-muted-foreground font-medium">Wager</label>
              <div className="flex gap-2">
                <Input data-testid="input-wager" type="number" min={1} max={player?.balance ?? 9999} value={wager}
                  onChange={(e) => setWager(parseInt(e.target.value, 10) || 1)} className="flex-1 h-11 font-mono font-bold text-lg" />
                <div className="flex gap-1">
                  {[10, 50, 100].map((amt) => (
                    <Button key={amt} variant="outline" size="sm" className="h-11 px-3 font-mono" onClick={() => setWager(amt)} data-testid={`button-wager-${amt}`}>{amt}</Button>
                  ))}
                </div>
              </div>
              {player && wager > player.balance && (
                <p className="text-xs text-destructive">Insufficient balance ({player.balance.toLocaleString()} coins)</p>
              )}
            </div>

            <Button className="w-full h-12 text-base font-bold" onClick={handlePlay}
              disabled={playMutation.isPending || isSpinning || !canPlay()} data-testid="button-play">
              {isSpinning ? "Spinning..." : playMutation.isPending ? "Processing..." : "Place Bet"}
            </Button>
          </div>
        )}

        {/* ── Result ── */}
        {result && !isSpinning && (
          <div data-testid="text-result"
            className={`rounded-xl p-5 text-center border-2 ${result.won ? "bg-primary/10 border-primary/50 win-flash" : "bg-destructive/10 border-destructive/50"}`}>
            <div className={`text-3xl font-black mb-1 ${result.won ? "text-primary" : "text-destructive"}`}>
              {result.won ? "WIN" : (type === "match_bet" || type === "trivia") ? "BET PLACED" : "LOSS"}
            </div>
            <p className="text-foreground font-medium text-sm">{result.message}</p>
            {result.won && <p className="text-primary font-bold text-lg mt-1">+{result.payout} coins</p>}
            <p className="text-muted-foreground text-xs mt-2">Balance: {result.newBalance.toLocaleString()} coins</p>
          </div>
        )}

        {!isOpen && (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground">
            This game is <strong>{game.status}</strong>. Betting is not available.
          </div>
        )}
      </div>
    </div>
  );
}
