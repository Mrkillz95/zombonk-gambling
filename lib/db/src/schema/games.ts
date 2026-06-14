import { pgTable, serial, text, jsonb, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gamesTable = pgTable("games", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(), // slots | coin_flip | match_bet | number_pick | mystery_box
  status: text("status").notNull().default("open"), // open | closed | resolved
  config: jsonb("config").notNull().default({}),
  resolvedOptionId: integer("resolved_option_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gameOptionsTable = pgTable("game_options", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => gamesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  odds: text("odds").notNull().default("2.0"), // stored as string to avoid float issues
  emoji: text("emoji"),
  weight: integer("weight").notNull().default(1),
  isWinner: boolean("is_winner"),
  imageUrl: text("image_url"),
  displayOdds: text("display_odds"), // text shown to players (can differ from real odds)
  trueWinPct: integer("true_win_pct"), // 0–100: actual win % when player picks this option; null = use weight
});

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  gameId: integer("game_id").notNull().references(() => gamesTable.id),
  wager: integer("wager").notNull(),
  payout: integer("payout").notNull().default(0),
  won: boolean("won").notNull().default(false),
  optionId: integer("option_id"),
  pick: text("pick"),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

import { playersTable } from "./players";

export const insertGameSchema = createInsertSchema(gamesTable).omit({ id: true, createdAt: true });
export const insertGameOptionSchema = createInsertSchema(gameOptionsTable).omit({ id: true });
export const insertBetSchema = createInsertSchema(betsTable).omit({ id: true, createdAt: true });

export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
export type GameOption = typeof gameOptionsTable.$inferSelect;
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;
