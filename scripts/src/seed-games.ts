/**
 * Idempotent seed for Zombonk casino games.
 *
 * - Inserts the canonical set of games whose engine + UI already exist but that
 *   have no DB row yet (blackjack, crash, keno, scratch_card, video_poker,
 *   mines, war, baccarat, three_card_poker). A game is only inserted when no
 *   game with the same title already exists, so re-running is safe and never
 *   touches existing games, options, bets, or player data.
 * - Removes the redundant "Trivia" game (a reskin of Match Bet) ONLY when it
 *   has zero bets, so no real history is ever destroyed.
 *
 * Run: pnpm --filter @workspace/scripts run seed:games
 */
import { db, pool, gamesTable, gameOptionsTable, betsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

type OptionSeed = { label: string; odds: number; emoji?: string; weight?: number };
type GameSeed = {
  title: string;
  type: string;
  config: Record<string, unknown>;
  options?: OptionSeed[];
};

// Config/options mirror the mod create UI (mod/games.tsx) so seeded games are
// identical to what a moderator would produce by hand. Odds remain editable.
const SCRATCH_SYMBOLS = [
  { label: "Cherry 🍒", weight: 8, payout: 3 },
  { label: "Bell 🔔", weight: 5, payout: 5 },
  { label: "Coin 🪙", weight: 4, payout: 8 },
  { label: "Diamond 💎", weight: 2, payout: 15 },
  { label: "Lucky 7 ⑦", weight: 1, payout: 30 },
];

const GAMES: GameSeed[] = [
  {
    title: "Blackjack",
    type: "blackjack",
    config: { win_multiplier: 2 },
    options: [
      { label: "Hit", odds: 2, emoji: "", weight: 1 },
      { label: "Stand", odds: 2, emoji: "", weight: 1 },
    ],
  },
  { title: "Crash", type: "crash", config: { maxTarget: 50 } },
  { title: "Keno", type: "keno", config: { maxSpots: 10 } },
  { title: "Scratch Card", type: "scratch_card", config: { symbols: SCRATCH_SYMBOLS } },
  { title: "Video Poker", type: "video_poker", config: {} },
  { title: "Minesweeper", type: "mines", config: { maxMines: 24 } },
  { title: "Casino War", type: "war", config: { tieMult: 3, winMult: 2 } },
  {
    title: "Baccarat",
    type: "baccarat",
    config: {},
    options: [
      { label: "Player", odds: 2, emoji: "🔵", weight: 1 },
      { label: "Banker", odds: 1.95, emoji: "🔴", weight: 1 },
      { label: "Tie", odds: 8, emoji: "🟢", weight: 1 },
    ],
  },
  { title: "Three Card Poker", type: "three_card_poker", config: {} },
];

function optionRows(gameId: number, options: OptionSeed[]) {
  return options.map((o) => ({
    gameId,
    label: o.label,
    odds: String(o.odds),
    emoji: o.emoji ?? "",
    weight: o.weight ?? 1,
  }));
}

async function main() {
  const existing = await db.select({ id: gamesTable.id, title: gamesTable.title }).from(gamesTable);
  const byTitle = new Map(existing.map((g) => [g.title.trim().toLowerCase(), g.id]));

  let inserted = 0;
  let repaired = 0;
  for (const g of GAMES) {
    const existingId = byTitle.get(g.title.trim().toLowerCase());
    if (existingId !== undefined) {
      // Self-heal: a prior partial run may have created the game row but failed
      // before its options were inserted. Backfill missing options so reruns
      // converge to a correct game instead of leaving it permanently malformed.
      if (g.options?.length) {
        const [c] = await db
          .select({ n: count() })
          .from(gameOptionsTable)
          .where(eq(gameOptionsTable.gameId, existingId));
        if (Number(c?.n ?? 0) === 0) {
          await db.insert(gameOptionsTable).values(optionRows(existingId, g.options));
          repaired++;
          console.log(`repaired (backfilled options): ${g.title} -> game #${existingId}`);
          continue;
        }
      }
      console.log(`skip (exists): ${g.title}`);
      continue;
    }
    // Insert row + options atomically so a failure never leaves a half-seeded game.
    const newId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(gamesTable)
        .values({ title: g.title, type: g.type, status: "open", config: g.config })
        .returning({ id: gamesTable.id });
      if (row && g.options?.length) {
        await tx.insert(gameOptionsTable).values(optionRows(row.id, g.options));
      }
      return row?.id;
    });
    inserted++;
    console.log(`inserted: ${g.title} (${g.type}) -> game #${newId}`);
  }

  // Remove redundant Trivia games — only when they carry no bet history.
  const trivias = await db
    .select({ id: gamesTable.id, title: gamesTable.title })
    .from(gamesTable)
    .where(eq(gamesTable.type, "trivia"));
  for (const t of trivias) {
    const [c] = await db
      .select({ n: count() })
      .from(betsTable)
      .where(eq(betsTable.gameId, t.id));
    const bets = Number(c?.n ?? 0);
    if (bets === 0) {
      await db.transaction(async (tx) => {
        await tx.delete(gameOptionsTable).where(eq(gameOptionsTable.gameId, t.id));
        await tx.delete(gamesTable).where(eq(gamesTable.id, t.id));
      });
      console.log(`removed redundant Trivia game #${t.id} (0 bets)`);
    } else {
      console.log(`kept Trivia game #${t.id} (${bets} bets — preserving history)`);
    }
  }

  console.log(`\nDone. ${inserted} game(s) inserted.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
