import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  playersTable,
  gamesTable,
  gameOptionsTable,
  betsTable,
  lobbiesTable,
  lobbyMembersTable,
  lobbyMessagesTable,
  lobbyTransfersTable,
  lobbyRoundsTable,
  lobbyRoundBetsTable,
} from "@workspace/db";
import {
  CreateLobbyBody,
  JoinLobbyBody,
  GetActiveLobbyQueryParams,
  GetLobbyParams,
  LeaveLobbyParams,
  LeaveLobbyBody,
  SendLobbyChatParams,
  SendLobbyChatBody,
  TransferCoinsParams,
  TransferCoinsBody,
  StartLobbyRoundParams,
  StartLobbyRoundBody,
  PlaceRoundBetParams,
  PlaceRoundBetBody,
} from "@workspace/api-zod";
import { secureRandom } from "../lib/rng.js";
import { resolveRound, type RoundBetInput } from "../lib/live-rounds.js";
import { broadcastToLobby, getOnlinePlayerIds } from "../lib/realtime.js";

const router: IRouter = Router();

const BETTING_WINDOW_MS = 30_000;

// Game types resolvable as a shared live round without per-option choices.
const LIVE_DEDICATED_TYPES = new Set(["crash", "blackjack"]);

/**
 * A game can host a synchronized live round only if it produces a single shared
 * outcome everyone can bet against: either a dedicated resolver (crash, the
 * shared blackjack table) or an option-weighted game with at least one option.
 * Games like slots/plinko/dice have no shared option to bet on, so the shared
 * resolver would yield no winner — we reject them up front.
 */
function isLiveRoundSupported(gameType: string, optionCount: number): boolean {
  return LIVE_DEDICATED_TYPES.has(gameType) || optionCount > 0;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode(len = 5): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(secureRandom() * CODE_CHARS.length)];
  }
  return out;
}

function intParam(v: unknown): number {
  const raw = Array.isArray(v) ? v[0] : v;
  return parseInt(String(raw), 10);
}

// ── State assembly ───────────────────────────────────────────────────────────

async function buildLobbyState(lobbyId: number) {
  const [lobby] = await db
    .select()
    .from(lobbiesTable)
    .where(eq(lobbiesTable.id, lobbyId));
  if (!lobby) return null;

  const online = new Set(getOnlinePlayerIds(lobbyId));

  const memberRows = await db
    .select({
      playerId: lobbyMembersTable.playerId,
      joinedAt: lobbyMembersTable.joinedAt,
      name: playersTable.name,
      balance: playersTable.balance,
    })
    .from(lobbyMembersTable)
    .innerJoin(playersTable, eq(lobbyMembersTable.playerId, playersTable.id))
    .where(eq(lobbyMembersTable.lobbyId, lobbyId))
    .orderBy(lobbyMembersTable.joinedAt);

  const members = memberRows.map((m) => ({
    playerId: m.playerId,
    name: m.name,
    balance: m.balance,
    isHost: m.playerId === lobby.hostId,
    online: online.has(m.playerId),
    joinedAt: m.joinedAt.toISOString(),
  }));

  const messageRows = await db
    .select({
      id: lobbyMessagesTable.id,
      playerId: lobbyMessagesTable.playerId,
      body: lobbyMessagesTable.body,
      createdAt: lobbyMessagesTable.createdAt,
      playerName: playersTable.name,
    })
    .from(lobbyMessagesTable)
    .innerJoin(playersTable, eq(lobbyMessagesTable.playerId, playersTable.id))
    .where(eq(lobbyMessagesTable.lobbyId, lobbyId))
    .orderBy(desc(lobbyMessagesTable.createdAt))
    .limit(50);

  const messages = messageRows
    .reverse()
    .map((m) => ({
      id: m.id,
      playerId: m.playerId,
      playerName: m.playerName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));

  const transfers = await loadTransfers(lobbyId);
  const currentRound = await loadCurrentRound(lobbyId);

  return {
    lobby: {
      id: lobby.id,
      code: lobby.code,
      name: lobby.name,
      hostId: lobby.hostId,
      status: lobby.status,
      createdAt: lobby.createdAt.toISOString(),
    },
    members,
    messages,
    transfers,
    currentRound,
  };
}

async function loadTransfers(lobbyId: number) {
  const rows = await db
    .select()
    .from(lobbyTransfersTable)
    .where(eq(lobbyTransfersTable.lobbyId, lobbyId))
    .orderBy(desc(lobbyTransfersTable.createdAt))
    .limit(30);

  if (rows.length === 0) return [];
  const ids = [
    ...new Set(rows.flatMap((r) => [r.fromPlayerId, r.toPlayerId])),
  ];
  const names = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(inArray(playersTable.id, ids));
  const nameMap = new Map(names.map((n) => [n.id, n.name]));

  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      fromPlayerId: r.fromPlayerId,
      fromName: nameMap.get(r.fromPlayerId) ?? "?",
      toPlayerId: r.toPlayerId,
      toName: nameMap.get(r.toPlayerId) ?? "?",
      amount: r.amount,
      createdAt: r.createdAt.toISOString(),
    }));
}

async function loadCurrentRound(lobbyId: number) {
  const [round] = await db
    .select()
    .from(lobbyRoundsTable)
    .where(eq(lobbyRoundsTable.lobbyId, lobbyId))
    .orderBy(desc(lobbyRoundsTable.createdAt))
    .limit(1);
  if (!round) return null;

  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, round.gameId));
  const options = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, round.gameId));

  const betRows = await db
    .select({
      playerId: lobbyRoundBetsTable.playerId,
      optionId: lobbyRoundBetsTable.optionId,
      pick: lobbyRoundBetsTable.pick,
      wager: lobbyRoundBetsTable.wager,
      won: lobbyRoundBetsTable.won,
      payout: lobbyRoundBetsTable.payout,
      name: playersTable.name,
    })
    .from(lobbyRoundBetsTable)
    .innerJoin(playersTable, eq(lobbyRoundBetsTable.playerId, playersTable.id))
    .where(eq(lobbyRoundBetsTable.roundId, round.id));

  return {
    id: round.id,
    gameId: round.gameId,
    gameType: round.gameType,
    gameTitle: game?.title ?? "Game",
    status: round.status,
    bettingEndsAt: round.bettingEndsAt.toISOString(),
    result: (round.result as Record<string, unknown> | null) ?? null,
    createdAt: round.createdAt.toISOString(),
    resolvedAt: round.resolvedAt ? round.resolvedAt.toISOString() : null,
    options: options.map((o) => ({
      id: o.id,
      gameId: o.gameId,
      label: o.label,
      odds: Number(o.odds),
      emoji: o.emoji ?? null,
      weight: o.weight ?? null,
      isWinner: o.isWinner ?? null,
      imageUrl: o.imageUrl ?? null,
      displayOdds: o.displayOdds ?? null,
      trueWinPct: o.trueWinPct ?? null,
    })),
    config: (game?.config as Record<string, unknown>) ?? {},
    bets: betRows.map((b) => ({
      playerId: b.playerId,
      playerName: b.name,
      optionId: b.optionId,
      pick: b.pick,
      wager: b.wager,
      won: b.won,
      payout: b.payout,
    })),
  };
}

// ── Round resolution (shared outcome) ────────────────────────────────────────

const scheduled = new Set<number>();

function scheduleResolve(roundId: number, delayMs: number): void {
  if (scheduled.has(roundId)) return;
  scheduled.add(roundId);
  setTimeout(() => {
    scheduled.delete(roundId);
    void resolveRoundIfDue(roundId);
  }, Math.max(0, delayMs) + 100).unref?.();
}

/**
 * Resolve a betting round whose window has elapsed. Safe to call repeatedly and
 * concurrently: the conditional UPDATE to `resolved` acts as a claim, so only
 * the first caller applies payouts. Survives restarts because it is triggered
 * lazily whenever lobby state is read, not only by an in-memory timer.
 */
async function resolveRoundIfDue(roundId: number): Promise<void> {
  const [round] = await db
    .select()
    .from(lobbyRoundsTable)
    .where(eq(lobbyRoundsTable.id, roundId));
  if (!round || round.status !== "betting") return;
  if (round.bettingEndsAt.getTime() > Date.now()) return;

  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, round.gameId));
  const options = await db
    .select()
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, round.gameId));
  const placedBets = await db
    .select()
    .from(lobbyRoundBetsTable)
    .where(eq(lobbyRoundBetsTable.roundId, roundId));

  const betInputs: RoundBetInput[] = placedBets.map((b) => ({
    playerId: b.playerId,
    optionId: b.optionId,
    pick: b.pick,
    wager: b.wager,
  }));

  const resolution = resolveRound(
    round.gameType,
    (game?.config as Record<string, unknown>) ?? {},
    options.map((o) => ({
      id: o.id,
      label: o.label,
      odds: String(o.odds),
      weight: o.weight ?? null,
    })),
    betInputs,
  );

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(lobbyRoundsTable)
      .set({ status: "resolved", result: resolution.result, resolvedAt: new Date() })
      .where(and(eq(lobbyRoundsTable.id, roundId), eq(lobbyRoundsTable.status, "betting")))
      .returning();
    if (!claimed) return; // another caller already resolved it

    for (const r of resolution.bets) {
      // Wager was already deducted when the bet was placed; only credit payout.
      if (r.payout > 0) {
        const [pl] = await tx
          .select({ balance: playersTable.balance })
          .from(playersTable)
          .where(eq(playersTable.id, r.playerId));
        if (pl) {
          await tx
            .update(playersTable)
            .set({ balance: pl.balance + r.payout })
            .where(eq(playersTable.id, r.playerId));
        }
      }
      // Record into betsTable so too-lucky flagging sees live-round outcomes.
      const [bet] = await tx
        .insert(betsTable)
        .values({
          playerId: r.playerId,
          gameId: round.gameId,
          wager: r.wager,
          payout: r.payout,
          won: r.won,
          optionId: r.optionId,
          pick: r.pick,
          details: { liveRoundId: roundId, result: resolution.result },
        })
        .returning();
      await tx
        .update(lobbyRoundBetsTable)
        .set({ won: r.won, payout: r.payout, betId: bet?.id ?? null })
        .where(
          and(
            eq(lobbyRoundBetsTable.roundId, roundId),
            eq(lobbyRoundBetsTable.playerId, r.playerId),
          ),
        );
    }
  });

  broadcastToLobby(round.lobbyId, {
    type: "round_resolved",
    lobbyId: round.lobbyId,
    roundId,
  });
}

async function resolveDueRounds(lobbyId: number): Promise<void> {
  const due = await db
    .select({ id: lobbyRoundsTable.id })
    .from(lobbyRoundsTable)
    .where(and(eq(lobbyRoundsTable.lobbyId, lobbyId), eq(lobbyRoundsTable.status, "betting")));
  for (const r of due) {
    await resolveRoundIfDue(r.id);
  }
}

async function isMember(lobbyId: number, playerId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: lobbyMembersTable.id })
    .from(lobbyMembersTable)
    .where(and(eq(lobbyMembersTable.lobbyId, lobbyId), eq(lobbyMembersTable.playerId, playerId)));
  return !!row;
}

// Resolve the authenticated caller from their bearer session token.
async function resolveCaller(req: { headers: Record<string, unknown> }): Promise<number | null> {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string") return null;
  const token = /^Bearer\s+(.+)$/i.exec(auth.trim())?.[1]?.trim();
  if (!token) return null;
  const [player] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(eq(playersTable.sessionToken, token));
  return player?.id ?? null;
}

/**
 * Money- and identity-affecting actions accept the acting player's id in the
 * request, so a lobby member could otherwise spoof another member's id to spend
 * or move their balance, post chat as them, or remove them. Require the bearer
 * token to resolve to exactly that player. Returns false (and sends 403) on
 * mismatch so callers can `if (!(await requireCaller(...))) return;`.
 */
async function requireCaller(
  req: { headers: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  actorId: number,
): Promise<boolean> {
  const callerId = await resolveCaller(req);
  if (callerId === null || callerId !== actorId) {
    res.status(403).json({ error: "Not authorized to act as this player" });
    return false;
  }
  return true;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Create lobby
router.post("/lobbies", async (req, res): Promise<void> => {
  const body = CreateLobbyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { hostId, name } = body.data;

  const [host] = await db.select().from(playersTable).where(eq(playersTable.id, hostId));
  if (!host) {
    res.status(400).json({ error: "Host player not found" });
    return;
  }

  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [exists] = await db.select({ id: lobbiesTable.id }).from(lobbiesTable).where(eq(lobbiesTable.code, code));
    if (!exists) break;
    code = makeCode();
  }

  const [lobby] = await db
    .insert(lobbiesTable)
    .values({ code, name: name.trim() || "Zombonk Lobby", hostId, status: "open" })
    .returning();

  await db.insert(lobbyMembersTable).values({ lobbyId: lobby!.id, playerId: hostId });

  const state = await buildLobbyState(lobby!.id);
  res.json(state);
});

// Join lobby by code
router.post("/lobbies/join", async (req, res): Promise<void> => {
  const body = JoinLobbyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { playerId, code } = body.data;

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) {
    res.status(400).json({ error: "Player not found" });
    return;
  }

  const [lobby] = await db
    .select()
    .from(lobbiesTable)
    .where(and(eq(lobbiesTable.code, code.trim().toUpperCase()), eq(lobbiesTable.status, "open")));
  if (!lobby) {
    res.status(404).json({ error: "Lobby not found or closed" });
    return;
  }

  await db
    .insert(lobbyMembersTable)
    .values({ lobbyId: lobby.id, playerId })
    .onConflictDoNothing();
  await db
    .update(lobbyMembersTable)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(lobbyMembersTable.lobbyId, lobby.id), eq(lobbyMembersTable.playerId, playerId)));

  broadcastToLobby(lobby.id, {
    type: "member_joined",
    lobbyId: lobby.id,
    playerId,
    playerName: player.name,
  });

  const state = await buildLobbyState(lobby.id);
  res.json(state);
});

// Active lobby for a player
router.get("/lobbies/active", async (req, res): Promise<void> => {
  const parsed = GetActiveLobbyQueryParams.safeParse({ playerId: intParam(req.query.playerId) });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { playerId } = parsed.data;

  const [row] = await db
    .select({ lobbyId: lobbyMembersTable.lobbyId })
    .from(lobbyMembersTable)
    .innerJoin(lobbiesTable, eq(lobbyMembersTable.lobbyId, lobbiesTable.id))
    .where(and(eq(lobbyMembersTable.playerId, playerId), eq(lobbiesTable.status, "open")))
    .orderBy(desc(lobbyMembersTable.joinedAt))
    .limit(1);

  if (!row) {
    res.json(null);
    return;
  }

  await resolveDueRounds(row.lobbyId);
  const state = await buildLobbyState(row.lobbyId);
  res.json(state);
});

// Get full lobby state
router.get("/lobbies/:id", async (req, res): Promise<void> => {
  const parsed = GetLobbyParams.safeParse({ id: intParam(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await resolveDueRounds(parsed.data.id);
  const state = await buildLobbyState(parsed.data.id);
  if (!state) {
    res.status(404).json({ error: "Lobby not found" });
    return;
  }
  res.json(state);
});

// Leave lobby (host departure migrates or closes)
router.post("/lobbies/:id/leave", async (req, res): Promise<void> => {
  const params = LeaveLobbyParams.safeParse({ id: intParam(req.params.id) });
  const body = LeaveLobbyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const lobbyId = params.data.id;
  const { playerId } = body.data;

  if (!(await requireCaller(req, res, playerId))) return;

  const [lobby] = await db.select().from(lobbiesTable).where(eq(lobbiesTable.id, lobbyId));
  if (!lobby) {
    res.status(404).json({ error: "Lobby not found" });
    return;
  }

  await db
    .delete(lobbyMembersTable)
    .where(and(eq(lobbyMembersTable.lobbyId, lobbyId), eq(lobbyMembersTable.playerId, playerId)));

  if (lobby.hostId === playerId) {
    const [next] = await db
      .select({ playerId: lobbyMembersTable.playerId })
      .from(lobbyMembersTable)
      .where(eq(lobbyMembersTable.lobbyId, lobbyId))
      .orderBy(lobbyMembersTable.joinedAt)
      .limit(1);
    if (next) {
      await db.update(lobbiesTable).set({ hostId: next.playerId }).where(eq(lobbiesTable.id, lobbyId));
    } else {
      await db.update(lobbiesTable).set({ status: "closed" }).where(eq(lobbiesTable.id, lobbyId));
      broadcastToLobby(lobbyId, { type: "lobby_closed", lobbyId });
      res.json(null);
      return;
    }
  }

  broadcastToLobby(lobbyId, { type: "member_left", lobbyId, playerId });
  const state = await buildLobbyState(lobbyId);
  res.json(state);
});

// Send chat
router.post("/lobbies/:id/chat", async (req, res): Promise<void> => {
  const params = SendLobbyChatParams.safeParse({ id: intParam(req.params.id) });
  const body = SendLobbyChatBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const lobbyId = params.data.id;
  const { playerId, body: text } = body.data;

  if (!(await requireCaller(req, res, playerId))) return;
  const trimmed = text.trim();
  if (!trimmed) {
    res.status(400).json({ error: "Message cannot be empty" });
    return;
  }
  if (!(await isMember(lobbyId, playerId))) {
    res.status(400).json({ error: "Not a member of this lobby" });
    return;
  }

  const [msg] = await db
    .insert(lobbyMessagesTable)
    .values({ lobbyId, playerId, body: trimmed.slice(0, 500) })
    .returning();
  const [player] = await db.select({ name: playersTable.name }).from(playersTable).where(eq(playersTable.id, playerId));

  const view = {
    id: msg!.id,
    playerId,
    playerName: player?.name ?? "?",
    body: msg!.body,
    createdAt: msg!.createdAt.toISOString(),
  };
  broadcastToLobby(lobbyId, { type: "chat", lobbyId, message: view });
  res.json(view);
});

// Transfer coins between members
router.post("/lobbies/:id/transfer", async (req, res): Promise<void> => {
  const params = TransferCoinsParams.safeParse({ id: intParam(req.params.id) });
  const body = TransferCoinsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const lobbyId = params.data.id;
  const { fromPlayerId, toPlayerId, amount } = body.data;

  if (!(await requireCaller(req, res, fromPlayerId))) return;

  if (amount <= 0) {
    res.status(400).json({ error: "Amount must be positive" });
    return;
  }
  if (fromPlayerId === toPlayerId) {
    res.status(400).json({ error: "Cannot transfer to yourself" });
    return;
  }
  if (!(await isMember(lobbyId, fromPlayerId)) || !(await isMember(lobbyId, toPlayerId))) {
    res.status(400).json({ error: "Both players must be lobby members" });
    return;
  }

  let result: { fromBalance: number; toBalance: number; transferId: number } | null = null;
  try {
    result = await db.transaction(async (tx) => {
      const [from] = await tx.select().from(playersTable).where(eq(playersTable.id, fromPlayerId));
      const [to] = await tx.select().from(playersTable).where(eq(playersTable.id, toPlayerId));
      if (!from || !to) throw new Error("Player not found");
      if (from.balance < amount) throw new Error("Insufficient balance");

      const fromBalance = from.balance - amount;
      const toBalance = to.balance + amount;
      await tx.update(playersTable).set({ balance: fromBalance }).where(eq(playersTable.id, fromPlayerId));
      await tx.update(playersTable).set({ balance: toBalance }).where(eq(playersTable.id, toPlayerId));
      const [transfer] = await tx
        .insert(lobbyTransfersTable)
        .values({ lobbyId, fromPlayerId, toPlayerId, amount })
        .returning();
      return { fromBalance, toBalance, transferId: transfer!.id };
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Transfer failed" });
    return;
  }

  const [fromP] = await db.select({ name: playersTable.name }).from(playersTable).where(eq(playersTable.id, fromPlayerId));
  const [toP] = await db.select({ name: playersTable.name }).from(playersTable).where(eq(playersTable.id, toPlayerId));
  const transferView = {
    id: result.transferId,
    fromPlayerId,
    fromName: fromP?.name ?? "?",
    toPlayerId,
    toName: toP?.name ?? "?",
    amount,
    createdAt: new Date().toISOString(),
  };
  broadcastToLobby(lobbyId, { type: "transfer", lobbyId, transfer: transferView });
  res.json({ fromBalance: result.fromBalance, toBalance: result.toBalance, transfer: transferView });
});

// Start a synchronized live round
router.post("/lobbies/:id/rounds", async (req, res): Promise<void> => {
  const params = StartLobbyRoundParams.safeParse({ id: intParam(req.params.id) });
  const body = StartLobbyRoundBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const lobbyId = params.data.id;
  const { playerId, gameId } = body.data;

  if (!(await requireCaller(req, res, playerId))) return;
  if (!(await isMember(lobbyId, playerId))) {
    res.status(400).json({ error: "Not a member of this lobby" });
    return;
  }

  await resolveDueRounds(lobbyId);
  const [active] = await db
    .select({ id: lobbyRoundsTable.id })
    .from(lobbyRoundsTable)
    .where(and(eq(lobbyRoundsTable.lobbyId, lobbyId), eq(lobbyRoundsTable.status, "betting")))
    .limit(1);
  if (active) {
    res.status(400).json({ error: "A round is already in progress" });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId));
  if (!game) {
    res.status(400).json({ error: "Game not found" });
    return;
  }
  if (game.status !== "open") {
    res.status(400).json({ error: "Game is not available" });
    return;
  }

  const gameOptions = await db
    .select({ id: gameOptionsTable.id })
    .from(gameOptionsTable)
    .where(eq(gameOptionsTable.gameId, gameId));
  if (!isLiveRoundSupported(game.type, gameOptions.length)) {
    res.status(400).json({ error: "This game can't be played as a live party round" });
    return;
  }

  const bettingEndsAt = new Date(Date.now() + BETTING_WINDOW_MS);
  const [round] = await db
    .insert(lobbyRoundsTable)
    .values({ lobbyId, gameId, gameType: game.type, status: "betting", bettingEndsAt })
    .returning();

  scheduleResolve(round!.id, BETTING_WINDOW_MS);
  broadcastToLobby(lobbyId, { type: "round_started", lobbyId, roundId: round!.id });

  const state = await loadCurrentRound(lobbyId);
  res.json(state);
});

// Place a bet during the betting window
router.post("/lobbies/:id/rounds/:roundId/bet", async (req, res): Promise<void> => {
  const params = PlaceRoundBetParams.safeParse({
    id: intParam(req.params.id),
    roundId: intParam(req.params.roundId),
  });
  const body = PlaceRoundBetBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const lobbyId = params.data.id;
  const roundId = params.data.roundId;
  const { playerId, wager, optionId, pick } = body.data;

  if (!(await requireCaller(req, res, playerId))) return;
  if (wager <= 0) {
    res.status(400).json({ error: "Wager must be positive" });
    return;
  }
  if (!(await isMember(lobbyId, playerId))) {
    res.status(400).json({ error: "Not a member of this lobby" });
    return;
  }

  const [round] = await db.select().from(lobbyRoundsTable).where(eq(lobbyRoundsTable.id, roundId));
  if (!round || round.lobbyId !== lobbyId) {
    res.status(400).json({ error: "Round not found" });
    return;
  }
  if (round.status !== "betting" || round.bettingEndsAt.getTime() <= Date.now()) {
    res.status(400).json({ error: "Betting is closed for this round" });
    return;
  }

  const [existing] = await db
    .select({ id: lobbyRoundBetsTable.id })
    .from(lobbyRoundBetsTable)
    .where(and(eq(lobbyRoundBetsTable.roundId, roundId), eq(lobbyRoundBetsTable.playerId, playerId)));
  if (existing) {
    res.status(400).json({ error: "You already placed a bet this round" });
    return;
  }

  let view: {
    playerId: number;
    playerName: string;
    optionId: number | null;
    pick: string | null;
    wager: number;
    won: boolean;
    payout: number;
  } | null = null;
  try {
    view = await db.transaction(async (tx) => {
      const [player] = await tx.select().from(playersTable).where(eq(playersTable.id, playerId));
      if (!player) throw new Error("Player not found");
      if (player.balance < wager) throw new Error("Insufficient balance");

      await tx
        .update(playersTable)
        .set({ balance: player.balance - wager })
        .where(eq(playersTable.id, playerId));
      await tx.insert(lobbyRoundBetsTable).values({
        roundId,
        playerId,
        optionId: optionId ?? null,
        pick: pick ?? null,
        wager,
      });
      return {
        playerId,
        playerName: player.name,
        optionId: optionId ?? null,
        pick: pick ?? null,
        wager,
        won: false,
        payout: 0,
      };
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Bet failed" });
    return;
  }

  broadcastToLobby(lobbyId, { type: "round_started", lobbyId, roundId });
  res.json(view);
});

export default router;
