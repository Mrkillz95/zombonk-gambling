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

  res.json({ won, payout, newBalance, reels, message, betId: bet.id });
});

export default router;
