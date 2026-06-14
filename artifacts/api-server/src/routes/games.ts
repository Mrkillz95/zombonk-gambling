import { Router, type IRouter } from "express";
import { eq, desc, and, count } from "drizzle-orm";
import { db, playersTable, gamesTable, gameOptionsTable, betsTable } from "@workspace/db";
import {
  ListGamesQueryParams,
  GetGameParams,
  PlayGameParams,
  PlayGameBody,
} from "@workspace/api-zod";
import { secureRandom } from "../lib/rng.js";

const router: IRouter = Router();

function formatGame(game: any, options: any[]) {
  return {
    ...game,
    createdAt: game.createdAt.toISOString(),
    options: options.map((o) => ({
      ...o,
      odds: parseFloat(o.odds),
    })),
  };
}

router.get("/games", async (req, res): Promise<void> => {
  const params = ListGamesQueryParams.safeParse(req.query);
  const status = params.success ? params.data.status : undefined;

  const where = status ? eq(gamesTable.status, status) : undefined;
  const games = await db
    .select()
    .from(gamesTable)
    .where(where)
    .orderBy(desc(gamesTable.createdAt));

  const allOptions = await db.select().from(gameOptionsTable);

  res.json(
    games.map((g) =>
      formatGame(
        g,
        allOptions.filter((o) => o.gameId === g.id)
      )
    )
  );
});

router.get("/games/recent", async (req, res): Promise<void> => {
  const recent = await db
    .select({
      id: betsTable.id,
      playerName: playersTable.name,
      gameTitle: gamesTable.title,
      gameType: gamesTable.type,
      wager: betsTable.wager,
      payout: betsTable.payout,
      won: betsTable.won,
      createdAt: betsTable.createdAt,
    })
    .from(betsTable)
    .leftJoin(playersTable, eq(betsTable.playerId, playersTable.id))
    .leftJoin(gamesTable, eq(betsTable.gameId, gamesTable.id))
    .orderBy(desc(betsTable.createdAt))
    .limit(20);

  res.json(
    recent.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

router.get("/games/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetGameParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, params.data.id));

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const options = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, game.id));

  res.json(formatGame(game, options));
});

// ── Card helpers ────────────────────────────────────────────────────────────
const CARD_FACES = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"] as const;
const CARD_SUITS = ["♠","♥","♦","♣"] as const;

function drawCard(): { face: string; suit: string; value: number } {
  const v = Math.floor(secureRandom() * 13);
  return { face: CARD_FACES[v]!, suit: CARD_SUITS[Math.floor(secureRandom() * 4)]!, value: v + 1 };
}

function makeDeck(): { face: string; suit: string; value: number }[] {
  const deck: { face: string; suit: string; value: number }[] = [];
  for (let s = 0; s < 4; s++)
    for (let f = 0; f < 13; f++)
      deck.push({ face: CARD_FACES[f]!, suit: CARD_SUITS[s]!, value: f + 1 });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    const tmp = deck[i]!; deck[i] = deck[j]!; deck[j] = tmp;
  }
  return deck;
}

function bjHandValue(cards: { value: number }[]): number {
  let total = 0; let aces = 0;
  for (const c of cards) { if (c.value === 1) { aces++; total += 11; } else total += Math.min(c.value, 10); }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function baccaratScore(cards: { value: number }[]): number {
  return cards.reduce((s, c) => (s + (c.value >= 10 ? 0 : c.value)) % 10, 0);
}

function weightedRandom(items: { weight?: number | null }[]): number {
  const total = items.reduce((s, o) => s + (o.weight || 1), 0);
  let r = secureRandom() * total;
  for (let i = 0; i < items.length; i++) {
    r -= items[i].weight || 1;
    if (r <= 0) return i;
  }
  return items.length - 1;
}

// ── RIG VISUAL RECONCILIATION ───────────────────────────────────────────────
// When the rigging layer forces a win/loss, the game's natural visuals (cards,
// reels, dice, etc.) may contradict the forced result. These helpers regenerate
// visuals that genuinely PRODUCE the forced outcome, so the animation the player
// sees always matches the win/loss they're told. Critical: a rigged loss must
// never show a winning animation.
function round2(n: number): number { return Math.round(n * 100) / 100; }

function mkCard(value: number, suitIdx: number) {
  return { face: CARD_FACES[(value - 1) % 13]!, suit: CARD_SUITS[suitIdx % 4]!, value };
}
function randCard(value: number) {
  return mkCard(value, Math.floor(secureRandom() * 4));
}
function bjHandForTotal(total: number): { face: string; suit: string; value: number }[] {
  if (total > 21) return [randCard(10), randCard(10), randCard(10)];
  if (total === 21) return [randCard(10), randCard(1)];
  if (total >= 12) return [randCard(10), randCard(total - 10)];
  if (total >= 4) return [randCard(2), randCard(total - 2)];
  return [randCard(Math.max(2, total))];
}
function pokerWinHand(effMult: number) {
  const tiers = [
    { name: "Jacks or Better", mult: 1, cards: [mkCard(13,0),mkCard(13,1),mkCard(2,2),mkCard(7,3),mkCard(9,0)] },
    { name: "Two Pair", mult: 2, cards: [mkCard(13,0),mkCard(13,1),mkCard(7,2),mkCard(7,3),mkCard(2,0)] },
    { name: "Three of a Kind", mult: 3, cards: [mkCard(13,0),mkCard(13,1),mkCard(13,2),mkCard(7,3),mkCard(2,0)] },
    { name: "Straight", mult: 4, cards: [mkCard(5,0),mkCard(6,1),mkCard(7,2),mkCard(8,3),mkCard(9,0)] },
    { name: "Flush", mult: 6, cards: [mkCard(2,0),mkCard(5,0),mkCard(7,0),mkCard(9,0),mkCard(11,0)] },
    { name: "Full House", mult: 9, cards: [mkCard(13,0),mkCard(13,1),mkCard(13,2),mkCard(7,3),mkCard(7,0)] },
    { name: "Four of a Kind", mult: 25, cards: [mkCard(13,0),mkCard(13,1),mkCard(13,2),mkCard(13,3),mkCard(7,0)] },
    { name: "Straight Flush", mult: 50, cards: [mkCard(5,0),mkCard(6,0),mkCard(7,0),mkCard(8,0),mkCard(9,0)] },
    { name: "Royal Flush", mult: 800, cards: [mkCard(10,0),mkCard(11,0),mkCard(12,0),mkCard(13,0),mkCard(1,0)] },
  ];
  let best = tiers[0]!;
  for (const t of tiers) if (Math.abs(t.mult - effMult) < Math.abs(best.mult - effMult)) best = t;
  return best;
}
function threeCardWinHand(effMult: number) {
  const tiers = [
    { name: "Pair", mult: 2, cards: [mkCard(13,0),mkCard(13,1),mkCard(5,2)] },
    { name: "Flush", mult: 3, cards: [mkCard(2,0),mkCard(7,0),mkCard(11,0)] },
    { name: "Straight", mult: 6, cards: [mkCard(7,0),mkCard(8,1),mkCard(9,2)] },
    { name: "Straight Flush", mult: 20, cards: [mkCard(5,0),mkCard(6,0),mkCard(7,0)] },
    { name: "Three of a Kind", mult: 30, cards: [mkCard(13,0),mkCard(13,1),mkCard(13,2)] },
    { name: "Mini Royal", mult: 40, cards: [mkCard(12,0),mkCard(13,0),mkCard(1,0)] },
  ];
  let best = tiers[0]!;
  for (const t of tiers) if (Math.abs(t.mult - effMult) < Math.abs(best.mult - effMult)) best = t;
  return best;
}
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(secureRandom() * arr.length)] as T;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
// Build a believable non-winning hand (no pair/straight/flush) with random cards
// so forced poker losses don't show the identical cards every time.
function randomHighCardHand(n: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const vals = shuffle(Array.from({ length: 13 }, (_, i) => i + 1)).slice(0, n).sort((a, b) => a - b);
    const isStraight =
      vals.every((v, i) => i === 0 || v === vals[i - 1]! + 1) ||
      (n === 3 && JSON.stringify(vals) === JSON.stringify([1, 12, 13])) ||
      (n === 5 && JSON.stringify(vals) === JSON.stringify([1, 10, 11, 12, 13]));
    const suits = vals.map(() => Math.floor(secureRandom() * 4));
    const isFlush = suits.every((s) => s === suits[0]);
    if (!isStraight && !isFlush) return vals.map((v, i) => mkCard(v, suits[i]!));
  }
  return n === 3
    ? [mkCard(2, 0), mkCard(7, 1), mkCard(11, 2)]
    : [mkCard(2, 0), mkCard(5, 1), mkCard(9, 2), mkCard(11, 3), mkCard(13, 0)];
}

function reconcileForRig(o: {
  type: string; won: boolean; payout: number; wager: number;
  config: any; options: any[]; selectedOpt: any; pick: string | null | undefined;
}): { reels: string[]; details: any; message: string } {
  const { type, won, payout, wager, config, options, selectedOpt, pick } = o;
  const effMult = wager > 0 ? Math.max(1.1, round2(payout / wager)) : 2;
  // For a forced loss, land on a RANDOM non-selected option so repeated rigs
  // don't always show the identical losing result.
  const losers = options.filter((x) => !selectedOpt || x.id !== selectedOpt.id);
  const otherOpt = (losers.length ? pickRandom(losers) : options[0]) ?? selectedOpt;

  switch (type) {
    case "slots": {
      const items: any[] = (config.items && config.items.length) ? config.items : [
        { label: "Cherry", emoji: "CH", weight: 5, payout: 2 }, { label: "Bar", emoji: "BR", weight: 4, payout: 3 },
        { label: "Seven", emoji: "7", weight: 2, payout: 5 }, { label: "Skull", emoji: "SK", weight: 1, payout: 10 },
      ];
      const reelCount = config.reelCount || 3;
      if (won) {
        // Among symbols whose payout best matches the win size, pick at random so
        // repeated wins don't always show the same symbol.
        let bestDiff = Infinity;
        for (const x of items) bestDiff = Math.min(bestDiff, Math.abs((x.payout || 2) - effMult));
        const chosen = pickRandom(items.filter((x: any) => Math.abs((x.payout || 2) - effMult) === bestDiff));
        const spun = Array.from({ length: reelCount }, () => chosen);
        return { reels: spun.map((s: any) => s.label), details: { reels: spun.map((s: any) => ({ label: s.label, emoji: s.emoji })) }, message: `Jackpot! All ${chosen.label}s! Won ${payout} coins!` };
      }
      // The client recomputes win = all reels equal, so a forced loss MUST NOT be
      // all-equal. Spin random symbols, then guarantee a mismatch (covers the
      // degenerate single-symbol config too).
      const pool: any[] = items.length >= 2 ? items : [...items, { label: "Miss ❌", emoji: "X" }];
      const spun = Array.from({ length: reelCount }, () => pickRandom(pool));
      if (spun.every((s: any) => s.label === spun[0].label)) {
        const alt = pool.find((x: any) => x.label !== spun[0].label) || { label: "Miss ❌", emoji: "X" };
        spun[Math.floor(secureRandom() * reelCount)] = alt;
      }
      return { reels: spun.map((s: any) => s.label), details: { reels: spun.map((s: any) => ({ label: s.label, emoji: s.emoji })) }, message: `No match. Better luck next time!` };
    }
    case "coin_flip": case "card_draw": {
      const res = won ? selectedOpt : otherOpt;
      const verb = type === "card_draw" ? "Drew " : "";
      const details = type === "card_draw"
        ? { drawn: res?.label, picked: selectedOpt?.label }
        : { result: res?.label, picked: selectedOpt?.label };
      return { reels: [res?.label ?? "?"], details, message: won ? `${verb}${res?.label}! You won ${payout} coins!` : `${verb}${res?.label}. You picked ${selectedOpt?.label}. Better luck next time!` };
    }
    case "roulette": case "mystery_box": case "color_pick": case "lucky_spin": {
      const winOption = won ? selectedOpt : otherOpt;
      const details = type === "roulette"
        ? { result: winOption?.label, picked: selectedOpt?.label }
        : { box: selectedOpt?.label, result: winOption?.label };
      return { reels: [winOption?.label ?? "?"], details, message: won ? `${winOption?.label}! You won ${payout} coins!` : `Landed on ${winOption?.label}. You picked ${selectedOpt?.label}. Better luck next time!` };
    }
    case "number_pick": {
      const min = config.min || 1; const max = config.max || 10;
      const picked = parseInt(pick || "0", 10) || min;
      let drawn = picked;
      if (!won && max > min) { do { drawn = min + Math.floor(secureRandom() * (max - min + 1)); } while (drawn === picked); }
      return { reels: [String(drawn)], details: { picked, drawn, min, max }, message: won ? `Drew ${drawn}! You picked ${picked} — correct! Won ${payout} coins!` : `Drew ${drawn}. You picked ${picked}. No win.` };
    }
    case "jackpot": {
      const tickets = config.tickets || 100;
      const picked = parseInt(pick || "0", 10) || 1;
      let drawn = picked;
      if (!won && tickets > 1) { do { drawn = 1 + Math.floor(secureRandom() * tickets); } while (drawn === picked); }
      return { reels: [String(drawn)], details: { picked, drawn, tickets, jackpot: config.jackpot || payout }, message: won ? `Winning ticket: #${drawn}! You held #${picked}. JACKPOT! Won ${payout} coins!` : `Winning ticket: #${drawn}. You held #${picked}. Better luck next time!` };
    }
    case "dice": {
      const sides = config.sides || 6; const numDice = config.dice || 1;
      const minSum = numDice; const maxSum = sides * numDice;
      const picked = parseInt(pick || "0", 10) || minSum;
      let target = picked;
      if (!won && maxSum > minSum) { do { target = minSum + Math.floor(secureRandom() * (maxSum - minSum + 1)); } while (target === picked); }
      // Distribute the target sum across dice in random order so the individual
      // dice vary instead of always front-loading.
      const rolls = Array(numDice).fill(1); let rem = target - numDice;
      for (const i of shuffle(Array.from({ length: numDice }, (_, k) => k))) { if (rem <= 0) break; const add = Math.min(sides - 1, rem); rolls[i] += add; rem -= add; }
      const drawn = rolls.reduce((x: number, y: number) => x + y, 0);
      return { reels: [String(drawn)], details: { picked, drawn, rolls, sides, numDice }, message: won ? `Rolled ${rolls.join("+")} = ${drawn}! You picked ${picked}. Won ${payout} coins!` : `Rolled ${rolls.join("+")} = ${drawn}. You picked ${picked}. No win.` };
    }
    case "over_under": {
      const line = config.line || 50;
      const isOver = (selectedOpt?.label || "").toLowerCase().includes("over");
      const above = Math.min(100, line + 1 + Math.floor(secureRandom() * Math.max(1, 100 - line)));
      const below = Math.max(1, line - 1 - Math.floor(secureRandom() * Math.max(1, line - 1)));
      const drawn = won ? (isOver ? above : below) : (isOver ? below : above);
      return { reels: [String(drawn)], details: { drawn, line, picked: selectedOpt?.label }, message: won ? `Drew ${drawn} (line: ${line}). ${selectedOpt?.label} is correct! Won ${payout} coins!` : `Drew ${drawn} (line: ${line}). ${selectedOpt?.label} is wrong. No win.` };
    }
    case "hi_lo": {
      const shown = config.shown || 50;
      const isHigher = (selectedOpt?.label || "").toLowerCase().includes("hi");
      const above = Math.min(100, shown + 1 + Math.floor(secureRandom() * Math.max(1, 100 - shown)));
      const belowEq = Math.max(1, shown - Math.floor(secureRandom() * Math.max(1, shown)));
      const drawn = won ? (isHigher ? above : belowEq) : (isHigher ? belowEq : above);
      return { reels: [String(drawn)], details: { shown, drawn, picked: selectedOpt?.label }, message: won ? `Shown: ${shown} → Drew ${drawn}. ${selectedOpt?.label} is correct! Won ${payout} coins!` : `Shown: ${shown} → Drew ${drawn}. ${selectedOpt?.label} is wrong. No win.` };
    }
    case "wheel": {
      const sections = (config.sections && config.sections.length) ? config.sections : [
        { label: "Lose", weight: 5, payout: 0 }, { label: "2x", weight: 3, payout: 2 },
        { label: "5x", weight: 1, payout: 5 }, { label: "10x", weight: 0.5, payout: 10 },
      ];
      let landed: any;
      if (won) {
        const winners = sections.filter((s: any) => (s.payout || 0) > 0);
        if (winners.length) {
          let bestDiff = Infinity;
          for (const s of winners) bestDiff = Math.min(bestDiff, Math.abs((s.payout || 0) - effMult));
          landed = pickRandom(winners.filter((s: any) => Math.abs((s.payout || 0) - effMult) === bestDiff));
        } else {
          landed = { label: `${effMult}x`, payout: effMult };
        }
      } else {
        const losing = sections.filter((s: any) => (s.payout || 0) <= 0);
        landed = losing.length ? pickRandom(losing) : { label: "Lose", payout: 0 };
      }
      return { reels: [landed.label], details: { landed }, message: won ? `Wheel stopped on ${landed.label}! Won ${payout} coins!` : `Wheel stopped on ${landed.label}. No win this time.` };
    }
    case "plinko": {
      const rows = config.rows || 8;
      const mults: number[] = (config.multipliers && config.multipliers.length) ? config.multipliers : [0.3, 0.5, 1, 2, 5, 2, 1, 0.5, 0.3];
      const maxSlot = Math.min(mults.length - 1, rows);
      // The client recomputes win = (multiplier > 1) at the landed slot, so the
      // chosen slot's multiplier must agree with the forced result. Land on a
      // RANDOM eligible slot (winning slots closest to the win size for wins, any
      // <=1 slot for losses) so repeated rigs vary instead of always the same
      // slot. If the config has no eligible slot, fall back to the most extreme.
      const idx = Array.from({ length: maxSlot + 1 }, (_, i) => i);
      let slot = 0;
      if (won) {
        const winSlots = idx.filter((i) => (mults[i] ?? 0) > 1);
        if (winSlots.length) {
          let bestDiff = Infinity;
          for (const i of winSlots) bestDiff = Math.min(bestDiff, Math.abs(mults[i]! - effMult));
          slot = pickRandom(winSlots.filter((i) => Math.abs(mults[i]! - effMult) === bestDiff));
        } else {
          slot = idx.reduce((b, i) => ((mults[i] ?? 0) > (mults[b] ?? 0) ? i : b), 0);
        }
      } else {
        const loseSlots = idx.filter((i) => (mults[i] ?? 0) <= 1);
        slot = loseSlots.length ? pickRandom(loseSlots) : idx.reduce((b, i) => ((mults[i] ?? 0) < (mults[b] ?? 0) ? i : b), 0);
      }
      const multiplier = mults[slot] ?? 1;
      const path = Array.from({ length: rows }, (_, i) => (i < slot ? "R" : "L"));
      return { reels: [`${multiplier}x`], details: { path, slot, multiplier, rows }, message: won ? `Ball landed in slot ${slot + 1}! ${multiplier}x — Won ${payout} coins!` : `Ball landed in slot ${slot + 1}. ${multiplier}x — No win.` };
    }
    case "crash": {
      const target = parseFloat(pick || "2") || 2;
      let crashPoint: number;
      // Win: crash somewhere at/above the cashout target (random margin so it
      // varies). Loss: crash somewhere below the target (already random).
      if (won) crashPoint = round2(Math.max(target, effMult) * (1 + secureRandom() * 0.6));
      else { crashPoint = round2(Math.max(1, 1 + secureRandom() * Math.max(0.1, target - 1) * 0.9)); if (crashPoint >= target) crashPoint = round2(Math.max(1, target - 0.1)); }
      return { reels: [`${crashPoint}x`], details: { crashPoint, target }, message: won ? `🚀 Cashed out at ${target}x! Crashed at ${crashPoint}x. Won ${payout} coins!` : `💥 Crashed at ${crashPoint}x before your ${target}x target. No win.` };
    }
    case "keno": {
      const spots = parseInt(pick || "1", 10) || 1;
      const pool = config.pool || 80; const drawCount = config.draw || 20;
      const playerNumbers = Array.from({ length: spots }, (_, i) => i + 1);
      const otherNumbers = Array.from({ length: Math.max(0, pool - spots) }, (_, i) => spots + 1 + i);
      let drawn: number[]; let matches: number;
      if (won) {
        // All player numbers hit, plus random fillers from the rest.
        const fillers = shuffle(otherNumbers).slice(0, Math.max(0, drawCount - spots));
        drawn = [...playerNumbers, ...fillers]; matches = spots;
      } else {
        // Draw only from numbers the player did NOT pick → zero matches, varied.
        drawn = shuffle(otherNumbers).slice(0, Math.min(drawCount, otherNumbers.length)); matches = 0;
      }
      const multiplier = won && wager > 0 ? round2(payout / wager) : 0;
      return { reels: [`${matches}/${spots}`], details: { spots, playerNumbers, drawn: [...drawn].sort((x, y) => x - y), matches, multiplier }, message: won ? `${matches} of ${spots} matched! ${multiplier}x — Won ${payout} coins!` : `Only ${matches} of ${spots} matched. No win.` };
    }
    case "scratch_card": {
      const symbols: any[] = (config.symbols && config.symbols.length) ? config.symbols : [
        { label: "Cherry 🍒", weight: 8, payout: 3 }, { label: "Bell 🔔", weight: 5, payout: 5 },
        { label: "Coin 🪙", weight: 4, payout: 8 }, { label: "Diamond 💎", weight: 2, payout: 15 }, { label: "Lucky 7 ⑦", weight: 1, payout: 30 },
      ];
      if (won) {
        // Random winning symbol among those whose payout best fits the win size.
        let bestDiff = Infinity;
        for (const s of symbols) bestDiff = Math.min(bestDiff, Math.abs((s.payout || 2) - effMult));
        const chosen = pickRandom(symbols.filter((s: any) => Math.abs((s.payout || 2) - effMult) === bestDiff));
        const arr = [chosen, chosen, chosen];
        return { reels: arr.map((s: any) => s.label), details: { symbols: arr, allMatch: true, twoMatch: false }, message: `Three ${chosen.label}! ${chosen.payout}x — Won ${payout} coins!` };
      }
      // The client recomputes allMatch/twoMatch from the symbols, so a forced
      // loss MUST have three DISTINCT labels (no two equal). Build a distinct
      // pool, padding with synthetic blanks if the config has fewer than 3, then
      // pick three at random so the losing card varies each time.
      const distinct: any[] = [];
      for (const s of symbols) if (!distinct.find((d) => d.label === s.label)) distinct.push(s);
      const fillers = [
        { label: "Miss ❌", weight: 1, payout: 0 },
        { label: "Dud 🚫", weight: 1, payout: 0 },
        { label: "Blank ⬜", weight: 1, payout: 0 },
      ].filter((f) => !distinct.find((d) => d.label === f.label));
      const arr = shuffle([...distinct, ...fillers]).slice(0, 3);
      return { reels: arr.map((s: any) => s.label), details: { symbols: arr, allMatch: false, twoMatch: false }, message: `No match: ${arr[0].label}, ${arr[1].label}, ${arr[2].label}. Better luck!` };
    }
    case "mines": {
      const mineCount = parseInt(pick || "3", 10) || 3;
      const gridSize = 25;
      const mineMult = won && wager > 0 ? round2(payout / wager) : round2((gridSize / (gridSize - mineCount)) * 0.95);
      // Random mine layout + random picked tile so repeated rigs don't show the
      // same board every time.
      const minePositions = new Set<number>();
      while (minePositions.size < Math.min(mineCount, gridSize - 1)) { minePositions.add(Math.floor(secureRandom() * gridSize)); }
      const safeTiles = Array.from({ length: gridSize }, (_, i) => i).filter((i) => !minePositions.has(i));
      const tileIndex = won ? pickRandom(safeTiles) : pickRandom([...minePositions]);
      const grid = Array.from({ length: gridSize }, (_, i) => (minePositions.has(i) ? (i === tileIndex ? "picked_mine" : "mine") : (i === tileIndex ? "picked_safe" : "safe")));
      return { reels: [won ? "SAFE 💎" : "MINE 💣"], details: { mineCount, tileIndex, minePositions: [...minePositions], grid, isSafe: won, multiplier: mineMult }, message: won ? `Safe! ${mineCount} mines on the board. ${mineMult}x — Won ${payout} coins!` : `💥 Boom! Hit a mine. ${mineCount} mines. No win.` };
    }
    case "blackjack": {
      // Random non-bust totals where the winner is strictly ahead, for variety.
      const hi = pickRandom([19, 20, 21]); const lo = pickRandom([17, 18]);
      const playerCards = won ? bjHandForTotal(hi) : bjHandForTotal(lo);
      const dealerCards = won ? bjHandForTotal(lo) : bjHandForTotal(hi);
      const playerTotal = bjHandValue(playerCards); const dealerTotal = bjHandValue(dealerCards);
      return { reels: playerCards.map((c) => `${c.face}${c.suit}`), details: { playerCards, dealerCards, playerTotal, dealerTotal, isHit: false }, message: won ? `${playerTotal} beats dealer's ${dealerTotal}! Won ${payout} coins!` : `Dealer's ${dealerTotal} beats your ${playerTotal}. No win.` };
    }
    case "war": {
      // Random card values where the winner's card outranks the loser's.
      const hiV = 2 + Math.floor(secureRandom() * 12); // 2..13
      const loV = 1 + Math.floor(secureRandom() * (hiV - 1)); // 1..hiV-1
      const pc = won ? randCard(hiV) : randCard(loV);
      const dc = won ? randCard(loV) : randCard(hiV);
      return { reels: [`${pc.face}${pc.suit}`, "vs", `${dc.face}${dc.suit}`], details: { playerCard: pc, dealerCard: dc, war: false }, message: won ? `Your ${pc.face}${pc.suit} beats ${dc.face}${dc.suit}! Won ${payout} coins!` : `Dealer's ${dc.face}${dc.suit} beats your ${pc.face}${pc.suit}. No win.` };
    }
    case "baccarat": {
      const betLabel = (selectedOpt?.label || "").toLowerCase();
      const betType = betLabel.includes("bank") ? "banker" : betLabel.includes("tie") ? "tie" : "player";
      const outcome = won ? betType : (betType === "player" ? "banker" : "player");
      const mkScore = (s: number) => [mkCard(s === 0 ? 10 : s, Math.floor(secureRandom() * 4)), mkCard(13, Math.floor(secureRandom() * 4))];
      let pScore: number; let bScore: number;
      if (outcome === "tie") { pScore = Math.floor(secureRandom() * 10); bScore = pScore; }
      else if (outcome === "player") { pScore = 6 + Math.floor(secureRandom() * 4); bScore = Math.floor(secureRandom() * pScore); }
      else { bScore = 6 + Math.floor(secureRandom() * 4); pScore = Math.floor(secureRandom() * bScore); }
      const playerCards = mkScore(pScore); const bankerCards = mkScore(bScore);
      const winner = outcome.charAt(0).toUpperCase() + outcome.slice(1);
      return { reels: [`P:${pScore}`, `B:${bScore}`], details: { playerCards, bankerCards, playerScore: pScore, bankerScore: bScore, outcome, betType }, message: won ? `${winner} wins (P:${pScore} B:${bScore})! Won ${payout} coins!` : `${winner} wins (P:${pScore} B:${bScore}). You bet on ${betType}. No win.` };
    }
    case "video_poker": {
      if (won) { const h = pokerWinHand(effMult); return { reels: [h.name], details: { cards: h.cards, handName: h.name, multiplier: h.mult }, message: `${h.name}! Won ${payout} coins!` }; }
      const cards = randomHighCardHand(5);
      return { reels: ["No Hand"], details: { cards, handName: "No Hand", multiplier: 0 }, message: `No Hand. No winning hand this time.` };
    }
    case "three_card_poker": {
      if (won) { const h = threeCardWinHand(effMult); return { reels: [h.name], details: { cards: h.cards, handName: h.name, multiplier: h.mult }, message: `${h.name}! Won ${payout} coins!` }; }
      const cards = randomHighCardHand(3);
      return { reels: ["High Card"], details: { cards, handName: "High Card", multiplier: 0 }, message: `High Card only. No winning hand.` };
    }
    default:
      return { reels: [won ? "WIN" : "LOSE"], details: {}, message: won ? `Won ${payout} coins!` : `No win.` };
  }
}

router.post("/games/:id/play", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idParam = PlayGameParams.safeParse({ id: parseInt(rawId, 10) });
  if (!idParam.success) {
    res.status(400).json({ error: idParam.error.message });
    return;
  }

  const body = PlayGameBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { playerId, wager, optionId, pick } = body.data;

  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, idParam.data.id));

  if (!game) { res.status(404).json({ error: "Game not found" }); return; }
  if (game.status !== "open") { res.status(400).json({ error: "Game is not open for betting" }); return; }

  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.id, playerId));

  if (!player) { res.status(404).json({ error: "Player not found" }); return; }
  if (player.balance < wager) { res.status(400).json({ error: "Insufficient balance" }); return; }
  if (wager <= 0) { res.status(400).json({ error: "Wager must be positive" }); return; }

  const options = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, game.id));

  let won = false;
  let payout = 0;
  let reels: string[] = [];
  let message = "";
  let details: any = {};

  const config = game.config as any;

  // Wager limits from game config
  const _minWag = Number(config.minWager) || 0;
  const _maxWag = Number(config.maxWager) || 0;
  if (_minWag > 0 && wager < _minWag) { res.status(400).json({ error: `Minimum wager for this game is ${_minWag} coins` }); return; }
  if (_maxWag > 0 && wager > _maxWag) { res.status(400).json({ error: `Maximum wager for this game is ${_maxWag} coins` }); return; }

  // ── SLOTS ─────────────────────────────────────────────────────────────────
  if (game.type === "slots") {
    const items: { label: string; emoji: string; weight: number; payout: number }[] =
      config.items || [
        { label: "Cherry", emoji: "CH", weight: 5, payout: 2 },
        { label: "Bar", emoji: "BR", weight: 4, payout: 3 },
        { label: "Seven", emoji: "7", weight: 2, payout: 5 },
        { label: "Skull", emoji: "SK", weight: 1, payout: 10 },
      ];
    const reelCount = config.reelCount || 3;
    const spun = Array.from({ length: reelCount }, () => items[weightedRandom(items)]);
    reels = spun.map((s) => s.label);
    details = { reels: spun.map((s) => ({ label: s.label, emoji: s.emoji })) };
    if (spun.every((s) => s.label === spun[0]!.label)) {
      won = true;
      payout = Math.floor(wager * (spun[0]?.payout ?? 2));
      message = `Jackpot! All ${spun[0]?.label}s! Won ${payout} coins!`;
    } else {
      message = `No match. Better luck next time!`;
    }

  // ── COIN FLIP ──────────────────────────────────────────────────────────────
  } else if (game.type === "coin_flip") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick heads or tails" }); return; }
    const flip = options[Math.floor(secureRandom() * options.length)];
    reels = [flip.label];
    details = { result: flip.label, picked: selectedOption.label };
    won = flip.id === selectedOption.id;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `${flip.label}! You won ${payout} coins!`;
    } else {
      message = `${flip.label}! You picked ${selectedOption.label}. Better luck next time!`;
    }

  // ── MATCH BET ──────────────────────────────────────────────────────────────
  } else if (game.type === "match_bet" || game.type === "trivia") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick an option" }); return; }
    reels = [selectedOption.label];
    details = { picked: selectedOption.label, optionId: selectedOption.id };
    won = false;
    payout = 0;
    if (game.type === "trivia") {
      message = `Answer "${selectedOption.label}" submitted. Waiting for moderator to reveal the correct answer.`;
    } else {
      message = `Bet placed on "${selectedOption.label}" for ${wager} coins. Waiting for resolution.`;
    }

  // ── NUMBER PICK ────────────────────────────────────────────────────────────
  } else if (game.type === "number_pick") {
    const min = config.min || 1;
    const max = config.max || 10;
    const picked = parseInt(pick || "0", 10);
    if (isNaN(picked) || picked < min || picked > max) {
      res.status(400).json({ error: `Pick a number between ${min} and ${max}` }); return;
    }
    const drawn = Math.floor(secureRandom() * (max - min + 1)) + min;
    reels = [String(drawn)];
    details = { picked, drawn, min, max };
    won = picked === drawn;
    const oddsVal = config.odds || 5;
    if (won) {
      payout = Math.floor(wager * oddsVal);
      message = `Drew ${drawn}! You picked ${picked} — correct! Won ${payout} coins!`;
    } else {
      message = `Drew ${drawn}. You picked ${picked}. No win.`;
    }

  // ── MYSTERY BOX ────────────────────────────────────────────────────────────
  } else if (game.type === "mystery_box" || game.type === "color_pick" || game.type === "lucky_spin") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick an option" }); return; }
    const winIdx = weightedRandom(options);
    const winOption = options[winIdx];
    reels = [winOption.label];
    details = { box: selectedOption.label, result: winOption.label };
    won = selectedOption.id === winOption.id;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      const label = game.type === "color_pick" ? `${selectedOption.label} wins!`
        : game.type === "lucky_spin" ? `Lucky ${selectedOption.label}!`
        : `You opened "${selectedOption.label}" and found a prize!`;
      message = `${label} Won ${payout} coins!`;
    } else {
      const label = game.type === "color_pick" ? `${winOption.label} wins. You picked ${selectedOption.label}.`
        : game.type === "lucky_spin" ? `Landed on ${winOption.label}. You picked ${selectedOption.label}.`
        : `Box "${selectedOption.label}" had nothing. The winning box was "${winOption.label}".`;
      message = `${label} Better luck next time!`;
    }

  // ── DICE ───────────────────────────────────────────────────────────────────
  } else if (game.type === "dice") {
    const sides = config.sides || 6;
    const numDice = config.dice || 1;
    const maxNum = sides * numDice;
    const minNum = numDice;
    const picked = parseInt(pick || "0", 10);
    if (isNaN(picked) || picked < minNum || picked > maxNum) {
      res.status(400).json({ error: `Pick a number between ${minNum} and ${maxNum}` }); return;
    }
    const rolls = Array.from({ length: numDice }, () => Math.floor(secureRandom() * sides) + 1);
    const drawn = rolls.reduce((a, b) => a + b, 0);
    reels = [String(drawn)];
    details = { picked, drawn, rolls, sides, numDice };
    won = picked === drawn;
    const oddsVal = config.odds || sides;
    if (won) {
      payout = Math.floor(wager * oddsVal);
      message = `Rolled ${rolls.join("+")} = ${drawn}! You picked ${picked}. Won ${payout} coins!`;
    } else {
      message = `Rolled ${rolls.join("+")} = ${drawn}. You picked ${picked}. No win.`;
    }

  // ── ROULETTE ───────────────────────────────────────────────────────────────
  } else if (game.type === "roulette") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick an option" }); return; }
    const winIdx = weightedRandom(options);
    const winOption = options[winIdx];
    reels = [winOption.label];
    details = { result: winOption.label, picked: selectedOption.label };
    won = selectedOption.id === winOption.id;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `Ball landed on ${winOption.label}! You picked ${selectedOption.label}. Won ${payout} coins!`;
    } else {
      message = `Ball landed on ${winOption.label}. You picked ${selectedOption.label}. Better luck next time!`;
    }

  // ── WHEEL ──────────────────────────────────────────────────────────────────
  } else if (game.type === "wheel") {
    const sections: { label: string; weight: number; payout: number }[] =
      config.sections || [
        { label: "Lose", weight: 5, payout: 0 },
        { label: "2x", weight: 3, payout: 2 },
        { label: "5x", weight: 1, payout: 5 },
        { label: "10x", weight: 0.5, payout: 10 },
      ];
    const idx = weightedRandom(sections);
    const landed = sections[idx];
    reels = [landed.label];
    details = { landed };
    won = (landed.payout || 0) > 0;
    if (won) {
      payout = Math.floor(wager * landed.payout);
      message = `Wheel stopped on ${landed.label}! Won ${payout} coins!`;
    } else {
      message = `Wheel stopped on ${landed.label}. No win this time.`;
    }

  // ── CARD DRAW ──────────────────────────────────────────────────────────────
  } else if (game.type === "card_draw") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick a card suit" }); return; }
    const drawnOption = options[Math.floor(secureRandom() * options.length)];
    reels = [drawnOption.label];
    details = { drawn: drawnOption.label, picked: selectedOption.label };
    won = drawnOption.id === selectedOption.id;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `Drew ${drawnOption.label}! You picked ${selectedOption.label}. Won ${payout} coins!`;
    } else {
      message = `Drew ${drawnOption.label}. You picked ${selectedOption.label}. Better luck!`;
    }

  // ── OVER / UNDER ───────────────────────────────────────────────────────────
  } else if (game.type === "over_under") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick Over or Under" }); return; }
    const line = config.line || 50;
    const drawn = Math.floor(secureRandom() * 100) + 1;
    reels = [String(drawn)];
    details = { drawn, line, picked: selectedOption.label };
    const isOver = selectedOption.label.toLowerCase().includes("over");
    won = isOver ? drawn > line : drawn < line;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `Drew ${drawn} (line: ${line}). ${selectedOption.label} is correct! Won ${payout} coins!`;
    } else {
      message = `Drew ${drawn} (line: ${line}). ${selectedOption.label} is wrong. No win.`;
    }

  // ── HI / LO ────────────────────────────────────────────────────────────────
  } else if (game.type === "hi_lo") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Must pick Higher or Lower" }); return; }
    const shown = config.shown || Math.floor(secureRandom() * 90) + 5;
    const drawn = Math.floor(secureRandom() * 100) + 1;
    reels = [String(drawn)];
    details = { shown, drawn, picked: selectedOption.label };
    const isHigher = selectedOption.label.toLowerCase().includes("hi") || selectedOption.label.toLowerCase().includes("high");
    won = isHigher ? drawn > shown : drawn <= shown;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `Shown: ${shown} → Drew ${drawn}. ${selectedOption.label} is correct! Won ${payout} coins!`;
    } else {
      message = `Shown: ${shown} → Drew ${drawn}. ${selectedOption.label} is wrong. No win.`;
    }

  // ── JACKPOT ────────────────────────────────────────────────────────────────
  } else if (game.type === "jackpot") {
    const tickets = config.tickets || 100;
    const jackpotAmt = config.jackpot || 10000;
    const picked = parseInt(pick || "0", 10);
    if (isNaN(picked) || picked < 1 || picked > tickets) {
      res.status(400).json({ error: `Pick a ticket number between 1 and ${tickets}` }); return;
    }
    const drawn = Math.floor(secureRandom() * tickets) + 1;
    reels = [String(drawn)];
    details = { picked, drawn, tickets, jackpot: jackpotAmt };
    won = picked === drawn;
    if (won) {
      payout = jackpotAmt;
      message = `Winning ticket: #${drawn}! You held ticket #${picked}. JACKPOT! Won ${payout} coins!`;
    } else {
      message = `Winning ticket: #${drawn}. You held ticket #${picked}. Better luck next time!`;
    }

  // ── PLINKO ─────────────────────────────────────────────────────────────────
  } else if (game.type === "plinko") {
    const rows: number = config.rows || 8;
    const mults: number[] = config.multipliers || [0.3, 0.5, 1, 2, 5, 2, 1, 0.5, 0.3];
    const path: string[] = Array.from({ length: rows }, () => secureRandom() < 0.5 ? "R" : "L");
    const slot = Math.min(path.filter(d => d === "R").length, mults.length - 1);
    const multiplier = mults[slot] ?? 1;
    payout = Math.floor(wager * multiplier);
    won = multiplier > 1;
    reels = [`${multiplier}x`];
    details = { path, slot, multiplier, rows };
    if (payout > wager) message = `Ball landed in slot ${slot + 1}! ${multiplier}x — Won ${payout} coins!`;
    else if (payout > 0) message = `Ball landed in slot ${slot + 1}. ${multiplier}x — Partial return: ${payout} coins.`;
    else message = `Ball landed in slot ${slot + 1}. ${multiplier}x — No win.`;

  // ── BLACKJACK ──────────────────────────────────────────────────────────────
  } else if (game.type === "blackjack") {
    const selectedOption = options.find(o => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Choose Hit or Stand" }); return; }
    const isHit = selectedOption.label.toLowerCase() === "hit";
    const playerCards = [drawCard(), drawCard(), ...(isHit ? [drawCard()] : [])];
    const dealerCards = [drawCard(), drawCard()];
    while (bjHandValue(dealerCards) < 17) dealerCards.push(drawCard());
    const playerTotal = bjHandValue(playerCards);
    const dealerTotal = bjHandValue(dealerCards);
    const winMult = config.win_multiplier || 2;
    reels = playerCards.map(c => `${c.face}${c.suit}`);
    details = { playerCards, dealerCards, playerTotal, dealerTotal, isHit };
    if (playerTotal > 21) {
      won = false; message = `Bust! You drew ${playerTotal}. No win.`;
    } else if (dealerTotal > 21) {
      won = true; payout = Math.floor(wager * winMult);
      message = `Dealer busts at ${dealerTotal}! You: ${playerTotal}. Won ${payout} coins!`;
    } else if (playerTotal > dealerTotal) {
      won = true; payout = Math.floor(wager * winMult);
      message = `${playerTotal} beats dealer's ${dealerTotal}! Won ${payout} coins!`;
    } else if (playerTotal === dealerTotal) {
      won = false; payout = wager;
      message = `Push! Both drew ${playerTotal}. Wager returned.`;
    } else {
      won = false; message = `Dealer's ${dealerTotal} beats your ${playerTotal}. No win.`;
    }

  // ── CRASH ──────────────────────────────────────────────────────────────────
  } else if (game.type === "crash") {
    const target = parseFloat(pick || "0");
    const maxTarget = config.maxTarget || 100;
    if (isNaN(target) || target < 1.1 || target > maxTarget) {
      res.status(400).json({ error: `Enter a cashout multiplier between 1.1 and ${maxTarget}` }); return;
    }
    const crashPoint = parseFloat(Math.max(1.0, 0.99 / secureRandom()).toFixed(2));
    won = crashPoint >= target;
    payout = won ? Math.floor(wager * target) : 0;
    reels = [`${crashPoint}x`];
    details = { crashPoint, target };
    message = won
      ? `🚀 Cashed out at ${target}x! Crashed at ${crashPoint}x. Won ${payout} coins!`
      : `💥 Crashed at ${crashPoint}x before your ${target}x target. No win.`;

  // ── KENO ───────────────────────────────────────────────────────────────────
  } else if (game.type === "keno") {
    const spots = parseInt(pick || "0", 10);
    const maxSpots = config.maxSpots || 10;
    const pool = config.pool || 80;
    const drawCount = config.draw || 20;
    if (isNaN(spots) || spots < 1 || spots > maxSpots) {
      res.status(400).json({ error: `Pick between 1 and ${maxSpots} spots` }); return;
    }
    const playerNums = new Set<number>();
    while (playerNums.size < spots) playerNums.add(Math.floor(secureRandom() * pool) + 1);
    const drawnNums = new Set<number>();
    while (drawnNums.size < drawCount) drawnNums.add(Math.floor(secureRandom() * pool) + 1);
    const matches = [...playerNums].filter(n => drawnNums.has(n)).length;
    const kenoPay: Record<number, Record<number, number>> = {
      1: {1:3}, 2: {2:9}, 3: {3:45,2:3}, 4: {4:100,3:5,2:2},
      5: {5:300,4:20,3:4,2:1}, 6: {6:800,5:50,4:8,3:2},
      7: {7:2000,6:100,5:15,4:4,3:1}, 8: {8:5000,7:200,6:30,5:6,4:2},
      9: {9:10000,8:500,7:50,6:10,5:3}, 10: {10:25000,9:1000,8:100,7:20,6:5,5:2},
    };
    const kenoMult = kenoPay[spots]?.[matches] ?? 0;
    payout = Math.floor(wager * kenoMult);
    won = payout > 0;
    reels = [`${matches}/${spots}`];
    details = { spots, playerNumbers: [...playerNums].sort((a,b)=>a-b), drawn: [...drawnNums].sort((a,b)=>a-b), matches, multiplier: kenoMult };
    message = won
      ? `${matches} of ${spots} matched! ${kenoMult}x — Won ${payout} coins!`
      : `Only ${matches} of ${spots} matched. No win.`;

  // ── SCRATCH CARD ───────────────────────────────────────────────────────────
  } else if (game.type === "scratch_card") {
    const symbols: { label: string; weight: number; payout: number }[] = config.symbols || [
      { label: "Cherry 🍒", weight: 8, payout: 3 },
      { label: "Bell 🔔",   weight: 5, payout: 5 },
      { label: "Coin 🪙",   weight: 4, payout: 8 },
      { label: "Diamond 💎", weight: 2, payout: 15 },
      { label: "Lucky 7 ⑦", weight: 1, payout: 30 },
    ];
    const s1 = symbols[weightedRandom(symbols)]!;
    const s2 = symbols[weightedRandom(symbols)]!;
    const s3 = symbols[weightedRandom(symbols)]!;
    reels = [s1.label, s2.label, s3.label];
    const allMatch = s1.label === s2.label && s2.label === s3.label;
    const twoMatch = !allMatch && (s1.label === s2.label || s2.label === s3.label || s1.label === s3.label);
    details = { symbols: [s1, s2, s3], allMatch, twoMatch };
    if (allMatch) {
      payout = Math.floor(wager * s1.payout); won = true;
      message = `Three ${s1.label}! ${s1.payout}x — Won ${payout} coins!`;
    } else if (twoMatch) {
      payout = Math.floor(wager * 1.5); won = true;
      message = `Two of a kind! 1.5x — Won ${payout} coins!`;
    } else {
      won = false;
      message = `No match: ${s1.label}, ${s2.label}, ${s3.label}. Better luck!`;
    }

  // ── VIDEO POKER ────────────────────────────────────────────────────────────
  } else if (game.type === "video_poker") {
    const hand = makeDeck().slice(0, 5);
    const vals5 = hand.map(c => c.value).sort((a,b) => a - b);
    const suits5 = hand.map(c => c.suit);
    const isFlush5 = suits5.every(s => s === suits5[0]);
    const isStraight5 = (vals5[4]! - vals5[0]! === 4 && new Set(vals5).size === 5)
      || (JSON.stringify(vals5) === JSON.stringify([1,10,11,12,13]));
    const vc5 = vals5.reduce((a,v) => { a[v]=(a[v]||0)+1; return a; }, {} as Record<number,number>);
    const cnts5 = Object.values(vc5).sort((a,b) => b - a);
    let pokerName = "No Hand"; let pokerMult = 0;
    if (isFlush5 && isStraight5 && vals5.includes(1) && vals5.includes(13)) { pokerName="Royal Flush"; pokerMult=800; }
    else if (isFlush5 && isStraight5) { pokerName="Straight Flush"; pokerMult=50; }
    else if (cnts5[0]===4) { pokerName="Four of a Kind"; pokerMult=25; }
    else if (cnts5[0]===3 && cnts5[1]===2) { pokerName="Full House"; pokerMult=9; }
    else if (isFlush5) { pokerName="Flush"; pokerMult=6; }
    else if (isStraight5) { pokerName="Straight"; pokerMult=4; }
    else if (cnts5[0]===3) { pokerName="Three of a Kind"; pokerMult=3; }
    else if (cnts5[0]===2 && cnts5[1]===2) { pokerName="Two Pair"; pokerMult=2; }
    else if (cnts5[0]===2) {
      const pairV = parseInt(Object.entries(vc5).find(([,v])=>v===2)?.[0]??"0");
      if (pairV>=11 || pairV===1) { pokerName="Jacks or Better"; pokerMult=1; }
    }
    payout = Math.floor(wager * pokerMult);
    won = pokerMult >= 1;
    reels = [pokerName];
    details = { cards: hand, handName: pokerName, multiplier: pokerMult };
    message = pokerMult >= 1
      ? `${pokerName}! ${pokerMult}x — Won ${payout} coins!`
      : `${pokerName}. No winning hand this time.`;

  // ── MINES ──────────────────────────────────────────────────────────────────
  } else if (game.type === "mines") {
    const mineCount = parseInt(pick || "0", 10);
    const maxMines = config.maxMines || 24;
    if (isNaN(mineCount) || mineCount < 1 || mineCount > maxMines) {
      res.status(400).json({ error: `Pick 1–${maxMines} mines` }); return;
    }
    const gridSize = 25;
    const isSafe = secureRandom() < (gridSize - mineCount) / gridSize;
    const mineMult = parseFloat(Math.max(1.05, (gridSize / (gridSize - mineCount)) * 0.95).toFixed(2));
    const minePositions = new Set<number>();
    while (minePositions.size < mineCount) minePositions.add(Math.floor(secureRandom() * gridSize));
    const safeTiles = Array.from({length:gridSize},(_,i)=>i).filter(i=>!minePositions.has(i));
    const mineTiles = [...minePositions];
    const tileIndex = isSafe
      ? safeTiles[Math.floor(secureRandom() * safeTiles.length)]!
      : mineTiles[Math.floor(secureRandom() * mineTiles.length)]!;
    payout = isSafe ? Math.floor(wager * mineMult) : 0;
    won = isSafe;
    reels = [isSafe ? "SAFE 💎" : "MINE 💣"];
    details = { mineCount, tileIndex, minePositions:[...minePositions], grid:Array.from({length:gridSize},(_,i)=>minePositions.has(i)?(i===tileIndex?"picked_mine":"mine"):(i===tileIndex?"picked_safe":"safe")), isSafe, multiplier:mineMult };
    message = isSafe
      ? `Safe! ${mineCount} mines on the board. ${mineMult}x — Won ${payout} coins!`
      : `💥 Boom! Hit a mine. ${mineCount} mines. No win.`;

  // ── WAR ────────────────────────────────────────────────────────────────────
  } else if (game.type === "war") {
    const pc = drawCard(); const dc = drawCard();
    const tieMult = config.tieMult || 3;
    const winMult2 = config.winMult || 2;
    if (pc.value === dc.value) {
      const pc2 = drawCard(); const dc2 = drawCard();
      won = pc2.value > dc2.value;
      payout = won ? Math.floor(wager * tieMult) : 0;
      reels = [`${pc.face}${pc.suit}`, "WAR", `${pc2.face}${pc2.suit}`, "vs", `${dc2.face}${dc2.suit}`];
      details = { playerCard:pc, dealerCard:dc, war:true, warPlayer:pc2, warDealer:dc2 };
      message = won
        ? `War on ${pc.face}s! You: ${pc2.face}${pc2.suit}, Dealer: ${dc2.face}${dc2.suit}. You win! ${payout} coins!`
        : `War on ${pc.face}s! You: ${pc2.face}${pc2.suit}, Dealer: ${dc2.face}${dc2.suit}. Dealer wins.`;
    } else {
      won = pc.value > dc.value;
      payout = won ? Math.floor(wager * winMult2) : 0;
      reels = [`${pc.face}${pc.suit}`, "vs", `${dc.face}${dc.suit}`];
      details = { playerCard:pc, dealerCard:dc, war:false };
      message = won
        ? `Your ${pc.face}${pc.suit} beats ${dc.face}${dc.suit}! Won ${payout} coins!`
        : `Dealer's ${dc.face}${dc.suit} beats your ${pc.face}${pc.suit}. No win.`;
    }

  // ── BACCARAT ───────────────────────────────────────────────────────────────
  } else if (game.type === "baccarat") {
    const selectedOption = options.find(o => o.id === optionId);
    if (!selectedOption) { res.status(400).json({ error: "Bet on Player, Banker, or Tie" }); return; }
    const betLabel = selectedOption.label.toLowerCase();
    const betType = betLabel.includes("bank") ? "banker" : betLabel.includes("tie") ? "tie" : "player";
    const pCards = [drawCard(), drawCard()];
    const bCards = [drawCard(), drawCard()];
    let pScore = baccaratScore(pCards);
    let bScore = baccaratScore(bCards);
    if (pScore < 8 && bScore < 8) {
      if (pScore <= 5) pCards.push(drawCard());
      pScore = baccaratScore(pCards);
      if (bScore <= 5) bCards.push(drawCard());
      bScore = baccaratScore(bCards);
    }
    const bacOutcome = pScore > bScore ? "player" : bScore > pScore ? "banker" : "tie";
    won = bacOutcome === betType;
    payout = won ? Math.floor(wager * parseFloat(selectedOption.odds)) : 0;
    reels = [`P:${pScore}`, `B:${bScore}`];
    details = { playerCards:pCards, bankerCards:bCards, playerScore:pScore, bankerScore:bScore, outcome:bacOutcome, betType };
    const winner = bacOutcome.charAt(0).toUpperCase() + bacOutcome.slice(1);
    message = won
      ? `${winner} wins (P:${pScore} B:${bScore})! Won ${payout} coins!`
      : `${winner} wins (P:${pScore} B:${bScore}). You bet on ${betType}. No win.`;

  // ── THREE CARD POKER ───────────────────────────────────────────────────────
  } else if (game.type === "three_card_poker") {
    const hand3 = makeDeck().slice(0, 3);
    const v3 = hand3.map(c => c.value).sort((a,b) => a - b);
    const s3 = hand3.map(c => c.suit);
    const isFlush3 = s3.every(s => s === s3[0]);
    const isStraight3 = ((v3[2]! - v3[0]!) === 2 && new Set(v3).size === 3)
      || JSON.stringify(v3)===JSON.stringify([1,2,3])
      || JSON.stringify(v3)===JSON.stringify([1,11,12])
      || JSON.stringify(v3)===JSON.stringify([1,12,13]);
    const vc3 = v3.reduce((a,v)=>{ a[v]=(a[v]||0)+1; return a; },{} as Record<number,number>);
    const maxCnt3 = Math.max(...Object.values(vc3));
    let hand3Name = "High Card"; let mult3 = 0;
    const isRoyal3 = isFlush3 && isStraight3 && v3.includes(1) && (v3.includes(12)||v3.includes(13));
    if (isRoyal3) { hand3Name="Mini Royal"; mult3=40; }
    else if (isFlush3 && isStraight3) { hand3Name="Straight Flush"; mult3=20; }
    else if (maxCnt3===3) { hand3Name="Three of a Kind"; mult3=30; }
    else if (isStraight3) { hand3Name="Straight"; mult3=6; }
    else if (isFlush3) { hand3Name="Flush"; mult3=3; }
    else if (maxCnt3===2) { hand3Name="Pair"; mult3=2; }
    payout = mult3 > 0 ? Math.floor(wager * mult3) : 0;
    won = mult3 > 0;
    reels = [hand3Name];
    details = { cards:hand3, handName:hand3Name, multiplier:mult3 };
    message = mult3 > 0
      ? `${hand3Name}! ${mult3}x — Won ${payout} coins!`
      : `High Card only. No winning hand.`;
  }

  // ── RIGGING LAYER ─────────────────────────────────────────────────────────
  {
    let rigOverrode = false;
    let riggedMessage: string | null = null;
    const selectedOpt = options.find(o => o.id === optionId);

    // The multiplier a NATURAL win would have paid for this exact bet, captured
    // before any rig branch mutates won/payout. Used so a FORCED win pays what the
    // game promised for the player's selection (e.g. an 8x color pick pays 8x),
    // not a flat 2x. An explicitly configured rig multiplier still overrides it.
    const naturalMult = won && payout > 0 && wager > 0 ? round2(payout / wager) : 0;
    const winMultFor = (explicit?: number | null): number => {
      // A deliberately configured, non-default multiplier always takes priority.
      if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit !== 2) return explicit;
      // Otherwise pay what the player's own selection would naturally return.
      // Config-driven game types resolve their multiplier from config (not option
      // odds), so they must be checked before the generic option-odds fallback.
      if (game.type === "number_pick" || game.type === "dice") { const o = Number(config.odds); if (Number.isFinite(o) && o > 0) return o; }
      if (game.type === "crash") { const t = parseFloat(pick || ""); if (Number.isFinite(t) && t > 0) return t; }
      if (game.type === "jackpot") { const jp = Number(config.jackpot); if (Number.isFinite(jp) && jp > 0 && wager > 0) return jp / wager; }
      if (game.type === "blackjack") { const o = Number(config.win_multiplier); if (Number.isFinite(o) && o > 0) return o; }
      if (game.type === "war") { const o = Number(config.winMult); if (Number.isFinite(o) && o > 0) return o; }
      // Option-odds games (color_pick, roulette, coin_flip, …): pay the chosen option's odds.
      if (selectedOpt) { const o = parseFloat(String(selectedOpt.odds)); if (Number.isFinite(o) && o > 0) return o; }
      if (naturalMult > 0) return naturalMult;
      return explicit != null && Number.isFinite(explicit) && explicit > 0 ? explicit : 2;
    };

    // 1. Per-option trueWinPct: override win probability based on the chosen option
    if (selectedOpt && selectedOpt.trueWinPct !== null && selectedOpt.trueWinPct !== undefined) {
      const shouldWin = secureRandom() * 100 < selectedOpt.trueWinPct;
      won = shouldWin;
      payout = won ? Math.floor(wager * parseFloat(selectedOpt.odds)) : 0;
      rigOverrode = true;
    }

    // 2. Streak-based checks (query recent bets on this game for this player)
    const minLoss = Number(config.minLossStreak) || 0;
    const maxWin = Number(config.maxWinStreak) || 0;
    if (minLoss > 0 || maxWin > 0) {
      const checkN = Math.max(minLoss, maxWin);
      const recentBets = await db
        .select({ won: betsTable.won })
        .from(betsTable)
        .where(and(eq(betsTable.playerId, playerId), eq(betsTable.gameId, game.id)))
        .orderBy(desc(betsTable.createdAt))
        .limit(checkN);

      if (minLoss > 0 && won) {
        const lossCount = recentBets.filter(b => !b.won).length;
        if (lossCount < minLoss) { won = false; payout = 0; rigOverrode = true; }
      }
      if (maxWin > 0) {
        const topN = recentBets.slice(0, maxWin);
        if (topN.length >= maxWin && topN.every(b => b.won)) { won = false; payout = 0; rigOverrode = true; }
      }
    }

    // 3. Global force outcome (overrides streaks)
    if (config.forceOutcome === "lose") {
      won = false; payout = 0; rigOverrode = true;
    } else if (config.forceOutcome === "win") {
      won = true; payout = Math.floor(wager * winMultFor(Number(config.forceWinMult))); rigOverrode = true;
    }

    // 4. Global per-player rig (overrides game-level force, lower priority than per-player game override)
    type GlobalRig = {
      forceOutcome?: string | null;
      winRatio?: number | null;
      payoutMult?: number | null;
      applyAfterBalance?: number | null;
      message?: string | null;
    };
    const gRig = (player as any).globalRig as GlobalRig | null | undefined;
    if (gRig) {
      // Check balance threshold: skip global rig until the player has accumulated enough coins
      let globalRigActive = true;
      if (gRig.applyAfterBalance != null && gRig.applyAfterBalance > 0) {
        if (player.balance < gRig.applyAfterBalance) {
          globalRigActive = false;
        }
      }

      if (globalRigActive) {
        // forceOutcome takes absolute priority
        if (gRig.forceOutcome === "lose") {
          won = false; payout = 0; rigOverrode = true;
          if (gRig.message) riggedMessage = gRig.message;
        } else if (gRig.forceOutcome === "win") {
          won = true; payout = Math.floor(wager * winMultFor(gRig.payoutMult)); rigOverrode = true;
          if (gRig.message) riggedMessage = gRig.message;
        } else if (gRig.winRatio != null) {
          // Keep the player's actual win rate within 2% of the chosen ratio across
          // ALL games. Decide THIS bet's outcome by looking at the resulting rate
          // after the bet, so the running rate stays inside the band whenever possible.
          const targetRate = gRig.winRatio / 100;
          const [totalRow] = await db
            .select({ total: count() })
            .from(betsTable)
            .where(eq(betsTable.playerId, playerId));
          const [winRow] = await db
            .select({ total: count() })
            .from(betsTable)
            .where(and(eq(betsTable.playerId, playerId), eq(betsTable.won, true)));
          const totalBets = Number(totalRow?.total ?? 0);
          const winBets = Number(winRow?.total ?? 0);
          const TOL = 0.02;
          const denom = totalBets + 1;
          const rateIfWin = (winBets + 1) / denom;
          const rateIfLose = winBets / denom;
          const winInBand = Math.abs(rateIfWin - targetRate) <= TOL;
          const loseInBand = Math.abs(rateIfLose - targetRate) <= TOL;
          let shouldWin: boolean;
          if (winInBand && loseInBand) {
            shouldWin = secureRandom() < targetRate; // both keep us in band → random within band
          } else if (winInBand) {
            shouldWin = true;
          } else if (loseInBand) {
            shouldWin = false;
          } else {
            // Neither stays in band (only at very low bet counts) → pick closest to target
            shouldWin =
              Math.abs(rateIfWin - targetRate) <= Math.abs(rateIfLose - targetRate);
          }
          won = shouldWin;
          payout = won ? Math.floor(wager * winMultFor(gRig.payoutMult)) : 0;
          rigOverrode = true;
          if (gRig.message) riggedMessage = gRig.message;
        }
      }
    }

    // 5. Per-player game-level overrides (highest priority)
    const pOvr = config.playerOverrides?.[String(playerId)];
    if (pOvr) {
      if (pOvr.outcome === "lose") { won = false; payout = 0; rigOverrode = true; }
      else if (pOvr.outcome === "win") {
        won = true; payout = Math.floor(wager * winMultFor(Number(pOvr.mult))); rigOverrode = true;
      }
    }

    // 6. Max payout cap
    const maxPay = Number(config.maxPayout) || 0;
    if (maxPay > 0 && payout > maxPay) payout = maxPay;

    // 6b. Reconcile visuals to the forced outcome. The game logic above built
    // reels/details for its NATURAL result, which may contradict the rigged
    // win/loss. Regenerate them so the animation the player sees matches the
    // reported result (a rigged loss must never show a winning animation).
    // match_bet/trivia always render "PLACED" (resolved later by a mod), so they
    // have no win/loss animation to contradict.
    if (rigOverrode && game.type !== "match_bet" && game.type !== "trivia") {
      const rec = reconcileForRig({
        type: game.type, won, payout, wager, config, options, selectedOpt, pick,
      });
      reels = rec.reels;
      details = rec.details;
      message = rec.message;
    }

    // 7. Custom messages override the text (visuals already match the outcome).
    if (won && config.winMessage) {
      message = String(config.winMessage).replace("{payout}", String(payout)).replace("{wager}", String(wager));
    } else if (!won && config.loseMessage) {
      message = String(config.loseMessage).replace("{payout}", String(payout)).replace("{wager}", String(wager));
    } else if (riggedMessage) {
      message = riggedMessage;
    }
  }

  const newBalance = player.balance - wager + payout;
  await db
    .update(playersTable)
    .set({ balance: newBalance })
    .where(eq(playersTable.id, playerId));

  const [bet] = await db
    .insert(betsTable)
    .values({ playerId, gameId: game.id, wager, payout, won, optionId: optionId ?? null, pick: pick ?? null, details })
    .returning();

  res.json({ won, payout, newBalance, reels, message, betId: bet.id, details });
});

export default router;
