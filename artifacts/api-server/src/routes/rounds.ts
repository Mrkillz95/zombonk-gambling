import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, playersTable, gamesTable, betsTable, gameRoundsTable } from "@workspace/db";
import { StartRoundBody, RoundActionBody } from "@workspace/api-zod";
import { secureRandom } from "../lib/rng.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const router: IRouter = Router();

// ── Card helpers (kept local so the big games.ts stays untouched) ───────────
const CARD_FACES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const CARD_SUITS = ["♠", "♥", "♦", "♣"] as const;
type Card = { face: string; suit: string; value: number };

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++)
    for (let f = 0; f < 13; f++)
      deck.push({ face: CARD_FACES[f]!, suit: CARD_SUITS[s]!, value: f + 1 });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandom() * (i + 1));
    const tmp = deck[i]!; deck[i] = deck[j]!; deck[j] = tmp;
  }
  return deck;
}

function bjValue(cards: Card[]): number {
  let total = 0; let aces = 0;
  for (const c of cards) { if (c.value === 1) { aces++; total += 11; } else total += Math.min(c.value, 10); }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// Poker hand ranking for 5 cards → { name, mult }
function rankFive(cards: Card[]): { name: string; mult: number } {
  const vals = cards.map((c) => c.value).sort((a, b) => a - b);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);
  const isStraight =
    (vals[4]! - vals[0]! === 4 && new Set(vals).size === 5) ||
    JSON.stringify(vals) === JSON.stringify([1, 10, 11, 12, 13]);
  const counts = vals.reduce((a, v) => { a[v] = (a[v] || 0) + 1; return a; }, {} as Record<number, number>);
  const c = Object.values(counts).sort((a, b) => b - a);
  if (isFlush && isStraight && vals.includes(1) && vals.includes(13)) return { name: "Royal Flush", mult: 800 };
  if (isFlush && isStraight) return { name: "Straight Flush", mult: 50 };
  if (c[0] === 4) return { name: "Four of a Kind", mult: 25 };
  if (c[0] === 3 && c[1] === 2) return { name: "Full House", mult: 9 };
  if (isFlush) return { name: "Flush", mult: 6 };
  if (isStraight) return { name: "Straight", mult: 4 };
  if (c[0] === 3) return { name: "Three of a Kind", mult: 3 };
  if (c[0] === 2 && c[1] === 2) return { name: "Two Pair", mult: 2 };
  if (c[0] === 2) {
    const pairV = parseInt(Object.entries(counts).find(([, v]) => v === 2)?.[0] ?? "0", 10);
    if (pairV >= 11 || pairV === 1) return { name: "Jacks or Better", mult: 1 };
  }
  return { name: "No Hand", mult: 0 };
}

// Mines fair multiplier after `revealed` safe picks with `mines` mines on 25 tiles,
// with a small house edge.
const MINES_GRID = 25;
function minesMultiplier(mines: number, revealed: number): number {
  let m = 1;
  for (let i = 0; i < revealed; i++) m *= (MINES_GRID - i) / (MINES_GRID - mines - i);
  return round2(m * 0.97);
}

// Crash multiplier curve from elapsed time.
const CRASH_GROWTH = 0.15;
function crashMultAt(startedAt: number, now: number): number {
  return round2(Math.exp(CRASH_GROWTH * Math.max(0, now - startedAt) / 1000));
}

const ROUND_TYPES = new Set(["blackjack", "mines", "video_poker", "hi_lo", "crash"]);

type RoundRow = typeof gameRoundsTable.$inferSelect;

// ── Public-state redaction: never leak hidden info while a round is active ───
function publicState(type: string, state: any, status: string): any {
  const resolved = status === "resolved";
  switch (type) {
    case "blackjack": {
      const dealer: Card[] = state.dealer || [];
      const shown = resolved ? dealer : dealer.slice(0, 1);
      return {
        player: state.player,
        dealer: shown,
        dealerHidden: !resolved && dealer.length > 1,
        playerTotal: bjValue(state.player || []),
        dealerTotal: resolved ? bjValue(dealer) : bjValue(shown),
        multiplier: state.multiplier,
        doubled: !!state.doubled,
        outcome: state.outcome ?? null,
      };
    }
    case "mines": {
      const positions: number[] = state.minePositions || [];
      const revealed: number[] = state.revealed || [];
      return {
        gridSize: MINES_GRID,
        mineCount: state.mineCount,
        revealed,
        multiplier: state.multiplier,
        nextMultiplier: minesMultiplier(state.mineCount, revealed.length + 1),
        // Mines only exposed once the round is over.
        minePositions: resolved ? positions : null,
        bust: state.bust ?? null,
      };
    }
    case "video_poker": {
      return { hand: state.hand, drawn: !!state.drawn, handName: state.handName ?? null, multiplier: state.multiplier ?? null };
    }
    case "hi_lo": {
      return {
        current: state.current,
        history: state.history || [],
        multiplier: state.multiplier,
        streak: state.streak || 0,
        next: resolved ? (state.next ?? null) : null,
      };
    }
    case "crash": {
      const now = Date.now();
      return {
        startedAt: state.startedAt,
        growth: CRASH_GROWTH,
        multiplier: resolved ? state.cashoutMult ?? state.crashPoint : crashMultAt(state.startedAt, now),
        crashPoint: resolved ? state.crashPoint : null,
        crashed: resolved ? !!state.crashed : false,
      };
    }
    default:
      return {};
  }
}

function actionsFor(type: string, state: any, status: string): string[] {
  if (status === "resolved") return [];
  switch (type) {
    case "blackjack": {
      const canDouble = (state.player?.length ?? 0) === 2 && !state.doubled;
      return canDouble ? ["hit", "stand", "double"] : ["hit", "stand"];
    }
    case "mines":
      return (state.revealed?.length ?? 0) >= 1 ? ["reveal", "cashout"] : ["reveal"];
    case "video_poker":
      return state.drawn ? [] : ["draw"];
    case "hi_lo":
      return (state.streak ?? 0) >= 1 ? ["higher", "lower", "cashout"] : ["higher", "lower"];
    case "crash":
      return ["cashout"];
    default:
      return [];
  }
}

function buildResponse(
  round: RoundRow,
  opts: { state: any; status: string; won: boolean | null; payout: number; newBalance: number; message: string; betId: number | null }
) {
  return {
    roundId: round.id,
    gameId: round.gameId,
    type: round.type,
    status: opts.status,
    wager: round.wager,
    state: publicState(round.type, opts.state, opts.status),
    actions: actionsFor(round.type, opts.state, opts.status),
    won: opts.won,
    payout: opts.payout,
    newBalance: opts.newBalance,
    message: opts.message,
    betId: opts.betId,
  };
}

// Credit payout, write a bets row (so stats/flagging keep working), mark resolved.
// Idempotent + atomic: the resolve is a compare-and-set on status='active', so a
// round can only ever be settled once even under concurrent requests. Callers run
// this inside a transaction that holds a FOR UPDATE lock on the round row.
async function settle(
  tx: Tx,
  round: RoundRow,
  finalState: any,
  won: boolean,
  payout: number
): Promise<{ betId: number; newBalance: number } | null> {
  const updated = await tx
    .update(gameRoundsTable)
    .set({ status: "resolved", state: finalState, won, payout, updatedAt: new Date() })
    .where(and(eq(gameRoundsTable.id, round.id), eq(gameRoundsTable.status, "active")))
    .returning();
  // Already resolved by a concurrent request — do nothing.
  if (updated.length === 0) return null;
  const [bet] = await tx
    .insert(betsTable)
    .values({ playerId: round.playerId, gameId: round.gameId, wager: round.wager, payout, won, optionId: null, pick: null, details: finalState })
    .returning();
  await tx.update(gameRoundsTable).set({ betId: bet!.id }).where(eq(gameRoundsTable.id, round.id));
  // Atomic credit so concurrent settles on other rounds can't clobber each other.
  const [player] = await tx
    .update(playersTable)
    .set({ balance: sql`${playersTable.balance} + ${payout}` })
    .where(eq(playersTable.id, round.playerId))
    .returning();
  return { betId: bet!.id, newBalance: player?.balance ?? 0 };
}

async function persistActive(tx: Tx, round: RoundRow, state: any): Promise<void> {
  await tx.update(gameRoundsTable).set({ state, updatedAt: new Date() }).where(eq(gameRoundsTable.id, round.id));
}

// ── Dealer auto-play for blackjack ──────────────────────────────────────────
function dealerPlay(deck: Card[], dealer: Card[]): void {
  while (bjValue(dealer) < 17) dealer.push(deck.pop()!);
}

function resolveBlackjack(round: RoundRow, state: any) {
  const playerTotal = bjValue(state.player);
  const dealerTotal = bjValue(state.dealer);
  const mult = state.multiplier;
  let won = false; let payout = 0; let outcome: string; let message: string;
  if (playerTotal > 21) {
    outcome = "bust"; won = false; payout = 0;
    message = `Bust at ${playerTotal}. Dealer takes it.`;
  } else if (dealerTotal > 21) {
    outcome = "dealer_bust"; won = true; payout = Math.floor(round.wager * mult);
    message = `Dealer busts at ${dealerTotal}! You stand on ${playerTotal}. Won ${payout} coins!`;
  } else if (playerTotal > dealerTotal) {
    outcome = "win"; won = true; payout = Math.floor(round.wager * mult);
    message = `${playerTotal} beats dealer's ${dealerTotal}! Won ${payout} coins!`;
  } else if (playerTotal === dealerTotal) {
    outcome = "push"; won = false; payout = round.wager;
    message = `Push at ${playerTotal}. Wager returned.`;
  } else {
    outcome = "lose"; won = false; payout = 0;
    message = `Dealer's ${dealerTotal} beats your ${playerTotal}. No win.`;
  }
  return { ...state, outcome, finished: true, won, payout, message };
}

// ── POST /games/:id/rounds — start a round ──────────────────────────────────
router.post("/games/:id/rounds", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const gameId = parseInt(rawId, 10);
  if (isNaN(gameId)) { res.status(400).json({ error: "Invalid game id" }); return; }

  const parsed = StartRoundBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { playerId, wager } = parsed.data;
  const mineCount = parsed.data.mineCount ?? null;

  if (!Number.isFinite(wager) || wager <= 0) { res.status(400).json({ error: "Wager must be positive" }); return; }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId));
  if (!game) { res.status(404).json({ error: "Game not found" }); return; }
  if (!ROUND_TYPES.has(game.type)) { res.status(400).json({ error: `${game.type} is not an interactive round game` }); return; }
  if (game.status !== "open") { res.status(400).json({ error: "Game is not open" }); return; }

  const config: any = game.config || {};

  // Build the initial server-authoritative state per type.
  let state: any;
  let message = "";
  let autoResolve: { won: boolean; payout: number; finalState: any } | null = null;

  if (game.type === "blackjack") {
    const deck = makeDeck();
    const player2 = [deck.pop()!, deck.pop()!];
    const dealer2 = [deck.pop()!, deck.pop()!];
    const mult = Number(config.win_multiplier) > 0 ? Number(config.win_multiplier) : 2;
    state = { deck, player: player2, dealer: dealer2, multiplier: mult, doubled: false, finished: false };
    const pv = bjValue(player2);
    const dv = bjValue(dealer2);
    if (pv === 21 || dv === 21) {
      // Natural(s) end the hand immediately.
      let won = false; let payout = 0; let outcome: string; let msg: string;
      if (pv === 21 && dv === 21) { outcome = "push"; payout = wager; msg = "Both have Blackjack. Push — wager returned."; }
      else if (pv === 21) { outcome = "blackjack"; won = true; payout = Math.floor(wager * (mult + 0.5)); msg = `Blackjack! Pays 3:2 — won ${payout} coins!`; }
      else { outcome = "lose"; msg = `Dealer has Blackjack (${dv}). No win.`; }
      const finalState = { ...state, outcome, finished: true, won, payout, message: msg };
      autoResolve = { won, payout, finalState };
    } else {
      message = `Dealt ${pv}. Hit, stand, or double?`;
    }
  } else if (game.type === "mines") {
    const maxMines = Number(config.maxMines) || 24;
    const mc = mineCount ?? 3;
    if (!Number.isFinite(mc) || mc < 1 || mc > maxMines) { res.status(400).json({ error: `Pick 1–${maxMines} mines` }); return; }
    const minePositions = new Set<number>();
    while (minePositions.size < mc) minePositions.add(Math.floor(secureRandom() * MINES_GRID));
    state = { mineCount: mc, minePositions: [...minePositions], revealed: [], multiplier: 1, finished: false, bust: false };
    message = `${mc} mines hidden. Reveal a tile.`;
  } else if (game.type === "video_poker") {
    const deck = makeDeck();
    const hand = deck.splice(0, 5);
    state = { deck, hand, drawn: false };
    message = "Hold the cards you want, then draw.";
  } else if (game.type === "hi_lo") {
    const deck = makeDeck();
    const current = deck.pop()!;
    state = { deck, current, history: [current], multiplier: 1, streak: 0, finished: false };
    message = `Card is ${current.face}${current.suit}. Higher or lower?`;
  } else if (game.type === "crash") {
    const crashPoint = round2(Math.max(1.01, 0.99 / secureRandom()));
    state = { crashPoint, startedAt: Date.now(), finished: false };
    message = "Rocket launching — cash out before it crashes!";
  } else {
    res.status(400).json({ error: "Unsupported round type" }); return;
  }

  // All balance mutations happen in one transaction holding a FOR UPDATE lock on
  // the player row, so concurrent round starts can't both pass the balance check
  // and over-draw the account.
  type StartOut =
    | { error: { status: number; message: string } }
    | { ok: ReturnType<typeof buildResponse> };

  const result: StartOut = await db.transaction(async (tx): Promise<StartOut> => {
    const [player] = await tx
      .select()
      .from(playersTable)
      .where(eq(playersTable.id, playerId))
      .for("update");
    if (!player) return { error: { status: 404, message: "Player not found" } };
    if (player.balance < wager) return { error: { status: 400, message: "Insufficient balance" } };

    // Escrow the wager atomically.
    const [escrowed] = await tx
      .update(playersTable)
      .set({ balance: sql`${playersTable.balance} - ${wager}` })
      .where(eq(playersTable.id, playerId))
      .returning();
    const balanceAfterEscrow = escrowed?.balance ?? player.balance - wager;

    const [round] = await tx
      .insert(gameRoundsTable)
      .values({ gameId, playerId, type: game.type, wager, status: "active", state })
      .returning();

    if (autoResolve) {
      const settled = await settle(tx, round!, autoResolve.finalState, autoResolve.won, autoResolve.payout);
      return {
        ok: buildResponse(round!, { state: autoResolve.finalState, status: "resolved", won: autoResolve.won, payout: autoResolve.payout, newBalance: settled?.newBalance ?? balanceAfterEscrow, message: autoResolve.finalState.message, betId: settled?.betId ?? null }),
      } as const;
    }

    return {
      ok: buildResponse(round!, { state, status: "active", won: null, payout: 0, newBalance: balanceAfterEscrow, message, betId: null }),
    } as const;
  });

  if ("error" in result) { res.status(result.error.status).json({ error: result.error.message }); return; }
  res.json(result.ok);
});

// ── GET /rounds/:roundId — resync (also drives crash auto-bust) ──────────────
router.get("/rounds/:roundId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.roundId) ? req.params.roundId[0] : req.params.roundId;
  const roundId = parseInt(rawId, 10);
  if (isNaN(roundId)) { res.status(400).json({ error: "Invalid round id" }); return; }

  const rawPlayer = Array.isArray(req.query.playerId) ? req.query.playerId[0] : req.query.playerId;
  const playerId = parseInt(String(rawPlayer ?? ""), 10);
  if (isNaN(playerId)) { res.status(400).json({ error: "playerId is required" }); return; }

  const [round] = await db.select().from(gameRoundsTable).where(eq(gameRoundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  // Ownership check — a round's state is private to its player.
  if (round.playerId !== playerId) { res.status(403).json({ error: "Not your round" }); return; }

  const state: any = round.state;

  // Crash auto-busts the moment its hidden crash point is passed. Done under a
  // transaction + row lock so the resolve stays atomic and single-shot even if a
  // poll and an action race.
  if (round.status === "active" && round.type === "crash") {
    if (crashMultAt(state.startedAt, Date.now()) >= state.crashPoint) {
      const settled = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(gameRoundsTable)
          .where(eq(gameRoundsTable.id, roundId))
          .for("update");
        if (!locked || locked.status !== "active") return null;
        const ls: any = locked.state;
        if (crashMultAt(ls.startedAt, Date.now()) < ls.crashPoint) return null;
        const finalState = { ...ls, finished: true, crashed: true, won: false, payout: 0, message: `💥 Crashed at ${ls.crashPoint}x.` };
        const out = await settle(tx, locked, finalState, false, 0);
        return { finalState, betId: out?.betId ?? null, newBalance: out?.newBalance ?? 0 };
      });
      if (settled) {
        res.json(buildResponse(round, { state: settled.finalState, status: "resolved", won: false, payout: 0, newBalance: settled.newBalance, message: settled.finalState.message, betId: settled.betId }));
        return;
      }
      // Lost the race — fall through and re-read the now-resolved round.
      const [fresh] = await db.select().from(gameRoundsTable).where(eq(gameRoundsTable.id, roundId));
      if (fresh) {
        const fs: any = fresh.state;
        const [pl] = await db.select().from(playersTable).where(eq(playersTable.id, fresh.playerId));
        res.json(buildResponse(fresh, { state: fs, status: fresh.status, won: fresh.won ?? null, payout: fresh.payout, newBalance: pl?.balance ?? 0, message: fresh.status === "resolved" ? (fs.message ?? "") : "", betId: fresh.betId ?? null }));
        return;
      }
    }
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, round.playerId));
  res.json(buildResponse(round, {
    state,
    status: round.status,
    won: round.won ?? null,
    payout: round.payout,
    newBalance: player?.balance ?? 0,
    message: round.status === "resolved" ? (state.message ?? "") : "",
    betId: round.betId ?? null,
  }));
});

// ── POST /rounds/:roundId/action ────────────────────────────────────────────
router.post("/rounds/:roundId/action", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.roundId) ? req.params.roundId[0] : req.params.roundId;
  const roundId = parseInt(rawId, 10);
  if (isNaN(roundId)) { res.status(400).json({ error: "Invalid round id" }); return; }

  const parsed = RoundActionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { playerId, action } = parsed.data;

  // Everything runs in one transaction that holds a FOR UPDATE lock on the round
  // row. That serializes concurrent actions on the same round, so a round can be
  // mutated/resolved exactly once even if two requests arrive together.
  type ActionOut =
    | { error: { status: number; message: string } }
    | { ok: ReturnType<typeof buildResponse> };

  const result: ActionOut = await db.transaction(async (tx): Promise<ActionOut> => {
    const [round] = await tx
      .select()
      .from(gameRoundsTable)
      .where(eq(gameRoundsTable.id, roundId))
      .for("update");
    if (!round) return { error: { status: 404, message: "Round not found" } };
    if (round.playerId !== playerId) return { error: { status: 403, message: "Not your round" } };
    if (round.status !== "active") return { error: { status: 400, message: "Round already resolved" } };

    const allowed = actionsFor(round.type, round.state, "active");
    if (!allowed.includes(action)) return { error: { status: 400, message: `Action '${action}' not allowed now` } };

    const state: any = round.state;
    const activeBalance = async (): Promise<number> => {
      const [pl] = await tx.select().from(playersTable).where(eq(playersTable.id, playerId));
      return pl?.balance ?? 0;
    };

    // ── BLACKJACK ───────────────────────────────────────────────────────────
    if (round.type === "blackjack") {
      if (action === "hit") {
        state.player.push(state.deck.pop()!);
        if (bjValue(state.player) > 21) {
          const finalState = resolveBlackjack(round, state);
          const out = await settle(tx, round, finalState, finalState.won, finalState.payout);
          return { ok: buildResponse(round, { state: finalState, status: "resolved", won: finalState.won, payout: finalState.payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
        }
        await persistActive(tx, round, state);
        return { ok: buildResponse(round, { state, status: "active", won: null, payout: 0, newBalance: await activeBalance(), message: `You have ${bjValue(state.player)}. Hit or stand?`, betId: null }) };
      }
      if (action === "double") {
        const [pl] = await tx.select().from(playersTable).where(eq(playersTable.id, playerId)).for("update");
        if ((pl?.balance ?? 0) < round.wager) return { error: { status: 400, message: "Not enough balance to double" } };
        await tx.update(playersTable).set({ balance: sql`${playersTable.balance} - ${round.wager}` }).where(eq(playersTable.id, playerId));
        await tx.update(gameRoundsTable).set({ wager: round.wager * 2 }).where(eq(gameRoundsTable.id, round.id));
        round.wager = round.wager * 2;
        state.doubled = true;
        state.player.push(state.deck.pop()!);
        if (bjValue(state.player) <= 21) dealerPlay(state.deck, state.dealer);
        const finalState = resolveBlackjack(round, state);
        const out = await settle(tx, round, finalState, finalState.won, finalState.payout);
        return { ok: buildResponse(round, { state: finalState, status: "resolved", won: finalState.won, payout: finalState.payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
      }
      // stand
      dealerPlay(state.deck, state.dealer);
      const finalState = resolveBlackjack(round, state);
      const out = await settle(tx, round, finalState, finalState.won, finalState.payout);
      return { ok: buildResponse(round, { state: finalState, status: "resolved", won: finalState.won, payout: finalState.payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
    }

    // ── MINES ─────────────────────────────────────────────────────────────--
    if (round.type === "mines") {
      if (action === "reveal") {
        const tile = parsed.data.tile;
        if (tile == null || tile < 0 || tile >= MINES_GRID) return { error: { status: 400, message: "Invalid tile" } };
        if (state.revealed.includes(tile)) return { error: { status: 400, message: "Tile already revealed" } };
        if (state.minePositions.includes(tile)) {
          const finalState = { ...state, bust: true, bustTile: tile, finished: true, won: false, payout: 0, message: `💥 Boom! Tile ${tile + 1} was a mine. Lost ${round.wager} coins.` };
          const out = await settle(tx, round, finalState, false, 0);
          return { ok: buildResponse(round, { state: finalState, status: "resolved", won: false, payout: 0, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
        }
        state.revealed.push(tile);
        state.multiplier = minesMultiplier(state.mineCount, state.revealed.length);
        // All safe tiles cleared → auto cash-out at max.
        if (state.revealed.length >= MINES_GRID - state.mineCount) {
          const payout = Math.floor(round.wager * state.multiplier);
          const finalState = { ...state, finished: true, won: true, payout, message: `Cleared the board! ${state.multiplier}x — won ${payout} coins!` };
          const out = await settle(tx, round, finalState, true, payout);
          return { ok: buildResponse(round, { state: finalState, status: "resolved", won: true, payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
        }
        await persistActive(tx, round, state);
        return { ok: buildResponse(round, { state, status: "active", won: null, payout: 0, newBalance: await activeBalance(), message: `Safe! ${state.revealed.length} clear. ${state.multiplier}x — cash out or keep going?`, betId: null }) };
      }
      // cashout
      const payout = Math.floor(round.wager * state.multiplier);
      const finalState = { ...state, finished: true, won: true, payout, message: `Cashed out at ${state.multiplier}x — won ${payout} coins!` };
      const out = await settle(tx, round, finalState, true, payout);
      return { ok: buildResponse(round, { state: finalState, status: "resolved", won: true, payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
    }

    // ── VIDEO POKER ─────────────────────────────────────────────────────────
    if (round.type === "video_poker") {
      const hold = Array.isArray(parsed.data.hold) ? parsed.data.hold : [];
      const newHand: Card[] = state.hand.map((card: Card, i: number) => (hold.includes(i) ? card : state.deck.pop()!));
      const rank = rankFive(newHand);
      const payout = Math.floor(round.wager * rank.mult);
      const won = rank.mult >= 1;
      const finalState = { ...state, hand: newHand, drawn: true, handName: rank.name, multiplier: rank.mult, finished: true, won, payout, message: won ? `${rank.name}! ${rank.mult}x — won ${payout} coins!` : `${rank.name}. No winning hand.` };
      const out = await settle(tx, round, finalState, won, payout);
      return { ok: buildResponse(round, { state: finalState, status: "resolved", won, payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
    }

    // ── HI-LO ─────────────────────────────────────────────────────────────--
    if (round.type === "hi_lo") {
      if (action === "cashout") {
        const payout = Math.floor(round.wager * state.multiplier);
        const finalState = { ...state, finished: true, won: true, payout, message: `Cashed out at ${state.multiplier}x — won ${payout} coins!` };
        const out = await settle(tx, round, finalState, true, payout);
        return { ok: buildResponse(round, { state: finalState, status: "resolved", won: true, payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
      }
      // higher / lower
      const cur: Card = state.current;
      const next: Card = state.deck.pop()!;
      const guessHigher = action === "higher";
      const correct = guessHigher ? next.value > cur.value : next.value < cur.value;
      // Fair odds from the remaining deck (incl. the just-drawn card), with house edge.
      const pool = [next, ...state.deck];
      const favorable = pool.filter((c: Card) => (guessHigher ? c.value > cur.value : c.value < cur.value)).length;
      const p = Math.max(0.02, favorable / pool.length);
      if (!correct) {
        const finalState = { ...state, next, history: [...state.history, next], finished: true, won: false, payout: 0, message: `Drew ${next.face}${next.suit} — wrong. Lost ${round.wager} coins.` };
        const out = await settle(tx, round, finalState, false, 0);
        return { ok: buildResponse(round, { state: finalState, status: "resolved", won: false, payout: 0, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
      }
      state.multiplier = round2(state.multiplier * Math.max(1.05, (1 / p) * 0.95));
      state.current = next;
      state.history = [...state.history, next];
      state.streak = (state.streak || 0) + 1;
      if (state.deck.length === 0) {
        const payout = Math.floor(round.wager * state.multiplier);
        const finalState = { ...state, finished: true, won: true, payout, message: `Deck exhausted! Cashed out at ${state.multiplier}x — won ${payout} coins!` };
        const out = await settle(tx, round, finalState, true, payout);
        return { ok: buildResponse(round, { state: finalState, status: "resolved", won: true, payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
      }
      await persistActive(tx, round, state);
      return { ok: buildResponse(round, { state, status: "active", won: null, payout: 0, newBalance: await activeBalance(), message: `Correct! ${next.face}${next.suit}. ${state.multiplier}x — keep going or cash out?`, betId: null }) };
    }

    // ── CRASH ─────────────────────────────────────────────────────────────────
    if (round.type === "crash") {
      const cur = crashMultAt(state.startedAt, Date.now());
      if (cur >= state.crashPoint) {
        const finalState = { ...state, finished: true, crashed: true, won: false, payout: 0, message: `💥 Crashed at ${state.crashPoint}x before you cashed out.` };
        const out = await settle(tx, round, finalState, false, 0);
        return { ok: buildResponse(round, { state: finalState, status: "resolved", won: false, payout: 0, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
      }
      const payout = Math.floor(round.wager * cur);
      const finalState = { ...state, finished: true, crashed: false, cashoutMult: cur, won: true, payout, message: `🚀 Cashed out at ${cur}x — won ${payout} coins!` };
      const out = await settle(tx, round, finalState, true, payout);
      return { ok: buildResponse(round, { state: finalState, status: "resolved", won: true, payout, newBalance: out?.newBalance ?? 0, message: finalState.message, betId: out?.betId ?? null }) };
    }

    return { error: { status: 400, message: "Unsupported round type" } };
  });

  if ("error" in result) { res.status(result.error.status).json({ error: result.error.message }); return; }
  res.json(result.ok);
});

export default router;
