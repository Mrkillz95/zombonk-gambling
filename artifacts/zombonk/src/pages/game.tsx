import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetGame,
  getGetGameQueryKey,
  usePlayGame,
  useGetPlayer,
  getGetPlayerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

interface SlotItem {
  label: string;
  emoji: string;
  weight: number;
  payout: number;
}

function SlotMachine({
  config,
  isSpinning,
  result,
}: {
  config: any;
  isSpinning: boolean;
  result: string[] | null;
}) {
  const items: SlotItem[] = config?.items ?? [
    { label: "Cherry", emoji: "CH", weight: 5, payout: 2 },
    { label: "Bar", emoji: "BR", weight: 4, payout: 3 },
    { label: "Seven", emoji: "7", weight: 2, payout: 5 },
    { label: "Skull", emoji: "SK", weight: 1, payout: 10 },
  ];
  const reelCount = config?.reelCount ?? 3;

  const [displayItems, setDisplayItems] = useState<string[]>(
    Array(reelCount).fill(items[0]?.label ?? "?")
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isSpinning) {
      intervalRef.current = setInterval(() => {
        setDisplayItems(
          Array(reelCount).fill(null).map(() => items[Math.floor(Math.random() * items.length)]?.label ?? "?")
        );
      }, 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (result) {
        setDisplayItems(result);
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isSpinning, result]);

  return (
    <div className="flex gap-3 justify-center my-4">
      {Array(reelCount)
        .fill(null)
        .map((_, i) => (
          <div
            key={i}
            data-testid={`reel-${i}`}
            className={`w-20 h-20 bg-background border-2 rounded-lg flex items-center justify-center overflow-hidden transition-all duration-300 ${
              isSpinning ? "border-primary/60 shadow-[0_0_12px_hsl(142_71%_45%/0.4)]" : "border-border"
            } ${result && !isSpinning && displayItems.every((d) => d === displayItems[0]) ? "border-accent glow-accent" : ""}`}
          >
            <span className="text-xl font-black text-foreground text-center leading-none px-1">
              {displayItems[i] ?? "?"}
            </span>
          </div>
        ))}
    </div>
  );
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const stored = getStoredPlayer();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const gameId = parseInt(id ?? "0", 10);

  useEffect(() => {
    if (!stored) setLocation("/");
  }, [stored, setLocation]);

  const { data: game, isLoading } = useGetGame(gameId, {
    query: { enabled: !!gameId, queryKey: getGetGameQueryKey(gameId) },
  });
  const { data: player } = useGetPlayer(stored?.id ?? 0, {
    query: { enabled: !!stored?.id, queryKey: getGetPlayerQueryKey(stored?.id ?? 0) },
  });

  const playMutation = usePlayGame();

  const [wager, setWager] = useState(10);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [numberPick, setNumberPick] = useState<string>("");
  const [result, setResult] = useState<any | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  const handlePlay = () => {
    if (!stored || !game) return;
    setResult(null);

    if (game.type === "slots") {
      setIsSpinning(true);
    }

    playMutation.mutate(
      {
        id: gameId,
        data: {
          playerId: stored.id,
          wager,
          optionId: selectedOptionId ?? undefined,
          pick: numberPick || undefined,
        },
      },
      {
        onSuccess: (res) => {
          if (game.type === "slots") {
            setTimeout(() => {
              setIsSpinning(false);
              setResult(res);
            }, 1200);
          } else {
            setResult(res);
          }
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(stored.id) });
        },
        onError: (err: any) => {
          setIsSpinning(false);
          const msg = err?.data?.error ?? "Something went wrong";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-8 max-w-xl mx-auto">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Game not found.</p>
      </div>
    );
  }

  const config = game.config as any;
  const isOpen = game.status === "open";

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/lobby">
            <Button variant="ghost" size="sm" data-testid="link-back">
              Back to Lobby
            </Button>
          </Link>
          {player && (
            <Badge variant="outline" className="border-primary/40 text-primary font-mono font-bold" data-testid="text-balance">
              {player.balance.toLocaleString()} coins
            </Badge>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Game header */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-start justify-between mb-2">
            <h1 className="text-2xl font-black text-foreground">{game.title}</h1>
            <Badge
              variant="outline"
              className={isOpen ? "border-green-500/30 text-green-400" : "border-destructive/30 text-destructive"}
            >
              {game.status.toUpperCase()}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">{game.type.replace("_", " ").toUpperCase()}</p>
        </div>

        {/* Game UI */}
        {isOpen && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            {/* SLOTS */}
            {game.type === "slots" && (
              <>
                <SlotMachine
                  config={config}
                  isSpinning={isSpinning}
                  result={result?.reels ?? null}
                />
                {config?.items && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(config.items as SlotItem[]).map((item) => (
                      <div key={item.label} className="flex justify-between text-muted-foreground bg-background rounded px-2 py-1">
                        <span>{item.label}</span>
                        <span className="text-accent">{item.payout}x</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* COIN FLIP */}
            {game.type === "coin_flip" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Choose your side</p>
                <div className="grid grid-cols-2 gap-3">
                  {game.options?.map((opt) => (
                    <button
                      key={opt.id}
                      data-testid={`button-option-${opt.id}`}
                      onClick={() => setSelectedOptionId(opt.id)}
                      className={`h-16 rounded-lg border-2 font-bold text-lg transition-all ${
                        selectedOptionId === opt.id
                          ? "border-primary bg-primary/15 text-primary glow-primary"
                          : "border-border bg-background text-foreground hover:border-primary/50"
                      }`}
                    >
                      {opt.label}
                      <span className="block text-xs text-muted-foreground font-normal">{opt.odds}x</span>
                    </button>
                  ))}
                </div>
                {result && (
                  <div className={`text-center py-3 rounded-lg font-bold text-lg ${result.won ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"}`}>
                    {result.reels?.[0]}
                  </div>
                )}
              </div>
            )}

            {/* MATCH BET */}
            {game.type === "match_bet" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Pick your outcome</p>
                <div className="space-y-2">
                  {game.options?.map((opt) => (
                    <button
                      key={opt.id}
                      data-testid={`button-option-${opt.id}`}
                      onClick={() => setSelectedOptionId(opt.id)}
                      className={`w-full h-12 rounded-lg border-2 flex items-center justify-between px-4 font-medium transition-all ${
                        selectedOptionId === opt.id
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-background text-foreground hover:border-primary/50"
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span className="text-accent font-bold">{opt.odds}x</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* NUMBER PICK */}
            {game.type === "number_pick" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Pick a number between {config?.min ?? 1} and {config?.max ?? 10}
                </p>
                <Input
                  data-testid="input-number-pick"
                  type="number"
                  min={config?.min ?? 1}
                  max={config?.max ?? 10}
                  value={numberPick}
                  onChange={(e) => setNumberPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold"
                  placeholder={`${config?.min ?? 1} – ${config?.max ?? 10}`}
                />
                {result && (
                  <div className={`text-center py-3 rounded-lg font-bold text-lg ${result.won ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"}`}>
                    Drew: {result.reels?.[0]}
                  </div>
                )}
              </div>
            )}

            {/* MYSTERY BOX */}
            {game.type === "mystery_box" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Choose a box</p>
                <div className="grid grid-cols-2 gap-3">
                  {game.options?.map((opt) => (
                    <button
                      key={opt.id}
                      data-testid={`button-option-${opt.id}`}
                      onClick={() => setSelectedOptionId(opt.id)}
                      className={`h-20 rounded-lg border-2 font-bold transition-all ${
                        selectedOptionId === opt.id
                          ? "border-primary bg-primary/15 text-primary glow-primary"
                          : "border-border bg-background text-foreground hover:border-primary/50"
                      }`}
                    >
                      <div className="text-2xl mb-1">?</div>
                      <div className="text-sm">{opt.label}</div>
                      <div className="text-xs text-muted-foreground">{opt.odds}x</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Wager input */}
            <div className="space-y-2 pt-2 border-t border-border">
              <label className="text-sm text-muted-foreground font-medium">Wager (coins)</label>
              <div className="flex gap-2">
                <Input
                  data-testid="input-wager"
                  type="number"
                  min={1}
                  max={player?.balance ?? 9999}
                  value={wager}
                  onChange={(e) => setWager(parseInt(e.target.value, 10) || 1)}
                  className="flex-1 h-11 font-mono font-bold text-lg"
                />
                <div className="flex gap-1">
                  {[10, 50, 100].map((amt) => (
                    <Button
                      key={amt}
                      variant="outline"
                      size="sm"
                      className="h-11 px-3 font-mono"
                      onClick={() => setWager(amt)}
                      data-testid={`button-wager-${amt}`}
                    >
                      {amt}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              className="w-full h-12 text-base font-bold"
              onClick={handlePlay}
              disabled={
                playMutation.isPending ||
                isSpinning ||
                !wager ||
                wager > (player?.balance ?? 0) ||
                ((game.type === "coin_flip" || game.type === "match_bet" || game.type === "mystery_box") && !selectedOptionId) ||
                (game.type === "number_pick" && !numberPick)
              }
              data-testid="button-play"
            >
              {isSpinning ? "Spinning..." : playMutation.isPending ? "Processing..." : "Place Bet"}
            </Button>
          </div>
        )}

        {/* Result */}
        {result && !isSpinning && (
          <div
            data-testid="text-result"
            className={`rounded-xl p-6 text-center border-2 ${
              result.won
                ? "bg-primary/10 border-primary/50 win-flash"
                : "bg-destructive/10 border-destructive/50"
            }`}
          >
            <div className={`text-3xl font-black mb-1 ${result.won ? "text-primary" : "text-destructive"}`}>
              {result.won ? "WIN" : "LOSS"}
            </div>
            <p className="text-foreground font-medium">{result.message}</p>
            {result.won && (
              <p className="text-primary font-bold text-lg mt-1">+{result.payout} coins</p>
            )}
            <p className="text-muted-foreground text-sm mt-2">Balance: {result.newBalance.toLocaleString()} coins</p>
          </div>
        )}

        {!isOpen && (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground">
            This game is {game.status}. Betting is not available.
          </div>
        )}
      </div>
    </div>
  );
}
