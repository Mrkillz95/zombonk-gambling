import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, playersTable, gamesTable, gameOptionsTable, betsTable } from "@workspace/db";
import {
  ListGamesQueryParams,
  GetGameParams,
  PlayGameParams,
  PlayGameBody,
} from "@workspace/api-zod";

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
  const v = Math.floor(Math.random() * 13);
  return { face: CARD_FACES[v]!, suit: CARD_SUITS[Math.floor(Math.random() * 4)]!, value: v + 1 };
}

function makeDeck(): { face: string; suit: string; value: number }[] {
  const deck: { face: string; suit: string; value: number }[] = [];
  for (let s = 0; s < 4; s++)
    for (let f = 0; f < 13; f++)
      deck.push({ face: CARD_FACES[f]!, suit: CARD_SUITS[s]!, value: f + 1 });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= items[i].weight || 1;
    if (r <= 0) return i;
  }
  return items.length - 1;
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
    const flip = options[Math.floor(Math.random() * options.length)];
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
    const drawn = Math.floor(Math.random() * (max - min + 1)) + min;
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
    const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * sides) + 1);
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
    const drawnOption = options[Math.floor(Math.random() * options.length)];
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
    const drawn = Math.floor(Math.random() * 100) + 1;
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
    const shown = config.shown || Math.floor(Math.random() * 90) + 5;
    const drawn = Math.floor(Math.random() * 100) + 1;
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
    const drawn = Math.floor(Math.random() * tickets) + 1;
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
    const path: string[] = Array.from({ length: rows }, () => Math.random() < 0.5 ? "R" : "L");
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
    const crashPoint = parseFloat(Math.max(1.0, 0.99 / Math.random()).toFixed(2));
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
    while (playerNums.size < spots) playerNums.add(Math.floor(Math.random() * pool) + 1);
    const drawnNums = new Set<number>();
    while (drawnNums.size < drawCount) drawnNums.add(Math.floor(Math.random() * pool) + 1);
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
    const isSafe = Math.random() < (gridSize - mineCount) / gridSize;
    const mineMult = parseFloat(Math.max(1.05, (gridSize / (gridSize - mineCount)) * 0.95).toFixed(2));
    const minePositions = new Set<number>();
    while (minePositions.size < mineCount) minePositions.add(Math.floor(Math.random() * gridSize));
    const safeTiles = Array.from({length:gridSize},(_,i)=>i).filter(i=>!minePositions.has(i));
    const mineTiles = [...minePositions];
    const tileIndex = isSafe
      ? safeTiles[Math.floor(Math.random() * safeTiles.length)]!
      : mineTiles[Math.floor(Math.random() * mineTiles.length)]!;
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
