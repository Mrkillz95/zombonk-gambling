import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, playersTable, betsTable, gamesTable } from "@workspace/db";
import z from "zod/v4";
import {
  GetPlayerParams,
  GetPlayerBetsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const RegisterBody = z.object({
  name: z.string().min(1).max(32),
  discordUser: z.string().optional(),
  password: z.string().min(1),
});

const LoginBody = z.object({
  name: z.string().min(1),
  password: z.string().min(1),
});

// ── Register ────────────────────────────────────────────────────────────────
router.post("/players", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, discordUser, password } = parsed.data;

  const existing = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.name, name))
    .limit(1);

  if (existing[0]) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const [player] = await db
    .insert(playersTable)
    .values({ name, discordUser: discordUser ?? null, password })
    .returning();

  res.json({
    id: player.id,
    name: player.name,
    discordUser: player.discordUser,
    balance: player.balance,
    createdAt: player.createdAt.toISOString(),
  });
});

// ── Login ───────────────────────────────────────────────────────────────────
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, password } = parsed.data;

  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.name, name))
    .limit(1);

  if (!player) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  if (player.password !== password) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  res.json({
    id: player.id,
    name: player.name,
    discordUser: player.discordUser,
    balance: player.balance,
    createdAt: player.createdAt.toISOString(),
  });
});

// ── Get player ──────────────────────────────────────────────────────────────
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

  res.json({
    id: player.id,
    name: player.name,
    discordUser: player.discordUser,
    balance: player.balance,
    createdAt: player.createdAt.toISOString(),
  });
});

// ── Get player bets ─────────────────────────────────────────────────────────
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
