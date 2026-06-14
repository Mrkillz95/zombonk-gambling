import { Router, type IRouter } from "express";
import { eq, count, sum, desc } from "drizzle-orm";
import { db, playersTable, gamesTable, gameOptionsTable, betsTable } from "@workspace/db";
import {
  ModAuthBody,
  ModCreateGameBody,
  ModUpdateGameParams,
  ModUpdateGameBody,
  ModDeleteGameParams,
  ModResolveGameParams,
  ModResolveGameBody,
  ModUpdatePlayerBalanceParams,
  ModUpdatePlayerBalanceBody,
} from "@workspace/api-zod";

const MOD_PASSWORD = process.env.MOD_PASSWORD || "zombonk123";

function checkAuth(req: any, res: any): boolean {
  const password = req.headers["x-mod-password"];
  if (!password || password !== MOD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

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

const router: IRouter = Router();

router.post("/mod/auth", async (req, res): Promise<void> => {
  const parsed = ModAuthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.password === MOD_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

router.get("/mod/games", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const games = await db
    .select()
    .from(gamesTable)
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

router.post("/mod/games", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const parsed = ModCreateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { title, type, config, options } = parsed.data;

  const [game] = await db
    .insert(gamesTable)
    .values({ title, type, config: config ?? {}, status: "open" })
    .returning();

  if (options && options.length > 0) {
    await db.insert(gameOptionsTable).values(
      options.map((o: any) => ({
        gameId: game.id,
        label: o.label,
        odds: String(o.odds),
        emoji: o.emoji ?? null,
        weight: o.weight ?? 1,
        imageUrl: o.imageUrl ?? null,
        displayOdds: o.displayOdds ?? null,
        trueWinPct: o.trueWinPct ?? null,
      }))
    );
  }

  const savedOptions = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, game.id));

  res.status(201).json(formatGame(game, savedOptions));
});

router.patch("/mod/games/:id", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ModUpdateGameParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ModUpdateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { title, status, config, options } = parsed.data;

  const updateData: any = {};
  if (title !== undefined) updateData.title = title;
  if (status !== undefined) updateData.status = status;
  if (config !== undefined) updateData.config = config;

  const [game] = await db
    .update(gamesTable)
    .set(updateData)
    .where(eq(gamesTable.id, params.data.id))
    .returning();

  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  // Replace options if provided
  if (options !== undefined) {
    await db
      .delete(gameOptionsTable)
      .where(eq(gameOptionsTable.gameId, game.id));
    if (options.length > 0) {
      await db.insert(gameOptionsTable).values(
        options.map((o: any) => ({
          gameId: game.id,
          label: o.label,
          odds: String(o.odds),
          emoji: o.emoji ?? null,
          weight: o.weight ?? 1,
          imageUrl: o.imageUrl ?? null,
          displayOdds: o.displayOdds ?? null,
          trueWinPct: o.trueWinPct ?? null,
        }))
      );
    }
  }

  const savedOptions = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, game.id));

  res.json(formatGame(game, savedOptions));
});

router.delete("/mod/games/:id", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  await db.delete(betsTable).where(eq(betsTable.gameId, id));
  await db.delete(gameOptionsTable).where(eq(gameOptionsTable.gameId, id));
  await db.delete(gamesTable).where(eq(gamesTable.id, id));

  res.sendStatus(204);
});

router.post("/mod/games/:id/resolve", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ModResolveGameParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ModResolveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { winningOptionId } = parsed.data;

  // Mark winning option
  await db
    .update(gameOptionsTable)
    .set({ isWinner: true })
    .where(eq(gameOptionsTable.id, winningOptionId));

  // Payout all bets on this option
  const winningOption = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.id, winningOptionId))
    .limit(1);

  if (winningOption[0]) {
    const odds = parseFloat(winningOption[0].odds);
    const pendingBets = await db
      .select()
      .from(betsTable)
      .where(
        eq(betsTable.gameId, params.data.id)
      );

    for (const bet of pendingBets) {
      if (bet.optionId === winningOptionId && !bet.won) {
        const payout = Math.floor(bet.wager * odds);
        await db
          .update(betsTable)
          .set({ won: true, payout })
          .where(eq(betsTable.id, bet.id));
          // Add payout to balance
        const [p] = await db.select().from(playersTable).where(eq(playersTable.id, bet.playerId));
        if (p) {
          await db
            .update(playersTable)
            .set({ balance: p.balance + payout })
            .where(eq(playersTable.id, p.id));
        }
      }
    }
  }

  // Mark game resolved
  const [game] = await db
    .update(gamesTable)
    .set({ status: "resolved", resolvedOptionId: winningOptionId })
    .where(eq(gamesTable.id, params.data.id))
    .returning();

  const options = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, params.data.id));

  res.json(formatGame(game, options));
});

router.get("/mod/players", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const players = await db
    .select()
    .from(playersTable)
    .orderBy(desc(playersTable.balance));

  res.json(
    players.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))
  );
});

router.patch("/mod/players/:id/balance", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ModUpdatePlayerBalanceParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ModUpdatePlayerBalanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [player] = await db
    .update(playersTable)
    .set({ balance: parsed.data.balance })
    .where(eq(playersTable.id, params.data.id))
    .returning();

  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json({ ...player, createdAt: player.createdAt.toISOString() });
});

router.get("/mod/stats", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const [playerCount] = await db.select({ count: count() }).from(playersTable);
  const [gameCount] = await db.select({ count: count() }).from(gamesTable);
  const [openGameCount] = await db
    .select({ count: count() })
    .from(gamesTable)
    .where(eq(gamesTable.status, "open"));
  const [betStats] = await db
    .select({ count: count(), total: sum(betsTable.wager) })
    .from(betsTable);

  res.json({
    totalPlayers: playerCount.count,
    totalGames: gameCount.count,
    openGames: openGameCount.count,
    totalBets: betStats.count,
    totalWagered: parseInt(betStats.total ?? "0", 10),
  });
});

export default router;
