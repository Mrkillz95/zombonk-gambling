import { pgTable, serial, text, jsonb, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";
import { gamesTable } from "./games";

// Stateful, multi-step game rounds (interactive games: blackjack, mines,
// video_poker, hi_lo, crash). The wager is escrowed when a round starts and
// the payout is credited when it resolves; a bets row is written at resolution
// so history/stats/flagging keep working exactly like one-shot plays.
export const gameRoundsTable = pgTable("game_rounds", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => gamesTable.id),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  type: text("type").notNull(), // snapshot of game type at start
  wager: integer("wager").notNull(),
  status: text("status").notNull().default("active"), // active | resolved
  state: jsonb("state").notNull().default({}), // server-authoritative game state
  won: boolean("won"), // null until resolved
  payout: integer("payout").notNull().default(0),
  betId: integer("bet_id"), // bets row written at resolution
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameRoundSchema = createInsertSchema(gameRoundsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGameRound = z.infer<typeof insertGameRoundSchema>;
export type GameRound = typeof gameRoundsTable.$inferSelect;
