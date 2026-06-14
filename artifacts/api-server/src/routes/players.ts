import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, playersTable, betsTable, gamesTable } from "@workspace/db";
import z from "zod/v4";
import {
  GetPlayerParams,
  GetPlayerBetsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getClientIp(req: { headers: Record<string, unknown>; ip?: string }): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? null;
}

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

  const ip = getClientIp(req);

  const existing = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.name, name))
    .limit(1);

  if (existing[0]) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  if (ip) {
    const ipExisting = await db
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(eq(playersTable.ipAddress, ip))
      .limit(1);
    if (ipExisting[0]) {
      res.status(403).json({
        error: "Unable to create an account right now. If you already have one, please log in.",
      });
      return;
    }
  }

  const [player] = await db
    .insert(playersTable)
    .values({ name, discordUser: discordUser ?? null, password, ipAddress: ip })
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

  const ip = getClientIp(req);
  if (ip && player.ipAddress !== ip) {
    await db
      .update(playersTable)
      .set({ ipAddress: ip })
      .where(eq(playersTable.id, player.id));
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
