import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useStartRound, useRoundAction, useGetRound,
  getGetRoundQueryKey, getGetPlayerQueryKey,
  type RoundState,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Local card renderer (kept here so the big game.tsx stays untouched).
function Card({ face, suit, hidden, held, onClick, size = "md" }: {
  face?: string; suit?: string; hidden?: boolean; held?: boolean;
  onClick?: () => void; size?: "sm" | "md";
}) {
  const isRed = suit === "♥" || suit === "♦";
  const cls = size === "sm" ? "w-10 h-14 text-xs" : "w-14 h-20 text-base";
  if (hidden) {
    return (
      <div className={`${cls} rounded-md bg-primary/10 border-2 border-primary/30 flex items-center justify-center text-primary/40 font-black text-2xl shrink-0`}>?</div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`${cls} bg-zinc-100 dark:bg-zinc-200 rounded-md border-2 flex flex-col items-center justify-center gap-0.5 shadow-sm shrink-0 transition-all ${
        held ? "border-primary ring-2 ring-primary/40 -translate-y-1" : "border-zinc-300"
      } ${onClick ? "cursor-pointer hover:-translate-y-0.5" : "cursor-default"}`}
    >
      <span className={`font-black leading-none ${isRed ? "text-red-600" : "text-zinc-900"}`}>{face}</span>
      <span className={`leading-none ${size === "sm" ? "text-lg" : "text-2xl"} ${isRed ? "text-red-500" : "text-zinc-800"}`}>{suit}</span>
      {held && <span className="absolute -bottom-5 text-[10px] font-bold text-primary uppercase">Held</span>}
    </button>
  );
}

const ACTION_LABELS: Record<string, string> = {
  hit: "Hit", stand: "Stand", double: "Double", reveal: "Reveal",
  cashout: "Cash Out", draw: "Draw", higher: "▲ Higher", lower: "▼ Lower",
};

export function RoundGame({ game, playerId, balance }: {
  game: any; playerId: number; balance: number;
}) {
  const queryClient = useQueryClient();
  const type = game.type as string;
  const config = (game.config ?? {}) as any;

  const [round, setRound] = useState<RoundState | null>(null);
  const [wager, setWager] = useState(10);
  const [mineCount, setMineCount] = useState(3);
  const [holds, setHolds] = useState<number[]>([]);
  const [crashDisplay, setCrashDisplay] = useState(1);

  const startMut = useStartRound();
  const actionMut = useRoundAction();
  const busy = startMut.isPending || actionMut.isPending;

  const isActive = round?.status === "active";
  const isResolved = round?.status === "resolved";
  const state = (round?.state ?? {}) as any;
  const error = (startMut.error as any)?.data?.error ?? (actionMut.error as any)?.data?.error ?? null;

  function refreshBalance() {
    queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(playerId) });
  }

  function adopt(r: RoundState) {
    setRound(r);
    refreshBalance();
  }

  function start() {
    setHolds([]);
    setCrashDisplay(1);
    startMut.mutate(
      { id: game.id, data: { playerId, wager, ...(type === "mines" ? { mineCount } : {}) } },
      { onSuccess: adopt }
    );
  }

  function act(action: string, extra: Record<string, unknown> = {}) {
    if (!round) return;
    actionMut.mutate(
      { roundId: round.roundId, data: { playerId, action, ...extra } as any },
      { onSuccess: adopt }
    );
  }

  function playAgain() {
    setRound(null);
    setHolds([]);
    setCrashDisplay(1);
    startMut.reset();
    actionMut.reset();
  }

  // ── Crash: live multiplier + poll for server-side crash ─────────────────────
  const pollEnabled = isActive && type === "crash";
  const { data: polled } = useGetRound(round?.roundId ?? 0, { playerId }, {
    query: {
      enabled: pollEnabled,
      refetchInterval: pollEnabled ? 500 : false,
      queryKey: getGetRoundQueryKey(round?.roundId ?? 0, { playerId }),
    },
  });
  useEffect(() => {
    if (polled && polled.status === "resolved" && round?.status === "active") adopt(polled);
  }, [polled]);

  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!pollEnabled || !state.startedAt) return;
    const growth = state.growth ?? 0.15;
    const tick = () => {
      const m = Math.exp(growth * Math.max(0, Date.now() - state.startedAt) / 1000);
      setCrashDisplay(Math.round(m * 100) / 100);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pollEnabled, state.startedAt, state.growth]);

  const insufficient = wager > balance;

  // ── Pre-round setup panel ───────────────────────────────────────────────────
  if (!round) {
    return (
      <div className="space-y-4">
        <SetupBlurb type={type} />
        {type === "mines" && (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground font-medium">Number of mines (1–{config.maxMines ?? 24})</label>
            <Input data-testid="input-mine-count" type="number" min={1} max={config.maxMines ?? 24} value={mineCount}
              onChange={(e) => setMineCount(Math.max(1, Math.min(config.maxMines ?? 24, parseInt(e.target.value, 10) || 1)))}
              className="h-12 text-xl text-center font-bold" />
            <p className="text-xs text-muted-foreground text-right">More mines = bigger multiplier per safe tile</p>
          </div>
        )}
        <WagerRow wager={wager} setWager={setWager} balance={balance} insufficient={insufficient} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button className="w-full h-12 text-base font-bold" onClick={start} data-testid="button-start-round"
          disabled={busy || insufficient || wager <= 0}>
          {busy ? "Dealing…" : START_LABELS[type] ?? "Start"}
        </Button>
      </div>
    );
  }

  // ── Active / resolved game surface ──────────────────────────────────────────
  return (
    <div className="space-y-4">
      <AnimatePresence>
        {isResolved && (
          <motion.div key="flash" className={`fixed inset-0 pointer-events-none z-40 ${round.won ? "bg-primary" : round.payout > 0 ? "bg-amber-400" : "bg-destructive"}`}
            initial={{ opacity: 0.18 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }} />
        )}
      </AnimatePresence>

      {type === "blackjack" && <Blackjack state={state} resolved={isResolved} />}
      {type === "mines" && <Mines state={state} resolved={isResolved} onReveal={(t) => act("reveal", { tile: t })} busy={busy} />}
      {type === "video_poker" && <VideoPoker state={state} resolved={isResolved} holds={holds} setHolds={setHolds} />}
      {type === "hi_lo" && <HiLo state={state} resolved={isResolved} />}
      {type === "crash" && <Crash state={state} resolved={isResolved} display={crashDisplay} won={round.won ?? null} />}

      {/* Message */}
      <p className={`text-sm text-center font-medium ${isResolved ? (round.won ? "text-primary" : round.payout > 0 ? "text-amber-400" : "text-destructive") : "text-muted-foreground"}`} data-testid="text-round-message">
        {round.message}
      </p>
      {isResolved && (
        <p className="text-center text-xs text-muted-foreground" data-testid="text-round-result">
          {round.won ? `Won ${round.payout.toLocaleString()} coins` : round.payout > 0 ? `${round.payout.toLocaleString()} coins returned` : `Lost ${round.wager.toLocaleString()} coins`}
          {" · Balance "}{round.newBalance.toLocaleString()}
        </p>
      )}

      {error && <p className="text-xs text-destructive text-center">{error}</p>}

      {/* Action buttons while active */}
      {isActive && round.actions.length > 0 && (
        <div className={`grid gap-2 ${round.actions.length >= 3 ? "grid-cols-3" : round.actions.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {round.actions.map((a) => {
            // Mines reveal happens by clicking tiles, not a button.
            if (type === "mines" && a === "reveal") return null;
            const isCash = a === "cashout";
            return (
              <Button key={a} data-testid={`button-action-${a}`}
                onClick={() => act(a, type === "video_poker" && a === "draw" ? { hold: holds } : {})}
                disabled={busy}
                className={`h-12 font-bold ${isCash ? "bg-amber-500 hover:bg-amber-600 text-black" : ""}`}
                variant={isCash ? "default" : "secondary"}>
                {ACTION_LABELS[a] ?? a}
              </Button>
            );
          })}
        </div>
      )}
      {type === "mines" && isActive && (
        <p className="text-xs text-center text-muted-foreground">Tap a tile to reveal it.</p>
      )}

      {isResolved && (
        <Button className="w-full h-12 text-base font-bold" onClick={playAgain} data-testid="button-play-again" disabled={busy}>
          Play Again
        </Button>
      )}
    </div>
  );
}

const START_LABELS: Record<string, string> = {
  blackjack: "Deal", mines: "Start Game", video_poker: "Deal", hi_lo: "Start", crash: "Launch 🚀",
};

function SetupBlurb({ type }: { type: string }) {
  const text: Record<string, string> = {
    blackjack: "Beat the dealer without going over 21. Hit, stand, or double down.",
    mines: "Reveal safe tiles to grow your multiplier — but one mine ends it. Cash out any time.",
    video_poker: "Get dealt 5 cards, hold the ones you want, and draw for the best hand.",
    hi_lo: "Guess if the next card is higher or lower. Chain correct guesses for a bigger multiplier.",
    crash: "Watch the multiplier climb and cash out before it crashes.",
  };
  return <p className="text-sm text-muted-foreground text-center">{text[type] ?? ""}</p>;
}

function WagerRow({ wager, setWager, balance, insufficient }: {
  wager: number; setWager: (n: number) => void; balance: number; insufficient: boolean;
}) {
  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <label className="text-sm text-muted-foreground font-medium">Wager</label>
      <div className="flex gap-2">
        <Input data-testid="input-wager" type="number" min={1} max={balance} value={wager}
          onChange={(e) => setWager(parseInt(e.target.value, 10) || 1)} className="flex-1 h-11 font-mono font-bold text-lg" />
        <div className="flex gap-1">
          {[10, 50, 100].map((amt) => (
            <Button key={amt} variant="outline" size="sm" className="h-11 px-3 font-mono" onClick={() => setWager(amt)} data-testid={`button-wager-${amt}`}>{amt}</Button>
          ))}
        </div>
      </div>
      {insufficient && <p className="text-xs text-destructive">Insufficient balance ({balance.toLocaleString()} coins)</p>}
    </div>
  );
}

// ── Per-game surfaces ─────────────────────────────────────────────────────────
function Blackjack({ state, resolved }: { state: any; resolved: boolean }) {
  const dealer: any[] = state.dealer ?? [];
  return (
    <div className="space-y-4 py-2">
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Dealer — <span className="text-foreground font-bold">{resolved ? state.dealerTotal : state.dealerTotal + " + ?"}</span></p>
        <div className="flex gap-2 flex-wrap">
          {dealer.map((c, i) => <Card key={i} face={c.face} suit={c.suit} />)}
          {state.dealerHidden && <Card hidden />}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">You — <span className={`font-bold ${state.playerTotal > 21 ? "text-destructive" : "text-foreground"}`}>{state.playerTotal}</span>{state.doubled ? " · doubled" : ""}</p>
        <div className="flex gap-2 flex-wrap">
          {(state.player ?? []).map((c: any, i: number) => <Card key={i} face={c.face} suit={c.suit} />)}
        </div>
      </div>
    </div>
  );
}

function Mines({ state, resolved, onReveal, busy }: {
  state: any; resolved: boolean; onReveal: (t: number) => void; busy: boolean;
}) {
  const revealed: number[] = state.revealed ?? [];
  const mines: number[] = state.minePositions ?? [];
  const bustTile: number | undefined = state.bustTile;
  return (
    <div className="space-y-2 py-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{state.mineCount} mines</span>
        <span>Current <span className="text-primary font-bold">{state.multiplier}x</span>{!resolved && state.nextMultiplier ? <> · next {state.nextMultiplier}x</> : null}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 25 }).map((_, i) => {
          const isRevealed = revealed.includes(i);
          const isMine = resolved && mines.includes(i);
          const isBust = i === bustTile;
          return (
            <button key={i} data-testid={`tile-${i}`}
              disabled={resolved || isRevealed || busy}
              onClick={() => onReveal(i)}
              className={`aspect-square rounded-md border-2 flex items-center justify-center text-lg font-bold transition-all ${
                isBust ? "bg-destructive border-destructive text-white" :
                isMine ? "bg-destructive/15 border-destructive/40 text-destructive/70" :
                isRevealed ? "bg-primary/20 border-primary text-primary" :
                resolved ? "bg-background border-border opacity-50" :
                "bg-background border-border hover:border-primary/60 cursor-pointer"
              }`}>
              {isBust || isMine ? "💣" : isRevealed ? "💎" : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VideoPoker({ state, resolved, holds, setHolds }: {
  state: any; resolved: boolean; holds: number[]; setHolds: (h: number[]) => void;
}) {
  const hand: any[] = state.hand ?? [];
  const toggle = (i: number) => setHolds(holds.includes(i) ? holds.filter((h) => h !== i) : [...holds, i]);
  return (
    <div className="space-y-3 py-2">
      <div className="flex gap-2 justify-center flex-wrap pb-5">
        {hand.map((c, i) => (
          <Card key={i} face={c.face} suit={c.suit} held={!resolved && holds.includes(i)} onClick={resolved ? undefined : () => toggle(i)} />
        ))}
      </div>
      {resolved && state.handName && (
        <p className="text-center text-sm font-bold text-primary">{state.handName}{state.multiplier ? ` · ${state.multiplier}x` : ""}</p>
      )}
      {!resolved && <p className="text-center text-xs text-muted-foreground">Tap cards to hold, then draw.</p>}
    </div>
  );
}

function HiLo({ state, resolved }: { state: any; resolved: boolean }) {
  const cur = state.current ?? {};
  const next = state.next;
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-center gap-4">
        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground">Current</p>
          <Card face={cur.face} suit={cur.suit} />
        </div>
        {resolved && next && (
          <>
            <span className="text-muted-foreground text-sm">→</span>
            <div className="text-center space-y-1">
              <p className="text-xs text-muted-foreground">Next</p>
              <Card face={next.face} suit={next.suit} />
            </div>
          </>
        )}
      </div>
      <p className="text-center text-sm">
        <span className="text-primary font-bold">{state.multiplier}x</span>
        <span className="text-muted-foreground"> · streak {state.streak ?? 0}</span>
      </p>
    </div>
  );
}

function Crash({ state, resolved, display, won }: {
  state: any; resolved: boolean; display: number; won: boolean | null;
}) {
  const shown = resolved ? (state.multiplier ?? state.crashPoint) : display;
  return (
    <div className="space-y-2 py-4 text-center">
      <motion.p
        className={`text-6xl font-black tabular-nums ${resolved ? (won ? "text-primary" : "text-destructive") : "text-yellow-400"}`}
        animate={resolved ? { scale: [1, 1.15, 1] } : {}}
        transition={{ type: "spring", stiffness: 300, damping: 14 }}>
        {Number(shown).toFixed(2)}x
      </motion.p>
      {resolved && state.crashed && <p className="text-xs text-destructive font-bold">💥 Crashed at {state.crashPoint}x</p>}
      {!resolved && <p className="text-xs text-muted-foreground">Cash out before it crashes!</p>}
    </div>
  );
}
