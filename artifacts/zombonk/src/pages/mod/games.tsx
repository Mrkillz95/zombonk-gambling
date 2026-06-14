import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useModListGames, getModListGamesQueryKey,
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

// ── Types ──────────────────────────────────────────────────────────────────

type GameType =
  | "slots" | "coin_flip" | "match_bet" | "number_pick" | "mystery_box"
  | "dice" | "roulette" | "wheel" | "card_draw" | "over_under"
  | "trivia" | "jackpot" | "color_pick" | "hi_lo" | "lucky_spin"
  | "plinko" | "blackjack" | "crash" | "keno" | "scratch_card"
  | "video_poker" | "mines" | "war" | "baccarat" | "three_card_poker";

interface OptionInput {
  label: string; odds: number; emoji: string; weight: number;
  imageUrl?: string; displayOdds?: string; trueWinPct?: number | null;
}
interface SlotItem { label: string; emoji: string; weight: number; payout: number; }
interface WheelSection { label: string; weight: number; payout: number; }

interface GameFormState {
  title: string;
  type: GameType;
  options: OptionInput[];
  reelCount: number;
  slotItems: SlotItem[];
  numMin: number;
  numMax: number;
  numOdds: number;
  numDice: number;
  numSides: number;
  diceOdds: number;
  wheelSections: WheelSection[];
  overUnderLine: number;
  overUnderOdds: number;
  hiLoShown: number;
  triviaQuestion: string;
  jackpotTickets: number;
  jackpotAmount: number;
  // New game fields
  plinkRows: number;
  plinkMults: string;
  crashMaxTarget: number;
  kenoMaxSpots: number;
  minesMaxMines: number;
  warTieMult: number;
  // Presentation
  description: string;
  bannerImage: string;
  badgeText: string;
  displayOddsText: string;
  // Wager limits
  minWager: number;
  maxWager: number;
  maxPayout: number;
  // Rigging
  forceOutcome: "" | "win" | "lose";
  forceWinMult: number;
  minLossStreak: number;
  maxWinStreak: number;
  winMessage: string;
  loseMessage: string;
  // Player overrides
  playerOverrides: { playerId: string; outcome: "win" | "lose"; mult: number }[];
}

const DEFAULT_FORM: GameFormState = {
  title: "", type: "coin_flip",
  options: [{ label: "Heads", odds: 2, emoji: "", weight: 1 }, { label: "Tails", odds: 2, emoji: "", weight: 1 }],
  reelCount: 3,
  slotItems: [
    { label: "Cherry", emoji: "CH", weight: 5, payout: 2 },
    { label: "Bar", emoji: "BR", weight: 4, payout: 3 },
    { label: "Seven", emoji: "7", weight: 2, payout: 5 },
    { label: "Skull", emoji: "SK", weight: 1, payout: 10 },
  ],
  numMin: 1, numMax: 10, numOdds: 8,
  numDice: 1, numSides: 6, diceOdds: 6,
  wheelSections: [
    { label: "Lose", weight: 5, payout: 0 },
    { label: "2x", weight: 3, payout: 2 },
    { label: "5x", weight: 1, payout: 5 },
    { label: "10x", weight: 1, payout: 10 },
  ],
  overUnderLine: 50, overUnderOdds: 2,
  hiLoShown: 50,
  triviaQuestion: "",
  jackpotTickets: 100, jackpotAmount: 10000,
  plinkRows: 8, plinkMults: "0.3, 0.5, 1, 2, 5, 2, 1, 0.5, 0.3",
  crashMaxTarget: 50, kenoMaxSpots: 10, minesMaxMines: 24, warTieMult: 3,
  description: "", bannerImage: "", badgeText: "", displayOddsText: "",
  minWager: 0, maxWager: 0, maxPayout: 0,
  forceOutcome: "" as const, forceWinMult: 2,
  minLossStreak: 0, maxWinStreak: 0,
  winMessage: "", loseMessage: "",
  playerOverrides: [],
};

const TYPE_DEFAULT_OPTIONS: Partial<Record<GameType, OptionInput[]>> = {
  coin_flip: [{ label: "Heads", odds: 2, emoji: "", weight: 1 }, { label: "Tails", odds: 2, emoji: "", weight: 1 }],
  match_bet: [{ label: "Option A", odds: 2, emoji: "", weight: 1 }, { label: "Option B", odds: 2, emoji: "", weight: 1 }],
  mystery_box: [
    { label: "Bronze Box", odds: 1.5, emoji: "", weight: 5 },
    { label: "Silver Box", odds: 3, emoji: "", weight: 3 },
    { label: "Gold Box", odds: 7, emoji: "", weight: 1 },
  ],
  roulette: [
    { label: "Red", odds: 2, emoji: "", weight: 18 },
    { label: "Black", odds: 2, emoji: "", weight: 18 },
    { label: "Green", odds: 18, emoji: "", weight: 2 },
  ],
  card_draw: [
    { label: "Spades", odds: 4, emoji: "♠", weight: 1 },
    { label: "Hearts", odds: 4, emoji: "♥", weight: 1 },
    { label: "Diamonds", odds: 4, emoji: "♦", weight: 1 },
    { label: "Clubs", odds: 4, emoji: "♣", weight: 1 },
  ],
  over_under: [{ label: "Over", odds: 2, emoji: "", weight: 1 }, { label: "Under", odds: 2, emoji: "", weight: 1 }],
  trivia: [{ label: "Answer A", odds: 2, emoji: "", weight: 1 }, { label: "Answer B", odds: 2, emoji: "", weight: 1 }],
  color_pick: [
    { label: "Red", odds: 2, emoji: "🔴", weight: 3 },
    { label: "Blue", odds: 2, emoji: "🔵", weight: 3 },
    { label: "Green", odds: 3, emoji: "🟢", weight: 2 },
    { label: "Gold", odds: 8, emoji: "🟡", weight: 1 },
  ],
  hi_lo: [{ label: "Higher", odds: 2, emoji: "", weight: 1 }, { label: "Lower", odds: 2, emoji: "", weight: 1 }],
  lucky_spin: [
    { label: "Bronze", odds: 1.2, emoji: "🥉", weight: 10 },
    { label: "Silver", odds: 2.5, emoji: "🥈", weight: 5 },
    { label: "Gold", odds: 6, emoji: "🥇", weight: 2 },
    { label: "Platinum", odds: 20, emoji: "💎", weight: 1 },
  ],
  blackjack: [{ label: "Hit", odds: 2, emoji: "", weight: 1 }, { label: "Stand", odds: 2, emoji: "", weight: 1 }],
  baccarat: [
    { label: "Player", odds: 2, emoji: "🔵", weight: 1 },
    { label: "Banker", odds: 1.95, emoji: "🔴", weight: 1 },
    { label: "Tie", odds: 8, emoji: "🟢", weight: 1 },
  ],
};

// Types with no options (config-based)
const CONFIG_ONLY_TYPES = new Set<GameType>(["slots", "number_pick", "dice", "wheel", "over_under", "hi_lo", "jackpot",
  "plinko", "crash", "keno", "scratch_card", "video_poker", "mines", "war", "three_card_poker"]);
// Types with options
const OPTION_TYPES = new Set<GameType>(["coin_flip", "match_bet", "mystery_box", "roulette", "card_draw", "trivia", "color_pick", "lucky_spin",
  "blackjack", "baccarat"]);

const ALL_TYPES: { value: GameType; label: string }[] = [
  { value: "coin_flip", label: "Coin Flip" },
  { value: "match_bet", label: "Match Bet" },
  { value: "mystery_box", label: "Mystery Box" },
  { value: "number_pick", label: "Number Pick" },
  { value: "slots", label: "Slot Machine" },
  { value: "dice", label: "Dice Roll" },
  { value: "roulette", label: "Roulette" },
  { value: "wheel", label: "Spin the Wheel" },
  { value: "card_draw", label: "Card Draw" },
  { value: "over_under", label: "Over / Under" },
  { value: "trivia", label: "Trivia Q&A" },
  { value: "jackpot", label: "Jackpot Lottery" },
  { value: "color_pick", label: "Color Pick" },
  { value: "hi_lo", label: "Hi-Lo" },
  { value: "lucky_spin", label: "Lucky Spin" },
  { value: "plinko", label: "Plinko" },
  { value: "blackjack", label: "Blackjack" },
  { value: "crash", label: "Crash" },
  { value: "keno", label: "Keno" },
  { value: "scratch_card", label: "Scratch Card" },
  { value: "video_poker", label: "Video Poker" },
  { value: "mines", label: "Minesweeper" },
  { value: "war", label: "War" },
  { value: "baccarat", label: "Baccarat" },
  { value: "three_card_poker", label: "Three Card Poker" },
];

const STATUS_COLORS: Record<string, string> = {
  open: "border-green-500/30 text-green-400",
  closed: "border-yellow-500/30 text-yellow-400",
  resolved: "border-muted-foreground/30 text-muted-foreground",
};

// ── Build payload from form state ──────────────────────────────────────────
function buildPayload(form: GameFormState) {
  let config: any = {};
  let options: OptionInput[] = [];

  if (form.type === "slots") {
    config = { reelCount: form.reelCount, items: form.slotItems };
  } else if (form.type === "number_pick") {
    config = { min: form.numMin, max: form.numMax, odds: form.numOdds };
  } else if (form.type === "dice") {
    config = { dice: form.numDice, sides: form.numSides, odds: form.diceOdds };
  } else if (form.type === "wheel") {
    config = { sections: form.wheelSections };
  } else if (form.type === "over_under") {
    config = { line: form.overUnderLine };
    options = [
      { label: "Over", odds: form.overUnderOdds, emoji: "", weight: 1 },
      { label: "Under", odds: form.overUnderOdds, emoji: "", weight: 1 },
    ];
  } else if (form.type === "hi_lo") {
    config = { shown: form.hiLoShown };
    options = [
      { label: "Higher", odds: 2, emoji: "", weight: 1 },
      { label: "Lower", odds: 2, emoji: "", weight: 1 },
    ];
  } else if (form.type === "trivia") {
    config = { question: form.triviaQuestion };
    options = form.options;
  } else if (form.type === "jackpot") {
    config = { tickets: form.jackpotTickets, jackpot: form.jackpotAmount };
  } else if (form.type === "plinko") {
    const mults = form.plinkMults.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    config = { rows: form.plinkRows, multipliers: mults.length ? mults : [0.3,0.5,1,2,5,2,1,0.5,0.3] };
  } else if (form.type === "crash") {
    config = { maxTarget: form.crashMaxTarget };
  } else if (form.type === "keno") {
    config = { maxSpots: form.kenoMaxSpots };
  } else if (form.type === "mines") {
    config = { maxMines: form.minesMaxMines };
  } else if (form.type === "war") {
    config = { tieMult: form.warTieMult, winMult: 2 };
  } else if (form.type === "blackjack") {
    options = form.options; config = { win_multiplier: 2 };
  } else if (form.type === "baccarat") {
    options = form.options;
  } else {
    options = form.options;
  }

  // Merge rigging + presentation into config
  const rigging: any = {};
  if (form.description) rigging.description = form.description;
  if (form.bannerImage) rigging.bannerImage = form.bannerImage;
  if (form.badgeText) rigging.badgeText = form.badgeText;
  if (form.displayOddsText) rigging.displayOddsText = form.displayOddsText;
  if (form.minWager > 0) rigging.minWager = form.minWager;
  if (form.maxWager > 0) rigging.maxWager = form.maxWager;
  if (form.maxPayout > 0) rigging.maxPayout = form.maxPayout;
  if (form.forceOutcome) rigging.forceOutcome = form.forceOutcome;
  if (form.forceWinMult !== 2) rigging.forceWinMult = form.forceWinMult;
  if (form.minLossStreak > 0) rigging.minLossStreak = form.minLossStreak;
  if (form.maxWinStreak > 0) rigging.maxWinStreak = form.maxWinStreak;
  if (form.winMessage) rigging.winMessage = form.winMessage;
  if (form.loseMessage) rigging.loseMessage = form.loseMessage;
  if (form.playerOverrides.length > 0) {
    rigging.playerOverrides = Object.fromEntries(
      form.playerOverrides.filter(p => p.playerId.trim()).map(p => [p.playerId, { outcome: p.outcome, mult: p.mult }])
    );
  }
  config = { ...config, ...rigging };

  return { title: form.title, type: form.type, config, options };
}

// ── Option editor row ──────────────────────────────────────────────────────
function OptionRow({
  opt, index, showWeight, showEmoji, onChange, onRemove,
}: {
  opt: OptionInput; index: number; showWeight?: boolean; showEmoji?: boolean;
  onChange: (i: number, field: keyof OptionInput, val: any) => void;
  onRemove: (i: number) => void;
}) {
  const [showAdv, setShowAdv] = useState(false);
  return (
    <div className="space-y-1" data-testid={`option-row-${index}`}>
      <div className="flex gap-1.5 items-center">
        <Input data-testid={`input-option-label-${index}`} className="flex-1 h-9 text-sm" placeholder="Label"
          value={opt.label} onChange={e => onChange(index, "label", e.target.value)} />
        {showEmoji && (
          <Input data-testid={`input-option-emoji-${index}`} className="w-14 h-9 text-sm text-center" placeholder="Icon"
            value={opt.emoji} onChange={e => onChange(index, "emoji", e.target.value)} />
        )}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground">Odds</span>
          <Input data-testid={`input-option-odds-${index}`} className="w-16 h-9 text-sm font-mono" type="number" step="0.1" min="1"
            value={opt.odds} onChange={e => onChange(index, "odds", parseFloat(e.target.value) || 1)} />
        </div>
        {showWeight && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">Wt</span>
            <Input data-testid={`input-option-weight-${index}`} className="w-14 h-9 text-sm font-mono" type="number" min="1"
              value={opt.weight} onChange={e => onChange(index, "weight", parseInt(e.target.value) || 1)} />
          </div>
        )}
        <Button size="sm" variant="ghost"
          className={`h-9 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground ${showAdv ? "bg-primary/10 text-primary" : ""}`}
          onClick={() => setShowAdv(p => !p)} title="Advanced option settings" data-testid={`button-option-adv-${index}`}>⋯</Button>
        <Button size="sm" variant="ghost" className="h-9 w-8 p-0 text-destructive hover:text-destructive shrink-0"
          onClick={() => onRemove(index)} data-testid={`button-remove-option-${index}`}>✕</Button>
      </div>
      {showAdv && (
        <div className="flex flex-wrap gap-2 pl-2 pb-1.5 pt-0.5 border-l-2 border-primary/30 ml-1">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Display Odds</span>
            <Input className="w-24 h-8 text-xs" placeholder="e.g. 50/50"
              value={opt.displayOdds ?? ""} onChange={e => onChange(index, "displayOdds", e.target.value)} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground whitespace-nowrap">True Win %</span>
            <Input className="w-16 h-8 text-xs font-mono" type="number" min="0" max="100" placeholder="auto"
              value={opt.trueWinPct ?? ""}
              onChange={e => onChange(index, "trueWinPct", e.target.value === "" ? null : parseInt(e.target.value))} />
          </div>
          <div className="flex items-center gap-1 flex-1 min-w-[180px]">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Image URL</span>
            <Input className="flex-1 h-8 text-xs" placeholder="https://..."
              value={opt.imageUrl ?? ""} onChange={e => onChange(index, "imageUrl", e.target.value)} />
          </div>
          {opt.imageUrl && (
            <img src={opt.imageUrl} alt="" className="h-8 w-8 rounded object-cover border border-border shrink-0"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Game form (shared for create + edit) ───────────────────────────────────
function GameForm({
  form, setForm, onSubmit, isPending, submitLabel,
}: {
  form: GameFormState;
  setForm: React.Dispatch<React.SetStateAction<GameFormState>>;
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateOpt = (i: number, field: keyof OptionInput, val: any) => {
    setForm(p => { const o = [...p.options]; o[i] = { ...o[i], [field]: val }; return { ...p, options: o }; });
  };
  const removeOpt = (i: number) => setForm(p => ({ ...p, options: p.options.filter((_, j) => j !== i) }));
  const addOpt = () => setForm(p => ({ ...p, options: [...p.options, { label: "", odds: 2, emoji: "", weight: 1, imageUrl: "", displayOdds: "", trueWinPct: null }] }));

  const updateSlot = (i: number, field: keyof SlotItem, val: any) => {
    setForm(p => { const s = [...p.slotItems]; s[i] = { ...s[i], [field]: val }; return { ...p, slotItems: s }; });
  };
  const removeSlot = (i: number) => setForm(p => ({ ...p, slotItems: p.slotItems.filter((_, j) => j !== i) }));

  const updateSection = (i: number, field: keyof WheelSection, val: any) => {
    setForm(p => { const s = [...p.wheelSections]; s[i] = { ...s[i], [field]: val }; return { ...p, wheelSections: s }; });
  };
  const removeSection = (i: number) => setForm(p => ({ ...p, wheelSections: p.wheelSections.filter((_, j) => j !== i) }));

  const showWeight = ["mystery_box", "roulette", "color_pick", "lucky_spin"].includes(form.type);
  const showEmoji = ["card_draw", "color_pick", "lucky_spin"].includes(form.type);

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Title</label>
          <Input data-testid="input-game-title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="Game title..." className="h-10" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Type</label>
          <select data-testid="select-game-type" value={form.type}
            onChange={e => {
              const t = e.target.value as GameType;
              setForm(p => ({
                ...p, type: t,
                options: TYPE_DEFAULT_OPTIONS[t] ?? p.options,
              }));
            }}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            {ALL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── SLOTS config ── */}
      {form.type === "slots" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium uppercase">Reels</label>
            <Input data-testid="input-reel-count" type="number" min="2" max="5" value={form.reelCount}
              onChange={e => setForm(p => ({ ...p, reelCount: parseInt(e.target.value) || 3 }))} className="w-20 h-9 text-sm font-mono" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium uppercase">Symbols</label>
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-add-slot-item"
                onClick={() => setForm(p => ({ ...p, slotItems: [...p.slotItems, { label: "", emoji: "", weight: 1, payout: 2 }] }))}>+ Add</Button>
            </div>
            <div className="grid grid-cols-4 gap-1 text-xs text-muted-foreground px-1"><span>Name</span><span>Icon</span><span>Weight</span><span>Payout</span></div>
            {form.slotItems.map((item, i) => (
              <div key={i} className="grid grid-cols-4 gap-1.5" data-testid={`slot-item-${i}`}>
                <Input data-testid={`input-slot-label-${i}`} className="h-9 text-sm" placeholder="Label" value={item.label} onChange={e => updateSlot(i, "label", e.target.value)} />
                <Input data-testid={`input-slot-emoji-${i}`} className="h-9 text-sm text-center" placeholder="Icon" value={item.emoji} onChange={e => updateSlot(i, "emoji", e.target.value)} />
                <Input data-testid={`input-slot-weight-${i}`} className="h-9 text-sm font-mono" type="number" min="1" value={item.weight} onChange={e => updateSlot(i, "weight", parseInt(e.target.value) || 1)} />
                <div className="flex gap-1">
                  <Input data-testid={`input-slot-payout-${i}`} className="h-9 text-sm font-mono" type="number" min="1" value={item.payout} onChange={e => updateSlot(i, "payout", parseInt(e.target.value) || 1)} />
                  <Button size="sm" variant="ghost" className="h-9 w-8 p-0 text-destructive shrink-0" onClick={() => removeSlot(i)} data-testid={`button-remove-slot-${i}`}>✕</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NUMBER PICK config ── */}
      {form.type === "number_pick" && (
        <div className="grid grid-cols-3 gap-3">
          {[["Min", "numMin"], ["Max", "numMax"], ["Payout (x)", "numOdds"]].map(([lbl, key]) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium uppercase">{lbl}</label>
              <Input data-testid={`input-${key}`} type="number" value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))} className="h-10 font-mono" />
            </div>
          ))}
        </div>
      )}

      {/* ── DICE config ── */}
      {form.type === "dice" && (
        <div className="grid grid-cols-3 gap-3">
          {[["# Dice", "numDice", 1, 4], ["Sides", "numSides", 4, 20], ["Payout (x)", "diceOdds", 1, 100]].map(([lbl, key, min, max]) => (
            <div key={key as string} className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium uppercase">{lbl}</label>
              <Input type="number" min={min} max={max} value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key as string]: parseFloat(e.target.value) || 0 }))} className="h-10 font-mono" />
            </div>
          ))}
        </div>
      )}

      {/* ── WHEEL config ── */}
      {form.type === "wheel" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground font-medium uppercase">Wheel Sections</label>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setForm(p => ({ ...p, wheelSections: [...p.wheelSections, { label: "", weight: 1, payout: 0 }] }))}>+ Add</Button>
          </div>
          <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground px-1"><span>Label</span><span>Weight</span><span>Payout (x)</span></div>
          {form.wheelSections.map((sec, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <Input className="flex-1 h-9 text-sm" placeholder="Label" value={sec.label} onChange={e => updateSection(i, "label", e.target.value)} />
              <Input className="w-16 h-9 text-sm font-mono" type="number" min="1" value={sec.weight} onChange={e => updateSection(i, "weight", parseInt(e.target.value) || 1)} />
              <Input className="w-20 h-9 text-sm font-mono" type="number" min="0" step="0.5" value={sec.payout} onChange={e => updateSection(i, "payout", parseFloat(e.target.value) || 0)} />
              <Button size="sm" variant="ghost" className="h-9 w-8 p-0 text-destructive shrink-0" onClick={() => removeSection(i)}>✕</Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Payout 0 = lose section</p>
        </div>
      )}

      {/* ── OVER/UNDER config ── */}
      {form.type === "over_under" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase">Line (1–100)</label>
            <Input type="number" min="1" max="99" value={form.overUnderLine}
              onChange={e => setForm(p => ({ ...p, overUnderLine: parseInt(e.target.value) || 50 }))} className="h-10 font-mono" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase">Odds (x)</label>
            <Input type="number" min="1" step="0.1" value={form.overUnderOdds}
              onChange={e => setForm(p => ({ ...p, overUnderOdds: parseFloat(e.target.value) || 2 }))} className="h-10 font-mono" />
          </div>
        </div>
      )}

      {/* ── HI/LO config ── */}
      {form.type === "hi_lo" && (
        <div className="space-y-1 max-w-xs">
          <label className="text-xs text-muted-foreground font-medium uppercase">Shown Number (1–100)</label>
          <Input type="number" min="1" max="99" value={form.hiLoShown}
            onChange={e => setForm(p => ({ ...p, hiLoShown: parseInt(e.target.value) || 50 }))} className="h-10 font-mono" />
          <p className="text-xs text-muted-foreground">Players bet if the next draw is higher or lower than this number.</p>
        </div>
      )}

      {/* ── TRIVIA config ── */}
      {form.type === "trivia" && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium uppercase">Question</label>
          <Input placeholder="Enter your trivia question..." value={form.triviaQuestion}
            onChange={e => setForm(p => ({ ...p, triviaQuestion: e.target.value }))} className="h-10" />
        </div>
      )}

      {/* ── JACKPOT config ── */}
      {form.type === "jackpot" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase">Ticket Count</label>
            <Input type="number" min="2" value={form.jackpotTickets}
              onChange={e => setForm(p => ({ ...p, jackpotTickets: parseInt(e.target.value) || 100 }))} className="h-10 font-mono" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase">Jackpot (coins)</label>
            <Input type="number" min="1" value={form.jackpotAmount}
              onChange={e => setForm(p => ({ ...p, jackpotAmount: parseInt(e.target.value) || 10000 }))} className="h-10 font-mono" />
          </div>
        </div>
      )}

      {/* ── PLINKO config ── */}
      {form.type === "plinko" && (
        <div className="space-y-3">
          <div className="space-y-1 max-w-xs">
            <label className="text-xs text-muted-foreground font-medium uppercase">Rows (4–12)</label>
            <Input type="number" min="4" max="12" value={form.plinkRows}
              onChange={e => setForm(p => ({ ...p, plinkRows: parseInt(e.target.value) || 8 }))} className="h-10 font-mono" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase">Multipliers (comma-separated, left→right)</label>
            <Input value={form.plinkMults}
              onChange={e => setForm(p => ({ ...p, plinkMults: e.target.value }))} className="h-10 font-mono"
              placeholder="0.3, 0.5, 1, 2, 5, 2, 1, 0.5, 0.3" />
            <p className="text-xs text-muted-foreground">Number of slots = rows + 1 (8 rows → 9 slots)</p>
          </div>
        </div>
      )}

      {/* ── CRASH config ── */}
      {form.type === "crash" && (
        <div className="space-y-1 max-w-xs">
          <label className="text-xs text-muted-foreground font-medium uppercase">Max Cashout Target</label>
          <Input type="number" min="2" value={form.crashMaxTarget}
            onChange={e => setForm(p => ({ ...p, crashMaxTarget: parseInt(e.target.value) || 50 }))} className="h-10 font-mono" />
          <p className="text-xs text-muted-foreground">Players enter a target between 1.1x and this max.</p>
        </div>
      )}

      {/* ── KENO config ── */}
      {form.type === "keno" && (
        <div className="space-y-1 max-w-xs">
          <label className="text-xs text-muted-foreground font-medium uppercase">Max Spots (1–10)</label>
          <Input type="number" min="1" max="10" value={form.kenoMaxSpots}
            onChange={e => setForm(p => ({ ...p, kenoMaxSpots: parseInt(e.target.value) || 10 }))} className="h-10 font-mono" />
          <p className="text-xs text-muted-foreground">Players pick 1 to this many spots from a pool of 80. 20 numbers are drawn.</p>
        </div>
      )}

      {/* ── MINES config ── */}
      {form.type === "mines" && (
        <div className="space-y-1 max-w-xs">
          <label className="text-xs text-muted-foreground font-medium uppercase">Max Mines (1–24)</label>
          <Input type="number" min="1" max="24" value={form.minesMaxMines}
            onChange={e => setForm(p => ({ ...p, minesMaxMines: parseInt(e.target.value) || 24 }))} className="h-10 font-mono" />
          <p className="text-xs text-muted-foreground">Players pick how many mines to place (1 to max). More mines = bigger payout.</p>
        </div>
      )}

      {/* ── WAR config ── */}
      {form.type === "war" && (
        <div className="space-y-1 max-w-xs">
          <label className="text-xs text-muted-foreground font-medium uppercase">War (Tie) Multiplier</label>
          <Input type="number" min="2" step="0.5" value={form.warTieMult}
            onChange={e => setForm(p => ({ ...p, warTieMult: parseFloat(e.target.value) || 3 }))} className="h-10 font-mono" />
          <p className="text-xs text-muted-foreground">Payout when a tie triggers War and player wins. Regular win = 2x.</p>
        </div>
      )}

      {/* ── BLACKJACK note ── */}
      {form.type === "blackjack" && (
        <p className="text-xs text-muted-foreground bg-background rounded p-3 border border-border">
          Hit: player draws an extra card. Stand: player sticks with 2 cards. Dealer hits to 17. Win pays 2x.
        </p>
      )}

      {/* ── BACCARAT note ── */}
      {form.type === "baccarat" && (
        <p className="text-xs text-muted-foreground bg-background rounded p-3 border border-border">
          Standard odds: Player=2x, Banker=1.95x, Tie=8x. Adjust the option odds below to customise payouts.
        </p>
      )}

      {/* ── Fixed-paytable games note ── */}
      {(form.type === "video_poker" || form.type === "scratch_card" || form.type === "three_card_poker") && (
        <p className="text-xs text-muted-foreground bg-background rounded p-3 border border-border italic">
          This game uses a fixed built-in paytable — no additional configuration needed.
        </p>
      )}

      {/* ── Option editor (option-based types) ── */}
      {OPTION_TYPES.has(form.type) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground font-medium uppercase">
              {form.type === "trivia" ? "Answer Choices" : "Options"}
            </label>
            <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-add-option" onClick={addOpt}>+ Add</Button>
          </div>
          <div className="space-y-1.5">
            {form.options.map((opt, i) => (
              <OptionRow key={i} opt={opt} index={i} showWeight={showWeight} showEmoji={showEmoji}
                onChange={updateOpt} onRemove={removeOpt} />
            ))}
          </div>
        </div>
      )}

      {/* ── Advanced Settings & Rigging ── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(p => !p)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-card/60 hover:bg-card transition-colors text-sm font-medium text-foreground"
        >
          <span>⚡ Advanced Settings &amp; Rigging</span>
          <span className="text-muted-foreground text-xs">{showAdvanced ? "▲ collapse" : "▼ expand"}</span>
        </button>
        {showAdvanced && (
          <div className="p-4 space-y-5 border-t border-border bg-background/50">

            {/* Presentation */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">Presentation</p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium uppercase">Description (shown to players)</label>
                <textarea value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Describe this game to players..."
                  className="w-full min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Banner Image URL</label>
                  <Input value={form.bannerImage} onChange={e => setForm(p => ({ ...p, bannerImage: e.target.value }))}
                    placeholder="https://..." className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Badge Text</label>
                  <Input value={form.badgeText} onChange={e => setForm(p => ({ ...p, badgeText: e.target.value }))}
                    placeholder="🔥 HOT" className="h-9 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium uppercase">Display Odds / RTP Text (shown to players)</label>
                <Input value={form.displayOddsText} onChange={e => setForm(p => ({ ...p, displayOddsText: e.target.value }))}
                  placeholder="e.g. 50/50 · 95% RTP · 2x payout" className="h-9 text-sm" />
                <p className="text-xs text-muted-foreground">This text is displayed to players. It can differ from real odds.</p>
              </div>
              {form.bannerImage && (
                <img src={form.bannerImage} alt="Banner preview"
                  className="w-full max-h-32 object-cover rounded-md border border-border"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              )}
            </div>

            {/* Wager Limits */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">Wager Limits</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Min Wager</label>
                  <Input type="number" min="0" value={form.minWager || ""}
                    placeholder="No limit" onChange={e => setForm(p => ({ ...p, minWager: parseInt(e.target.value) || 0 }))} className="h-9 text-sm font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Max Wager</label>
                  <Input type="number" min="0" value={form.maxWager || ""}
                    placeholder="No limit" onChange={e => setForm(p => ({ ...p, maxWager: parseInt(e.target.value) || 0 }))} className="h-9 text-sm font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Max Payout Cap</label>
                  <Input type="number" min="0" value={form.maxPayout || ""}
                    placeholder="No cap" onChange={e => setForm(p => ({ ...p, maxPayout: parseInt(e.target.value) || 0 }))} className="h-9 text-sm font-mono" />
                </div>
              </div>
            </div>

            {/* Outcome Rigging */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-destructive/80">🎰 Outcome Rigging</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Force Outcome (global override)</label>
                  <select value={form.forceOutcome}
                    onChange={e => setForm(p => ({ ...p, forceOutcome: e.target.value as "" | "win" | "lose" }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    <option value="">Normal (random)</option>
                    <option value="win">Always Win</option>
                    <option value="lose">Always Lose</option>
                  </select>
                </div>
                {form.forceOutcome === "win" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-medium uppercase">Forced Win Multiplier (x)</label>
                    <Input type="number" min="1" step="0.5" value={form.forceWinMult}
                      onChange={e => setForm(p => ({ ...p, forceWinMult: parseFloat(e.target.value) || 2 }))} className="h-9 text-sm font-mono" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Min Losses Before Win</label>
                  <Input type="number" min="0" value={form.minLossStreak || ""} placeholder="Disabled"
                    onChange={e => setForm(p => ({ ...p, minLossStreak: parseInt(e.target.value) || 0 }))} className="h-9 text-sm font-mono" />
                  <p className="text-xs text-muted-foreground">Player must lose N times on this game first</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Max Wins in a Row</label>
                  <Input type="number" min="0" value={form.maxWinStreak || ""} placeholder="Disabled"
                    onChange={e => setForm(p => ({ ...p, maxWinStreak: parseInt(e.target.value) || 0 }))} className="h-9 text-sm font-mono" />
                  <p className="text-xs text-muted-foreground">Force a loss after N consecutive wins</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Custom Win Message</label>
                  <Input value={form.winMessage} onChange={e => setForm(p => ({ ...p, winMessage: e.target.value }))}
                    placeholder="Lucky! Won {payout} coins!" className="h-9 text-sm" />
                  <p className="text-xs text-muted-foreground">{"Use {payout} and {wager}"}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground font-medium uppercase">Custom Lose Message</label>
                  <Input value={form.loseMessage} onChange={e => setForm(p => ({ ...p, loseMessage: e.target.value }))}
                    placeholder="Better luck next time! Lost {wager}." className="h-9 text-sm" />
                  <p className="text-xs text-muted-foreground">{"Use {wager}"}</p>
                </div>
              </div>
            </div>

            {/* Per-Player Overrides */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">👤 Player-Specific Overrides</p>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setForm(p => ({ ...p, playerOverrides: [...p.playerOverrides, { playerId: "", outcome: "win", mult: 2 }] }))}>
                  + Add
                </Button>
              </div>
              {form.playerOverrides.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No per-player overrides. Add one to rig outcomes for specific players.</p>
              )}
              {form.playerOverrides.map((ov, i) => (
                <div key={i} className="flex flex-wrap gap-1.5 items-center">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Player ID</span>
                    <Input className="w-20 h-8 text-xs font-mono" type="number" min="1" value={ov.playerId}
                      onChange={e => {
                        const overrides = [...form.playerOverrides];
                        overrides[i] = { ...ov, playerId: e.target.value };
                        setForm(p => ({ ...p, playerOverrides: overrides }));
                      }} />
                  </div>
                  <select value={ov.outcome}
                    onChange={e => {
                      const overrides = [...form.playerOverrides];
                      overrides[i] = { ...ov, outcome: e.target.value as "win" | "lose" };
                      setForm(p => ({ ...p, playerOverrides: overrides }));
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                    <option value="win">Always Win</option>
                    <option value="lose">Always Lose</option>
                  </select>
                  {ov.outcome === "win" && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input className="w-14 h-8 text-xs font-mono" type="number" min="1" step="0.5" value={ov.mult}
                        onChange={e => {
                          const overrides = [...form.playerOverrides];
                          overrides[i] = { ...ov, mult: parseFloat(e.target.value) || 2 };
                          setForm(p => ({ ...p, playerOverrides: overrides }));
                        }} />
                    </div>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 w-7 p-0 text-destructive shrink-0"
                    onClick={() => setForm(p => ({ ...p, playerOverrides: p.playerOverrides.filter((_, j) => j !== i) }))}>✕</Button>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>

      <Button className="w-full h-11 font-semibold" onClick={onSubmit}
        disabled={!form.title.trim() || isPending} data-testid="button-create-game">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </div>
  );
}

// ── Edit form (loads existing game into form state) ────────────────────────
function gameToForm(game: any): GameFormState {
  const c = (game.config as any) ?? {};
  const opts: OptionInput[] = (game.options ?? []).map((o: any) => ({
    label: o.label ?? "",
    odds: o.odds ?? 2,
    emoji: o.emoji ?? "",
    weight: o.weight ?? 1,
    imageUrl: o.imageUrl ?? "",
    displayOdds: o.displayOdds ?? "",
    trueWinPct: o.trueWinPct ?? null,
  }));

  const base: GameFormState = {
    ...DEFAULT_FORM,
    title: game.title ?? "",
    type: game.type as GameType,
    options: opts.length ? opts : (TYPE_DEFAULT_OPTIONS[game.type as GameType] ?? DEFAULT_FORM.options),
    // Presentation
    description: c.description ?? "",
    bannerImage: c.bannerImage ?? "",
    badgeText: c.badgeText ?? "",
    displayOddsText: c.displayOddsText ?? "",
    // Wager limits
    minWager: c.minWager ?? 0,
    maxWager: c.maxWager ?? 0,
    maxPayout: c.maxPayout ?? 0,
    // Rigging
    forceOutcome: c.forceOutcome ?? "",
    forceWinMult: c.forceWinMult ?? 2,
    minLossStreak: c.minLossStreak ?? 0,
    maxWinStreak: c.maxWinStreak ?? 0,
    winMessage: c.winMessage ?? "",
    loseMessage: c.loseMessage ?? "",
    playerOverrides: c.playerOverrides
      ? Object.entries(c.playerOverrides).map(([pid, o]: any) => ({ playerId: pid, outcome: o.outcome, mult: o.mult ?? 2 }))
      : [],
  };

  if (game.type === "slots") {
    return { ...base, reelCount: c.reelCount ?? 3, slotItems: c.items ?? DEFAULT_FORM.slotItems };
  }
  if (game.type === "number_pick") return { ...base, numMin: c.min ?? 1, numMax: c.max ?? 10, numOdds: c.odds ?? 8 };
  if (game.type === "dice") return { ...base, numDice: c.dice ?? 1, numSides: c.sides ?? 6, diceOdds: c.odds ?? 6 };
  if (game.type === "wheel") return { ...base, wheelSections: c.sections ?? DEFAULT_FORM.wheelSections };
  if (game.type === "over_under") return { ...base, overUnderLine: c.line ?? 50, overUnderOdds: opts[0]?.odds ?? 2 };
  if (game.type === "hi_lo") return { ...base, hiLoShown: c.shown ?? 50 };
  if (game.type === "trivia") return { ...base, triviaQuestion: c.question ?? "" };
  if (game.type === "jackpot") return { ...base, jackpotTickets: c.tickets ?? 100, jackpotAmount: c.jackpot ?? 10000 };
  if (game.type === "plinko") return { ...base, plinkRows: c.rows ?? 8, plinkMults: (c.multipliers ?? [0.3,0.5,1,2,5,2,1,0.5,0.3]).join(", ") };
  if (game.type === "crash") return { ...base, crashMaxTarget: c.maxTarget ?? 50 };
  if (game.type === "keno") return { ...base, kenoMaxSpots: c.maxSpots ?? 10 };
  if (game.type === "mines") return { ...base, minesMaxMines: c.maxMines ?? 24 };
  if (game.type === "war") return { ...base, warTieMult: c.tieMult ?? 3 };

  return base;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function ModGames() {
  const [, setLocation] = useLocation();
  const password = getModPassword();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => { if (!password) setLocation("/mod"); }, [password]);

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
  const [createForm, setCreateForm] = useState<GameFormState>(DEFAULT_FORM);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<GameFormState>(DEFAULT_FORM);

  const [resolvingGame, setResolvingGame] = useState<{ id: number; options: any[] } | null>(null);
  const [winningOptionId, setWinningOptionId] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getModListGamesQueryKey() });

  const handleCreate = () => {
    const payload = buildPayload(createForm);
    createMutation.mutate(
      { data: payload as any },
      {
        onSuccess: () => { setShowCreate(false); setCreateForm(DEFAULT_FORM); invalidate(); toast({ title: "Game created" }); },
        onError: () => toast({ title: "Failed to create game", variant: "destructive" }),
      }
    );
  };

  const handleSaveEdit = (gameId: number) => {
    const payload = buildPayload(editForm);
    updateMutation.mutate(
      { id: gameId, data: payload as any },
      {
        onSuccess: () => { setEditingId(null); invalidate(); toast({ title: "Game updated" }); },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  };

  const handleStatusChange = (id: number, status: string) => {
    updateMutation.mutate(
      { id, data: { status: status as any } },
      {
        onSuccess: () => { invalidate(); toast({ title: `Game ${status}` }); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this game and all its bets?")) return;
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => { invalidate(); toast({ title: "Game deleted" }); },
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
          setResolvingGame(null); setWinningOptionId(null);
          invalidate(); toast({ title: "Game resolved, winners paid out" });
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
            <Link href="/mod/dashboard"><Button variant="ghost" size="sm" data-testid="link-dashboard">← Dashboard</Button></Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-bold text-foreground">Games</span>
          </div>
          <Button size="sm" onClick={() => { setShowCreate(!showCreate); setCreateForm(DEFAULT_FORM); }} data-testid="button-new-game">
            {showCreate ? "Cancel" : "+ New Game"}
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* ── Create form ── */}
        {showCreate && (
          <div className="bg-card border border-primary/30 rounded-xl p-6 space-y-4">
            <h2 className="font-bold text-foreground">Create New Game</h2>
            <GameForm form={createForm} setForm={setCreateForm} onSubmit={handleCreate} isPending={createMutation.isPending} submitLabel="Create Game" />
          </div>
        )}

        {/* ── Resolve modal ── */}
        {resolvingGame && (
          <div className="bg-card border border-accent/30 rounded-xl p-6 space-y-4">
            <h2 className="font-bold text-foreground">Resolve Game</h2>
            <p className="text-sm text-muted-foreground">Select the winning option to pay out all bettors.</p>
            <div className="space-y-2">
              {resolvingGame.options.map((opt: any) => (
                <button key={opt.id} data-testid={`button-resolve-option-${opt.id}`} onClick={() => setWinningOptionId(opt.id)}
                  className={`w-full h-11 rounded-lg border-2 flex items-center justify-between px-4 font-medium transition-all ${winningOptionId === opt.id ? "border-accent bg-accent/15 text-accent" : "border-border bg-background text-foreground hover:border-accent/50"}`}>
                  <span>{opt.label}</span><span className="text-sm text-muted-foreground">{opt.odds}x</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleResolve} disabled={!winningOptionId || resolveMutation.isPending} data-testid="button-confirm-resolve">
                {resolveMutation.isPending ? "Resolving..." : "Confirm & Pay Out"}
              </Button>
              <Button variant="outline" onClick={() => { setResolvingGame(null); setWinningOptionId(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* ── Games list ── */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">All Games ({games?.length ?? 0})</h2>
          {isLoading && <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>}
          {!isLoading && (!games || games.length === 0) && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">No games yet. Create one above.</div>
          )}
          <div className="space-y-3">
            {games?.map(game => (
              <div key={game.id} data-testid={`card-mod-game-${game.id}`} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* ── Game row ── */}
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-foreground">{game.title}</span>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[game.status] ?? ""}`}>{game.status.toUpperCase()}</Badge>
                      <span className="text-xs text-muted-foreground capitalize">{game.type.replace("_", " ")}</span>
                    </div>
                    {game.options && game.options.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {game.options.map(o => (
                          <span key={o.id} className={`text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground ${o.isWinner ? "border border-accent text-accent" : ""}`}>
                            {o.label} {o.odds}x{o.isWinner ? " ✓WIN" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    <Button size="sm" variant="outline" className="h-8 text-xs"
                      onClick={() => { if (editingId === game.id) { setEditingId(null); } else { setEditingId(game.id); setEditForm(gameToForm(game)); } }}
                      data-testid={`button-edit-${game.id}`}>
                      {editingId === game.id ? "Cancel Edit" : "Edit"}
                    </Button>
                    {game.status === "open" && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(game.id, "closed")} data-testid={`button-close-${game.id}`}>Close</Button>
                    )}
                    {game.status === "closed" && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleStatusChange(game.id, "open")} data-testid={`button-reopen-${game.id}`}>Reopen</Button>
                    )}
                    {game.status !== "resolved" && (game.type === "match_bet" || game.type === "trivia") && game.options && game.options.length > 0 && (
                      <Button size="sm" variant="outline" className="h-8 text-xs border-accent/40 text-accent hover:bg-accent/10"
                        onClick={() => { setResolvingGame({ id: game.id, options: game.options ?? [] }); setWinningOptionId(null); }}
                        data-testid={`button-resolve-${game.id}`}>Resolve</Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleDelete(game.id)} data-testid={`button-delete-${game.id}`}>Delete</Button>
                  </div>
                </div>

                {/* ── Inline edit form ── */}
                {editingId === game.id && (
                  <div className="border-t border-border bg-background/50 p-4 space-y-4">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Edit Game</p>
                    <GameForm form={editForm} setForm={setEditForm}
                      onSubmit={() => handleSaveEdit(game.id)}
                      isPending={updateMutation.isPending}
                      submitLabel="Save Changes" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
