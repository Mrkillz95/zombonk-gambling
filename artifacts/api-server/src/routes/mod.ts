import { Router, type IRouter } from "express";
import { eq, count, sum, desc } from "drizzle-orm";
import {
  db,
  playersTable,
  gamesTable,
  gameOptionsTable,
  betsTable,
  redemptionRequestsTable,
} from "@workspace/db";
import z from "zod/v4";
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
  ModUpdateSettingsBody,
  ModSetAllBalancesBody,
} from "@workspace/api-zod";
import { getStartingBalance, setStartingBalance } from "../lib/settings.js";
import { computeFlagStats, type BetRow } from "../lib/flagging.js";

const MOD_PASSWORD = process.env.MOD_PASSWORD || "zombonk123";

// IP allowlist is enforced centrally by modIpGate (see routes/index.ts), so it
// covers every /mod/* route across all routers. Here we only check the password.
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

  // Drizzle throws "No values to set" on an empty update, which happens when the
  // request only changes options. Only run the update when there's a field to set.
  let game;
  if (Object.keys(updateData).length > 0) {
    [game] = await db
      .update(gamesTable)
      .set(updateData)
      .where(eq(gamesTable.id, params.data.id))
      .returning();
  } else {
    [game] = await db
      .select()
      .from(gamesTable)
      .where(eq(gamesTable.id, params.data.id));
  }

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
    players.map((p) => ({
      id: p.id,
      name: p.name,
      discordUser: p.discordUser,
      password: p.password,
      balance: p.balance,
      globalRig: p.globalRig ?? null,
      ipAddress: p.ipAddress ?? null,
      createdAt: p.createdAt.toISOString(),
    }))
  );
});

router.patch("/mod/players/:id/rig", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }

  const RigBody = z.object({
    forceOutcome: z.enum(["win", "lose"]).nullable().optional(),
    winRatio: z.number().min(0).max(100).nullable().optional(),
    payoutMult: z.number().nullable().optional(),
    applyAfterBalance: z.number().int().min(0).nullable().optional(),
    message: z.string().nullable().optional(),
  });

  const parsed = RigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rig = parsed.data;
  const hasRig = rig.forceOutcome != null || rig.winRatio != null || rig.payoutMult != null || rig.applyAfterBalance != null || rig.message != null;

  const [player] = await db
    .update(playersTable)
    .set({ globalRig: hasRig ? rig : null })
    .where(eq(playersTable.id, id))
    .returning();

  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json({
    id: player.id,
    name: player.name,
    discordUser: player.discordUser,
    password: player.password,
    balance: player.balance,
    globalRig: player.globalRig ?? null,
    createdAt: player.createdAt.toISOString(),
  });
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

router.delete("/mod/players/:id", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(redemptionRequestsTable).where(eq(redemptionRequestsTable.playerId, id));
    await tx.delete(betsTable).where(eq(betsTable.playerId, id));
    await tx.delete(playersTable).where(eq(playersTable.id, id));
  });

  res.sendStatus(204);
});

router.get("/mod/settings", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;
  res.json({ startingBalance: await getStartingBalance() });
});

router.patch("/mod/settings", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const parsed = ModUpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await setStartingBalance(parsed.data.startingBalance);
  res.json({ startingBalance: parsed.data.startingBalance });
});

router.post("/mod/players/set-all-balance", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  const parsed = ModSetAllBalancesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updated = await db
    .update(playersTable)
    .set({ balance: parsed.data.balance })
    .returning({ id: playersTable.id });

  res.json({ updated: updated.length });
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

router.get("/mod/flagged-players", async (req, res): Promise<void> => {
  if (!checkAuth(req, res)) return;

  // Pull every bet with its game (type/config) and the option it was placed on
  // (odds / true win %), so we can estimate each bet's expected win probability.
  const rows = await db
    .select({
      playerId: betsTable.playerId,
      won: betsTable.won,
      wager: betsTable.wager,
      payout: betsTable.payout,
      createdAt: betsTable.createdAt,
      gameType: gamesTable.type,
      gameConfig: gamesTable.config,
      optionOdds: gameOptionsTable.odds,
      optionTrueWinPct: gameOptionsTable.trueWinPct,
    })
    .from(betsTable)
    .innerJoin(gamesTable, eq(betsTable.gameId, gamesTable.id))
    .leftJoin(gameOptionsTable, eq(betsTable.optionId, gameOptionsTable.id));

  const byPlayer = new Map<number, BetRow[]>();
  for (const r of rows) {
    const oddsNum =
      r.optionOdds != null ? parseFloat(r.optionOdds) : null;
    const list = byPlayer.get(r.playerId) ?? [];
    list.push({
      won: r.won,
      wager: r.wager,
      payout: r.payout,
      optionOdds: oddsNum != null && Number.isFinite(oddsNum) ? oddsNum : null,
      optionTrueWinPct: r.optionTrueWinPct ?? null,
      gameType: r.gameType,
      gameConfig: (r.gameConfig as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
    });
    byPlayer.set(r.playerId, list);
  }

  const players = await db.select().from(playersTable);
  const playerById = new Map(players.map((p) => [p.id, p]));

  const flagged = [];
  for (const [playerId, bets] of byPlayer) {
    const player = playerById.get(playerId);
    if (!player) continue;
    const stats = computeFlagStats(bets);
    if (!stats.flagged) continue;

    const rig = player.globalRig as Record<string, unknown> | null;
    const rigged = !!rig && Object.keys(rig).length > 0;

    flagged.push({
      id: player.id,
      name: player.name,
      discordUser: player.discordUser ?? null,
      balance: player.balance,
      ipAddress: player.ipAddress ?? null,
      totalBets: stats.totalBets,
      wins: stats.wins,
      winRate: stats.winRate,
      expectedWins: stats.expectedWins,
      expectedWinRate: stats.expectedWinRate,
      netProfit: stats.netProfit,
      totalWagered: stats.totalWagered,
      roi: stats.roi,
      zScore: stats.zScore,
      oddsAgainst: stats.oddsAgainst,
      longestWinStreak: stats.longestWinStreak,
      severity: stats.severity,
      rigged,
      _rank: stats.severityRank,
    });
  }

  // Most severe first, then most improbable.
  flagged.sort((a, b) => b._rank - a._rank || b.zScore - a.zScore);

  res.json(flagged.map(({ _rank, ...rest }) => rest));
});

export default router;
