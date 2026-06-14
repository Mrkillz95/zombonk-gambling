import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { secureRandom } from "@/lib/secure-random";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ────────────────────────────────────────────────────────────────

const GAME_LABELS: Record<string, string> = {
  slots: "Slot Machine", coin_flip: "Coin Flip", match_bet: "Match Bet",
  number_pick: "Number Pick", mystery_box: "Mystery Box", dice: "Dice Roll",
  roulette: "Roulette", wheel: "Spin the Wheel", card_draw: "Card Draw",
  over_under: "Over / Under", trivia: "Trivia", jackpot: "Jackpot",
  color_pick: "Color Pick", hi_lo: "Hi-Lo", lucky_spin: "Lucky Spin",
  plinko: "Plinko", blackjack: "Blackjack", crash: "Crash",
  keno: "Keno", scratch_card: "Scratch Card", video_poker: "Video Poker",
  mines: "Minesweeper", war: "War", baccarat: "Baccarat",
  three_card_poker: "Three Card Poker", dragon_tiger: "Dragon Tiger",
  sic_bo: "Sic Bo",
};

// Types where player picks an option
const OPTION_TYPES = new Set(["coin_flip","match_bet","mystery_box","roulette","card_draw","over_under","trivia","color_pick","hi_lo","lucky_spin","blackjack","baccarat","dragon_tiger","sic_bo"]);
// Types where player enters a number
const NUMBER_TYPES = new Set(["number_pick","dice","jackpot","crash","keno","mines"]);
// Types with no player choice (just click play)
const AUTO_TYPES = new Set(["wheel","plinko","scratch_card","video_poker","war","three_card_poker"]);

// ── Slot Machine ───────────────────────────────────────────────────────────
function SlotMachine({ config, isSpinning, result, won }: {
  config: any; isSpinning: boolean; result: string[] | null; won?: boolean;
}) {
  const items = useMemo(
    () => config?.items ?? [{ label: "🍒" }, { label: "BAR" }, { label: "7" }, { label: "💀" }],
    [config]
  );
  const reelCount = config?.reelCount ?? 3;

  const [spinDisplay, setSpinDisplay] = useState<string[]>(() => Array(reelCount).fill("?"));
  const [stoppedValues, setStoppedValues] = useState<(string | null)[]>(() => Array(reelCount).fill(null));

  useEffect(() => {
    if (isSpinning) setStoppedValues(Array(reelCount).fill(null));
  }, [isSpinning, reelCount]);

  useEffect(() => {
    if (isSpinning || !result) return;
    const timers = result.map((val, i) =>
      setTimeout(() => {
        setStoppedValues(prev => { const n = [...prev]; n[i] = val; return n; });
      }, i * 340 + 60)
    );
    return () => timers.forEach(clearTimeout);
  }, [isSpinning, result]);

  useEffect(() => {
    if (!isSpinning) return;
    const iv = setInterval(() => {
      setSpinDisplay(Array(reelCount).fill(null).map(
        () => items[Math.floor(secureRandom() * items.length)]?.label ?? "?"
      ));
    }, 85);
    return () => clearInterval(iv);
  }, [isSpinning, reelCount, items]);

  return (
    <div className="flex gap-3 justify-center my-2">
      {Array(reelCount).fill(null).map((_, i) => {
        const stopped = stoppedValues[i] !== null;
        const val = stopped ? stoppedValues[i]! : spinDisplay[i] ?? "?";
        return (
          <motion.div
            key={i}
            animate={stopped ? { scale: [1, 1.18, 0.92, 1.06, 1], y: [0, -7, 3, -2, 0] } : {}}
            transition={{ duration: 0.38, ease: "easeOut" }}
            className={`w-20 h-20 bg-background border-2 rounded-lg flex items-center justify-center overflow-hidden relative transition-shadow ${
              stopped && won
                ? "border-primary shadow-[0_0_22px_hsl(142_71%_45%/0.55)]"
                : !stopped && isSpinning
                  ? "border-primary/50 shadow-[0_0_8px_hsl(142_71%_45%/0.2)]"
                  : "border-border"
            }`}
          >
            <motion.span
              key={val + i}
              initial={!stopped ? { y: 14, opacity: 0 } : false}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.07 }}
              className="text-base font-black text-foreground text-center leading-none px-1 select-none"
            >
              {val}
            </motion.span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Plinko Board ─────────────────────────────────────────────────────────────
function PlinkoBoard({ multipliers, path, slot, isDropping, won, onComplete }: {
  multipliers: number[]; path: string[]; slot: number;
  isDropping: boolean; won: boolean; onComplete?: () => void;
}) {
  const numRows = path.length;
  const numSlots = multipliers.length;
  const BOARD_W = 300;
  const SLOT_H = 34;
  const PEG_H = 190;
  const colW = BOARD_W / numSlots;
  const rowH = PEG_H / (numRows + 1);
  const BALL_R = 7;

  // Compute ball position keyframes from path
  const startX = (numSlots / 2) * colW - BALL_R;
  const xFrames: number[] = [startX];
  const yFrames: number[] = [-BALL_R];
  let cx = startX;
  for (const move of path) {
    cx += move === "R" ? colW / 2 : -colW / 2;
    cx = Math.max(BALL_R, Math.min(BOARD_W - BALL_R - colW / 2, cx));
    xFrames.push(cx);
    yFrames.push((xFrames.length - 1) * rowH);
  }
  xFrames.push(slot * colW + colW / 2 - BALL_R);
  yFrames.push(PEG_H - BALL_R);
  const times = xFrames.map((_, i) => i / Math.max(1, xFrames.length - 1));
  const duration = Math.max(numRows * 0.24 + 0.4, 1.2);

  // Peg dots
  const pegs: { x: number; y: number }[] = [];
  for (let row = 0; row < numRows; row++) {
    const n = row + 2;
    const offsetX = (numSlots - n) / 2;
    for (let p = 0; p < n; p++) {
      pegs.push({ x: (offsetX + p) * colW + colW / 2, y: (row + 0.5) * rowH });
    }
  }

  return (
    <div className="flex justify-center">
      <div className="relative" style={{ width: BOARD_W, height: PEG_H + SLOT_H }}>
        {pegs.map((peg, i) => (
          <div key={i} className="absolute rounded-full bg-zinc-500/60"
            style={{ width: 6, height: 6, left: peg.x - 3, top: peg.y - 3 }} />
        ))}
        {multipliers.map((m, i) => {
          const isLanded = !isDropping && i === slot && path.length > 0;
          return (
            <div key={i}
              className={`absolute flex items-center justify-center text-xs font-bold rounded border transition-all ${
                isLanded && won ? "bg-primary border-primary text-primary-foreground" :
                isLanded && m > 0 ? "bg-amber-400/20 border-amber-400 text-amber-400" :
                isLanded ? "bg-destructive/20 border-destructive text-destructive" :
                m > 1 ? "bg-primary/10 border-primary/30 text-primary" :
                "bg-background border-border text-muted-foreground"
              }`}
              style={{ left: i * colW + 1, top: PEG_H, width: colW - 2, height: SLOT_H - 2 }}
            >
              {m}x
            </div>
          );
        })}
        {isDropping && path.length > 0 && (
          <motion.div
            className="absolute rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.7)] z-10"
            style={{ width: BALL_R * 2, height: BALL_R * 2, left: 0, top: 0 }}
            initial={{ x: startX, y: -BALL_R }}
            animate={{ x: xFrames, y: yFrames }}
            transition={{ duration, times, ease: "linear" }}
            onAnimationComplete={onComplete}
          />
        )}
      </div>
    </div>
  );
}

// ── Crash Meter ───────────────────────────────────────────────────────────────
function CrashMeter({ crashPoint, targetMult, won, onComplete }: {
  crashPoint: number; targetMult: number; won: boolean; onComplete: () => void;
}) {
  const [display, setDisplay] = useState(1.0);
  const duration = Math.min(4.0, 1.0 + crashPoint * 0.45);

  useEffect(() => {
    const start = performance.now();
    let id: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1000 / duration, 1);
      const eased = t < 1 ? 1 - Math.pow(1 - t, 2) : 1;
      setDisplay(1 + (crashPoint - 1) * eased);
      if (t < 1) { id = requestAnimationFrame(tick); }
      else { setTimeout(onComplete, 700); }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const progress = Math.min((display - 1) / Math.max(crashPoint - 1, 0.01), 1);
  const peaked = display >= crashPoint * 0.99;
  const crashedBefore = crashPoint < targetMult;

  return (
    <div className="space-y-3 py-2">
      <div className="text-center space-y-1">
        <motion.p
          className={`text-5xl font-black tabular-nums transition-colors ${
            peaked ? (won ? "text-primary" : "text-destructive") : "text-yellow-400"
          }`}
          animate={peaked ? { scale: [1, 1.18, 1] } : {}}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
        >
          {display.toFixed(2)}x
        </motion.p>
        <p className="text-xs text-muted-foreground">
          Your target: <span className="font-bold text-foreground">{targetMult}x</span>
        </p>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            peaked && crashedBefore ? "bg-destructive" : "bg-yellow-400"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {peaked && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-xs text-center font-bold ${won ? "text-primary" : "text-destructive"}`}
        >
          {won ? `✅ Survived to ${crashPoint}x!` : `💥 Crashed at ${crashPoint}x`}
        </motion.p>
      )}
    </div>
  );
}

// ── Win particles ───────────────────────────────────────────────────────────
function WinParticles() {
  const particles = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      angle: (i / 14) * 360 + (secureRandom() - 0.5) * 18,
      dist: 65 + secureRandom() * 70,
      delay: secureRandom() * 0.18,
      scale: 0.8 + secureRandom() * 0.7,
      sym: ["🪙", "⭐", "💰", "✨", "🎉"][i % 5],
    })), []
  );
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
      {particles.map(p => {
        const rad = (p.angle * Math.PI) / 180;
        return (
          <motion.span
            key={p.id}
            className="absolute text-xl select-none"
            initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
            animate={{ x: Math.cos(rad) * p.dist, y: Math.sin(rad) * p.dist - 20, opacity: 0, scale: p.scale, rotate: p.angle }}
            transition={{ duration: 0.85, delay: p.delay, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {p.sym}
          </motion.span>
        );
      })}
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
          {opt.imageUrl && (
            <img src={opt.imageUrl} alt="" className="h-5 w-5 object-cover rounded mb-0.5"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          )}
          <span className="text-sm leading-tight text-center">{opt.label}</span>
          <span className="text-xs text-muted-foreground font-normal mt-0.5">{opt.displayOdds ?? `${opt.odds}x`}</span>
        </button>
      ))}
    </div>
  );
}

// ── Playing Card ───────────────────────────────────────────────────────────
function PlayingCard({ face, suit, size = "md" }: { face: string; suit: string; size?: "sm" | "md" }) {
  const isRed = suit === "♥" || suit === "♦";
  const cls = size === "sm" ? "w-9 h-12 text-xs" : "w-12 h-16 text-sm";
  return (
    <div className={`${cls} bg-zinc-100 dark:bg-zinc-200 rounded border border-zinc-300 flex flex-col items-center justify-center gap-0.5 shadow-sm shrink-0`}>
      <span className={`font-black leading-none ${isRed ? "text-red-600" : "text-zinc-900"}`}>{face}</span>
      <span className={`leading-none ${size === "sm" ? "text-base" : "text-xl"} ${isRed ? "text-red-500" : "text-zinc-800"}`}>{suit}</span>
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
  const [pendingReels, setPendingReels] = useState<string[] | null>(null);
  const [pendingResult, setPendingResult] = useState<any | null>(null);
  const [isPlinkoDropping, setIsPlinkoDropping] = useState(false);
  const [isCrashAnimating, setIsCrashAnimating] = useState(false);

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
    setPendingReels(null);
    setPendingResult(null);
    setIsPlinkoDropping(false);
    setIsCrashAnimating(false);
    if (type === "slots" || type === "wheel") setIsSpinning(true);

    playMutation.mutate(
      { id: gameId, data: { playerId: stored.id, wager, optionId: selectedOptionId ?? undefined, pick: numPick || undefined } },
      {
        onSuccess: (res) => {
          if (type === "slots") {
            const reelCount = (game.config as any)?.reelCount ?? 3;
            const staggerMs = (reelCount - 1) * 340 + 900;
            setTimeout(() => { setIsSpinning(false); setPendingReels(res.reels); }, 1100);
            setTimeout(() => { setResult(res); setPendingReels(null); }, 1100 + staggerMs);
          } else if (type === "wheel") {
            setTimeout(() => { setIsSpinning(false); setResult(res); }, 1600);
          } else if (type === "plinko") {
            setPendingResult(res);
            setIsPlinkoDropping(true);
          } else if (type === "crash") {
            setPendingResult(res);
            setIsCrashAnimating(true);
          } else {
            setResult(res);
          }
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(stored.id) });
        },
        onError: (err: any) => {
          setIsSpinning(false);
          setPendingReels(null);
          setIsPlinkoDropping(false);
          setIsCrashAnimating(false);
          toast({ title: err?.data?.error ?? "Something went wrong", variant: "destructive" });
        },
      }
    );
  };

  // Number input bounds per type
  const numMin = type === "dice" ? (config?.dice || 1) : type === "jackpot" ? 1 : (config?.min || 1);
  const numMax = type === "dice" ? ((config?.sides || 6) * (config?.dice || 1)) : type === "jackpot" ? (config?.tickets || 100) : (config?.max || 10);

  // A partial return: the bet didn't "win", but some coins came back (e.g. plinko
  // sub-1x slots, blackjack push). Shown distinctly so it doesn't read as a total loss.
  const isPartialReturn = !!result && !result.won && result.payout > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Screen flash on result ── */}
      <AnimatePresence>
        {result && (
          <motion.div
            key={`flash-${result.betId ?? result.payout}`}
            className={`fixed inset-0 pointer-events-none z-50 ${result.won ? "bg-primary" : isPartialReturn ? "bg-amber-400" : "bg-destructive"}`}
            initial={{ opacity: result.won ? 0.22 : 0.18 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

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
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {config?.bannerImage && (
            <img src={config.bannerImage} alt="Game banner"
              className="w-full h-32 object-cover"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          )}
          <div className="p-5">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-black text-foreground">{game.title}</h1>
                {config?.badgeText && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-semibold border border-primary/25">
                    {config.badgeText}
                  </span>
                )}
              </div>
              <Badge variant="outline" className={isOpen ? "border-green-500/30 text-green-400" : "border-destructive/30 text-destructive"}>
                {game.status.toUpperCase()}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">{GAME_LABELS[type] ?? type}</p>
            {config?.description && (
              <p className="text-sm text-foreground/80 mt-2 leading-relaxed">{config.description}</p>
            )}
            {config?.displayOddsText && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">{config.displayOddsText}</p>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">

            {/* ── SLOTS ── */}
            {type === "slots" && (
              <>
                <SlotMachine config={config} isSpinning={isSpinning} result={pendingReels ?? result?.reels ?? null} won={!!result?.won} />
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
                <motion.div
                  animate={isSpinning ? { rotate: [0, 360] } : { rotate: 0 }}
                  transition={isSpinning ? { duration: 0.5, repeat: Infinity, ease: "linear" } : { duration: 0.9, ease: [0.33, 1, 0.68, 1] }}
                  className={`w-32 h-32 mx-auto rounded-full border-4 flex items-center justify-center font-black text-lg ${isSpinning ? "border-primary shadow-[0_0_18px_hsl(142_71%_45%/0.4)]" : result?.won ? "border-primary" : "border-border"}`}
                >
                  {result && !isSpinning
                    ? <span className="text-primary text-sm text-center px-2">{result.reels?.[0]}</span>
                    : <span className="text-muted-foreground text-sm">SPIN</span>
                  }
                </motion.div>
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

            {/* ── PLINKO ── */}
            {type === "plinko" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  {isPlinkoDropping ? "Ball dropping…" : "Drop the ball through the pegs!"}
                </p>
                <PlinkoBoard
                  multipliers={config?.multipliers ?? [0.3,0.5,1,2,5,2,1,0.5,0.3]}
                  path={(isPlinkoDropping ? pendingResult : result)?.details?.path ?? []}
                  slot={(isPlinkoDropping ? pendingResult : result)?.details?.slot ?? -1}
                  isDropping={isPlinkoDropping}
                  won={!!(isPlinkoDropping ? pendingResult : result)?.won}
                  onComplete={() => {
                    setIsPlinkoDropping(false);
                    setResult(pendingResult);
                    setPendingResult(null);
                  }}
                />
                {result?.details && (result.details as any).path && (
                  <p className="text-xs text-center text-muted-foreground font-mono">
                    Path: {(result.details as any).path.join("")}
                  </p>
                )}
              </div>
            )}

            {/* ── BLACKJACK ── */}
            {type === "blackjack" && game.options && (
              <div className="space-y-3">
                {result?.details && (
                  <div className="space-y-2 pb-2 border-b border-border">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Your hand — <span className="text-foreground font-bold">{(result.details as any).playerTotal}</span></p>
                      <div className="flex gap-2 flex-wrap">
                        {(result.details as any).playerCards.map((c: any, i: number) => <PlayingCard key={i} face={c.face} suit={c.suit} />)}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Dealer — <span className="text-foreground font-bold">{(result.details as any).dealerTotal}</span></p>
                      <div className="flex gap-2 flex-wrap">
                        {(result.details as any).dealerCards.map((c: any, i: number) => <PlayingCard key={i} face={c.face} suit={c.suit} />)}
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Choose your move — cards dealt after</p>
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={2} />
              </div>
            )}

            {/* ── CRASH ── */}
            {type === "crash" && (
              <div className="space-y-3">
                {isCrashAnimating && pendingResult?.details && (
                  <CrashMeter
                    crashPoint={(pendingResult.details as any).crashPoint}
                    targetMult={(pendingResult.details as any).target}
                    won={!!pendingResult.won}
                    onComplete={() => {
                      setIsCrashAnimating(false);
                      setResult(pendingResult);
                      setPendingResult(null);
                    }}
                  />
                )}
                {!isCrashAnimating && result?.details && (
                  <div className="flex gap-6 justify-center py-2">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Crashed at</p>
                      <p className={`text-3xl font-black ${result.won ? "text-primary" : "text-destructive"}`}>{(result.details as any).crashPoint}x</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Your target</p>
                      <p className="text-3xl font-black text-foreground">{(result.details as any).target}x</p>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Enter your cashout multiplier (min 1.1×)</p>
                <Input data-testid="input-number-pick" type="number" min="1.1" max={config?.maxTarget ?? 100} step="0.1"
                  value={numPick} onChange={(e) => setNumPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold" placeholder="e.g. 2.0" />
                <p className="text-xs text-muted-foreground text-right">Higher target = higher risk & reward</p>
              </div>
            )}

            {/* ── KENO ── */}
            {type === "keno" && (
              <div className="space-y-3">
                {result?.details && (
                  <div className="space-y-1 pb-2 border-b border-border text-sm">
                    <p className="text-muted-foreground text-xs">Your numbers: {(result.details as any).playerNumbers.join(", ")}</p>
                    <p className="text-muted-foreground text-xs">Drawn: {(result.details as any).drawn.slice(0,10).join(", ")}{(result.details as any).drawn.length > 10 ? "…" : ""}</p>
                    <p className="font-bold text-foreground">
                      Matched: {(result.details as any).matches} / {(result.details as any).spots}
                      {(result.details as any).multiplier > 0 && <span className="text-primary"> → {(result.details as any).multiplier}x</span>}
                    </p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Pick 1–{config?.maxSpots ?? 10} spots. More spots = higher potential payout.</p>
                <Input data-testid="input-number-pick" type="number" min="1" max={config?.maxSpots ?? 10}
                  value={numPick} onChange={(e) => setNumPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold" placeholder={`1 – ${config?.maxSpots ?? 10}`} />
                <p className="text-xs text-muted-foreground">20 numbers drawn from a pool of 80</p>
              </div>
            )}

            {/* ── SCRATCH CARD ── */}
            {type === "scratch_card" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Scratch to reveal — match 3 for big prizes!</p>
                <div className="grid grid-cols-3 gap-3">
                  {(result?.reels ?? ["?","?","?"]).map((sym: string, i: number) => {
                    const allMatch = result?.reels && result.reels.every((s: string) => s === result.reels[0]);
                    const twoMatch = result?.reels && !allMatch && (result.reels[0]===result.reels[1]||result.reels[1]===result.reels[2]||result.reels[0]===result.reels[2]);
                    const thisMatch = result && (allMatch || (twoMatch && (
                      (i===0&&(result.reels[0]===result.reels[1]||result.reels[0]===result.reels[2])) ||
                      (i===1&&(result.reels[0]===result.reels[1]||result.reels[1]===result.reels[2])) ||
                      (i===2&&(result.reels[0]===result.reels[2]||result.reels[1]===result.reels[2]))
                    )));
                    return (
                      <div key={i} className={`h-20 rounded-xl border-2 flex items-center justify-center text-center font-bold text-xs px-2 transition-all ${
                        !result ? "border-border bg-background text-muted-foreground" :
                        allMatch ? "border-primary bg-primary/10 text-primary" :
                        thisMatch ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-400" :
                        "border-border bg-background text-foreground/50"
                      }`}>
                        {result ? <span>{sym}</span> : <span className="text-2xl">?</span>}
                      </div>
                    );
                  })}
                </div>
                {!result && config?.symbols && (
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {config.symbols.map((s: any) => (
                      <div key={s.label} className="flex justify-between text-muted-foreground bg-background rounded px-2 py-1">
                        <span>{s.label}</span><span className="text-accent font-mono">{s.payout}x</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── VIDEO POKER ── */}
            {type === "video_poker" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">5-card deal — best hand wins!</p>
                {result?.details ? (
                  <div className="space-y-2">
                    <div className="flex gap-2 justify-center flex-wrap">
                      {(result.details as any).cards.map((c: any, i: number) => <PlayingCard key={i} face={c.face} suit={c.suit} />)}
                    </div>
                    <p className="text-center text-sm font-bold text-primary">{(result.details as any).handName}</p>
                  </div>
                ) : (
                  <div className="flex gap-2 justify-center">
                    {Array(5).fill(null).map((_,i) => (
                      <div key={i} className="w-12 h-16 bg-primary/10 border-2 border-primary/30 rounded flex items-center justify-center text-primary/40 font-bold text-xl">?</div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {[["Royal Flush","800x"],["Straight Flush","50x"],["4 of a Kind","25x"],["Full House","9x"],["Flush","6x"],["Straight","4x"],["3 of a Kind","3x"],["Two Pair","2x"],["Jacks or Better","1x"]].map(([h,p]) => (
                    <div key={h} className="flex justify-between text-muted-foreground bg-background rounded px-2 py-1">
                      <span>{h}</span><span className="text-accent font-mono">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── MINES ── */}
            {type === "mines" && (
              <div className="space-y-3">
                {result?.details && (
                  <div className="space-y-1 pb-2 border-b border-border">
                    <div className="grid grid-cols-5 gap-1">
                      {(result.details as any).grid.map((cell: string, i: number) => (
                        <div key={i} className={`h-10 rounded flex items-center justify-center border text-base ${
                          cell==="picked_mine" ? "bg-destructive border-destructive text-white" :
                          cell==="picked_safe" ? "bg-primary/20 border-primary text-primary" :
                          cell==="mine" ? "bg-destructive/15 border-destructive/30 text-destructive/70" :
                          "bg-background border-border"
                        }`}>
                          {cell==="mine"||cell==="picked_mine" ? "💣" : cell==="picked_safe" ? "💎" : ""}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      {(result.details as any).mineCount} mines · {(result.details as any).multiplier}x if safe
                    </p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Enter number of mines (1–{config?.maxMines ?? 24}). More mines = higher payout.</p>
                <Input data-testid="input-number-pick" type="number" min="1" max={config?.maxMines ?? 24}
                  value={numPick} onChange={(e) => setNumPick(e.target.value)}
                  className="h-14 text-2xl text-center font-bold" placeholder={`1 – ${config?.maxMines ?? 24}`} />
                {numPick && !isNaN(parseInt(numPick)) && parseInt(numPick) >= 1 && parseInt(numPick) <= 24 && (
                  <p className="text-xs text-muted-foreground text-right">
                    Payout if safe: ~{(Math.max(1.05, (25/(25-parseInt(numPick)))*0.95)).toFixed(2)}x
                  </p>
                )}
              </div>
            )}

            {/* ── WAR ── */}
            {type === "war" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Higher card wins! Tie = War (3x)</p>
                {result?.details ? (
                  <div className="flex gap-4 items-center justify-center py-2">
                    <div className="text-center space-y-1">
                      <p className="text-xs text-muted-foreground">You</p>
                      <PlayingCard face={(result.details as any).playerCard.face} suit={(result.details as any).playerCard.suit} />
                    </div>
                    {(result.details as any).war && <span className="text-yellow-400 font-black text-sm">WAR!</span>}
                    <span className="text-muted-foreground font-bold text-sm">vs</span>
                    <div className="text-center space-y-1">
                      <p className="text-xs text-muted-foreground">Dealer</p>
                      <PlayingCard face={(result.details as any).dealerCard.face} suit={(result.details as any).dealerCard.suit} />
                    </div>
                    {(result.details as any).war && (result.details as any).warPlayer && (
                      <>
                        <span className="text-muted-foreground text-xs">→</span>
                        <div className="text-center space-y-1">
                          <p className="text-xs text-muted-foreground">You (war)</p>
                          <PlayingCard face={(result.details as any).warPlayer.face} suit={(result.details as any).warPlayer.suit} size="sm" />
                        </div>
                        <span className="text-muted-foreground text-xs">vs</span>
                        <div className="text-center space-y-1">
                          <p className="text-xs text-muted-foreground">Dealer (war)</p>
                          <PlayingCard face={(result.details as any).warDealer.face} suit={(result.details as any).warDealer.suit} size="sm" />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-8 items-center justify-center py-4">
                    <div className="text-center space-y-1">
                      <p className="text-xs text-muted-foreground">You</p>
                      <div className="w-12 h-16 bg-primary/10 border-2 border-primary/30 rounded flex items-center justify-center text-primary/40 text-xl">?</div>
                    </div>
                    <span className="text-muted-foreground font-bold">vs</span>
                    <div className="text-center space-y-1">
                      <p className="text-xs text-muted-foreground">Dealer</p>
                      <div className="w-12 h-16 bg-background border-2 border-border rounded flex items-center justify-center text-muted-foreground/40 text-xl">?</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── BACCARAT ── */}
            {type === "baccarat" && game.options && (
              <div className="space-y-3">
                {result?.details && (
                  <div className="grid grid-cols-2 gap-3 pb-2 border-b border-border">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Player — <span className={`font-bold ${(result.details as any).outcome==="player"?"text-primary":"text-foreground"}`}>{(result.details as any).playerScore}</span></p>
                      <div className="flex gap-1.5 flex-wrap">
                        {(result.details as any).playerCards.map((c: any, i: number) => <PlayingCard key={i} face={c.face} suit={c.suit} size="sm" />)}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Banker — <span className={`font-bold ${(result.details as any).outcome==="banker"?"text-primary":"text-foreground"}`}>{(result.details as any).bankerScore}</span></p>
                      <div className="flex gap-1.5 flex-wrap">
                        {(result.details as any).bankerCards.map((c: any, i: number) => <PlayingCard key={i} face={c.face} suit={c.suit} size="sm" />)}
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Place your bet</p>
                <div className="grid grid-cols-3 gap-2">
                  {game.options.map((opt) => {
                    const lower = opt.label.toLowerCase();
                    const colorCls = lower.includes("bank") ? "border-red-700 bg-red-950/50 text-red-300 hover:border-red-500"
                      : lower.includes("tie") ? "border-green-700 bg-green-950/50 text-green-300 hover:border-green-500"
                      : "border-blue-700 bg-blue-950/50 text-blue-300 hover:border-blue-500";
                    return (
                      <button key={opt.id} data-testid={`button-option-${opt.id}`} onClick={() => setSelectedOptionId(opt.id)}
                        className={`h-16 rounded-lg border-2 flex flex-col items-center justify-center font-bold transition-all ${selectedOptionId===opt.id?"ring-2 ring-white/20 ":""}${colorCls}`}>
                        <span className="text-sm">{opt.label}</span>
                        <span className="text-xs opacity-70">{opt.odds}x</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── THREE CARD POKER ── */}
            {type === "three_card_poker" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">3-card deal — best hand wins!</p>
                {result?.details ? (
                  <div className="space-y-2">
                    <div className="flex gap-3 justify-center">
                      {(result.details as any).cards.map((c: any, i: number) => <PlayingCard key={i} face={c.face} suit={c.suit} />)}
                    </div>
                    <p className="text-center text-sm font-bold text-primary">{(result.details as any).handName}</p>
                  </div>
                ) : (
                  <div className="flex gap-3 justify-center">
                    {Array(3).fill(null).map((_,i) => (
                      <div key={i} className="w-12 h-16 bg-primary/10 border-2 border-primary/30 rounded flex items-center justify-center text-primary/40 font-bold text-xl">?</div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {[["Mini Royal","40x"],["Three of a Kind","30x"],["Straight Flush","20x"],["Straight","6x"],["Flush","3x"],["Pair","2x"]].map(([h,p]) => (
                    <div key={h} className="flex justify-between text-muted-foreground bg-background rounded px-2 py-1">
                      <span>{h}</span><span className="text-accent font-mono">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── DRAGON TIGER ── */}
            {type === "dragon_tiger" && game.options && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Higher card wins — Dragon vs Tiger</p>
                {result?.details ? (
                  <div className="flex gap-6 items-center justify-center py-2">
                    <div className="text-center space-y-1">
                      <p className={`text-xs font-bold ${(result.details as any).outcome==="dragon"?"text-red-400":"text-muted-foreground"}`}>🐉 Dragon</p>
                      <PlayingCard face={(result.details as any).dragonCard.face} suit={(result.details as any).dragonCard.suit} />
                    </div>
                    <span className="text-muted-foreground font-bold text-sm">vs</span>
                    <div className="text-center space-y-1">
                      <p className={`text-xs font-bold ${(result.details as any).outcome==="tiger"?"text-amber-400":"text-muted-foreground"}`}>🐯 Tiger</p>
                      <PlayingCard face={(result.details as any).tigerCard.face} suit={(result.details as any).tigerCard.suit} />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-8 items-center justify-center py-4">
                    <div className="text-center space-y-1">
                      <p className="text-xs text-red-400">🐉 Dragon</p>
                      <div className="w-12 h-16 bg-red-950/40 border-2 border-red-700/40 rounded flex items-center justify-center text-red-400/40 text-xl">?</div>
                    </div>
                    <span className="text-muted-foreground font-bold">vs</span>
                    <div className="text-center space-y-1">
                      <p className="text-xs text-amber-400">🐯 Tiger</p>
                      <div className="w-12 h-16 bg-amber-950/40 border-2 border-amber-700/40 rounded flex items-center justify-center text-amber-400/40 text-xl">?</div>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Place your bet</p>
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={3} />
              </div>
            )}

            {/* ── SIC BO ── */}
            {type === "sic_bo" && game.options && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">Three dice — bet Small, Big, or a Triple</p>
                {result?.details ? (
                  <div className="space-y-2">
                    <div className="flex gap-3 justify-center py-1">
                      {(result.details as any).dice.map((d: number, i: number) => (
                        <div key={i} className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-black ${result.won ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground"}`}>{d}</div>
                      ))}
                    </div>
                    <p className="text-center text-sm font-bold text-foreground">Sum: {(result.details as any).sum}{(result.details as any).isTriple ? " — Triple!" : ""}</p>
                  </div>
                ) : (
                  <div className="flex gap-3 justify-center py-2">
                    {Array(3).fill(null).map((_,i) => (
                      <div key={i} className="w-12 h-12 rounded-lg border-2 border-border bg-background flex items-center justify-center text-muted-foreground/40 text-xl font-black">?</div>
                    ))}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Place your bet</p>
                <OptionGrid options={game.options} selected={selectedOptionId} onSelect={setSelectedOptionId} columns={3} />
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

            <motion.div whileTap={canPlay() && !isSpinning && !isPlinkoDropping && !isCrashAnimating && !playMutation.isPending ? { scale: 0.96 } : {}}>
              <Button className="w-full h-12 text-base font-bold" onClick={handlePlay}
                disabled={playMutation.isPending || isSpinning || isPlinkoDropping || isCrashAnimating || !canPlay()} data-testid="button-play">
                {isSpinning ? "Spinning…" : isPlinkoDropping ? "Ball dropping…" : isCrashAnimating ? "Counting…" : playMutation.isPending ? "Processing…" : "Place Bet"}
              </Button>
            </motion.div>
          </div>
        )}

        {/* ── Result ── */}
        <AnimatePresence mode="wait">
          {result && !isSpinning && (
            <motion.div
              key={result.betId ?? result.payout}
              data-testid="text-result"
              initial={{ scale: 0.75, opacity: 0, y: 24 }}
              animate={(result.won || isPartialReturn)
                ? { scale: 1, opacity: 1, y: 0 }
                : { scale: [0.75, 1.02, 1], opacity: 1, y: 0, x: [0, -8, 8, -6, 6, -3, 3, 0] }
              }
              exit={{ scale: 0.85, opacity: 0, y: -10 }}
              transition={{ type: "spring", stiffness: 380, damping: 22 }}
              className={`relative rounded-xl p-5 text-center border-2 overflow-hidden ${
                result.won ? "bg-primary/10 border-primary/50" : isPartialReturn ? "bg-amber-400/10 border-amber-400/50" : "bg-destructive/10 border-destructive/50"
              }`}
            >
              {result.won && <WinParticles />}
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: [0.4, 1.35, 0.92, 1.08, 1], opacity: 1 }}
                transition={{ duration: 0.5, times: [0, 0.45, 0.65, 0.8, 1] }}
                className={`text-4xl font-black mb-2 ${result.won ? "text-primary" : isPartialReturn ? "text-amber-400" : "text-destructive"}`}
              >
                {result.won ? "🎉 WIN!" : isPartialReturn ? "↩️ PARTIAL RETURN" : (type === "match_bet" || type === "trivia") ? "✅ PLACED" : "💸 LOSS"}
              </motion.div>
              <p className="text-foreground font-medium text-sm">{result.message}</p>
              {(result.won || isPartialReturn) && (
                <motion.p
                  initial={{ opacity: 0, scale: 0.8, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.22, type: "spring", stiffness: 300 }}
                  className={`font-black text-2xl mt-2 ${result.won ? "text-primary" : "text-amber-400"}`}
                >
                  +{result.payout.toLocaleString()} coins
                </motion.p>
              )}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="text-muted-foreground text-xs mt-2"
              >
                Balance: {result.newBalance.toLocaleString()} coins
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {!isOpen && (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground">
            This game is <strong>{game.status}</strong>. Betting is not available.
          </div>
        )}
      </div>
    </div>
  );
}
