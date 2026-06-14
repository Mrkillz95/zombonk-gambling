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

  // Check game
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, idParam.data.id));

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  if (game.status !== "open") {
    res.status(400).json({ error: "Game is not open for betting" });
    return;
  }

  // Check player
  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.id, playerId));

  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  if (player.balance < wager) {
    res.status(400).json({ error: "Insufficient balance" });
    return;
  }
  if (wager <= 0) {
    res.status(400).json({ error: "Wager must be positive" });
    return;
  }

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

  if (game.type === "slots") {
    // Slot machine logic — weighted random selection per reel
    const items: { label: string; emoji: string; weight: number; payout: number }[] =
      config.items || [
        { label: "Cherry", emoji: "🍒", weight: 5, payout: 2 },
        { label: "Bar", emoji: "🍊", weight: 4, payout: 3 },
        { label: "Seven", emoji: "7️⃣", weight: 2, payout: 5 },
        { label: "Skull", emoji: "💀", weight: 1, payout: 10 },
      ];

    const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);

    function spinReel() {
      let r = Math.random() * totalWeight;
      for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item;
      }
      return items[0];
    }

    const reelCount = config.reelCount || 3;
    const spun = Array.from({ length: reelCount }, () => spinReel());
    reels = spun.map((s) => s.label);
    details = { reels: spun.map((s) => ({ label: s.label, emoji: s.emoji })) };

    // Win if all reels match
    if (spun.every((s) => s.label === spun[0].label)) {
      won = true;
      payout = wager * spun[0].payout;
      message = `Jackpot! All ${spun[0].label}s! You won ${payout} coins!`;
    } else {
      message = `No match. Better luck next time!`;
    }
  } else if (game.type === "coin_flip") {
    // Player picks heads or tails via optionId
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) {
      res.status(400).json({ error: "Must pick heads or tails" });
      return;
    }
    const flip = Math.random() < 0.5 ? options[0] : options[1];
    reels = [flip.label];
    details = { result: flip.label, picked: selectedOption.label };
    won = flip.id === selectedOption.id;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `${flip.label}! You won ${payout} coins!`;
    } else {
      message = `${flip.label}! You picked ${selectedOption.label}. Better luck next time!`;
    }
  } else if (game.type === "match_bet") {
    // Player picks an option, payout happens when mod resolves
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) {
      res.status(400).json({ error: "Must pick an option" });
      return;
    }
    reels = [selectedOption.label];
    details = { picked: selectedOption.label, optionId: selectedOption.id };
    // Won/payout determined at resolution — store as pending
    won = false;
    payout = 0;
    message = `Bet placed on "${selectedOption.label}" for ${wager} coins. Waiting for resolution.`;
  } else if (game.type === "number_pick") {
    const min = config.min || 1;
    const max = config.max || 10;
    const picked = parseInt(pick || "0", 10);
    if (isNaN(picked) || picked < min || picked > max) {
      res.status(400).json({ error: `Pick a number between ${min} and ${max}` });
      return;
    }
    const drawn = Math.floor(Math.random() * (max - min + 1)) + min;
    reels = [String(drawn)];
    details = { picked, drawn, min, max };
    won = picked === drawn;
    const oddsVal = options[0] ? parseFloat(options[0].odds) : config.odds || 5;
    if (won) {
      payout = Math.floor(wager * oddsVal);
      message = `Drew ${drawn}! You picked ${picked} — correct! Won ${payout} coins!`;
    } else {
      message = `Drew ${drawn}. You picked ${picked}. No win.`;
    }
  } else if (game.type === "mystery_box") {
    const selectedOption = options.find((o) => o.id === optionId);
    if (!selectedOption) {
      res.status(400).json({ error: "Must pick a box" });
      return;
    }
    reels = [selectedOption.label];
    details = { box: selectedOption.label, emoji: selectedOption.emoji };

    // Win chance based on odds vs total weight
    const totalWeight = options.reduce((s, o) => s + (o.weight || 1), 0);
    const roll = Math.random() * totalWeight;
    let cumulative = 0;
    let winOption = options[0];
    for (const opt of options) {
      cumulative += opt.weight || 1;
      if (roll <= cumulative) {
        winOption = opt;
        break;
      }
    }
    won = selectedOption.id === winOption.id;
    if (won) {
      payout = Math.floor(wager * parseFloat(selectedOption.odds));
      message = `You opened box "${selectedOption.label}" and found a prize! Won ${payout} coins!`;
    } else {
      message = `Box "${selectedOption.label}" had nothing special. Better luck next time!`;
    }
  }

  // Deduct wager, add payout
  const newBalance = player.balance - wager + payout;
  await db
    .update(playersTable)
    .set({ balance: newBalance })
    .where(eq(playersTable.id, playerId));

  // Record the bet
  const [bet] = await db
    .insert(betsTable)
    .values({
      playerId,
      gameId: game.id,
      wager,
      payout,
      won,
      optionId: optionId ?? null,
      pick: pick ?? null,
      details,
    })
    .returning();

  res.json({
    won,
    payout,
    newBalance,
    reels,
    message,
    betId: bet.id,
  });
});

export default router;
