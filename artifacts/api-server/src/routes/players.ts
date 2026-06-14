import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, playersTable, betsTable, gamesTable } from "@workspace/db";
import {
  GetOrCreatePlayerBody,
  GetPlayerParams,
  GetPlayerBetsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/players", async (req, res): Promise<void> => {
  const parsed = GetOrCreatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.name, parsed.data.name))
    .limit(1);

  if (existing[0]) {
    res.json({
      ...existing[0],
      createdAt: existing[0].createdAt.toISOString(),
    });
    return;
  }

  const [player] = await db
    .insert(playersTable)
    .values({ name: parsed.data.name })
    .returning();

  res.json({ ...player, createdAt: player.createdAt.toISOString() });
});

router.get("/players/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetPlayerParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.id, params.data.id));

  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json({ ...player, createdAt: player.createdAt.toISOString() });
});

router.get("/players/:id/bets", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetPlayerBetsParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bets = await db
    .select({
      id: betsTable.id,
      playerId: betsTable.playerId,
      gameId: betsTable.gameId,
      gameTitle: gamesTable.title,
      gameType: gamesTable.type,
      wager: betsTable.wager,
      payout: betsTable.payout,
      won: betsTable.won,
      details: betsTable.details,
      createdAt: betsTable.createdAt,
    })
    .from(betsTable)
    .leftJoin(gamesTable, eq(betsTable.gameId, gamesTable.id))
    .where(eq(betsTable.playerId, params.data.id))
    .orderBy(desc(betsTable.createdAt))
    .limit(50);

  res.json(
    bets.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    }))
  );
});

export default router;
