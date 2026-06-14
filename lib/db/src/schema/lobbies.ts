import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";
import { gamesTable } from "./games";

export const lobbiesTable = pgTable("lobbies", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // shareable join code
  name: text("name").notNull(),
  hostId: integer("host_id").notNull().references(() => playersTable.id),
  status: text("status").notNull().default("open"), // open | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lobbyMembersTable = pgTable(
  "lobby_members",
  {
    id: serial("id").primaryKey(),
    lobbyId: integer("lobby_id").notNull().references(() => lobbiesTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lobby_member_unique").on(t.lobbyId, t.playerId)],
);

export const lobbyMessagesTable = pgTable("lobby_messages", {
  id: serial("id").primaryKey(),
  lobbyId: integer("lobby_id").notNull().references(() => lobbiesTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lobbyTransfersTable = pgTable("lobby_transfers", {
  id: serial("id").primaryKey(),
  lobbyId: integer("lobby_id").notNull().references(() => lobbiesTable.id, { onDelete: "cascade" }),
  fromPlayerId: integer("from_player_id").notNull().references(() => playersTable.id),
  toPlayerId: integer("to_player_id").notNull().references(() => playersTable.id),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lobbyRoundsTable = pgTable("lobby_rounds", {
  id: serial("id").primaryKey(),
  lobbyId: integer("lobby_id").notNull().references(() => lobbiesTable.id, { onDelete: "cascade" }),
  gameId: integer("game_id").notNull().references(() => gamesTable.id),
  gameType: text("game_type").notNull(),
  status: text("status").notNull().default("betting"), // betting | resolved | cancelled
  bettingEndsAt: timestamp("betting_ends_at", { withTimezone: true }).notNull(),
  result: jsonb("result"), // shared outcome visual
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const lobbyRoundBetsTable = pgTable(
  "lobby_round_bets",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id").notNull().references(() => lobbyRoundsTable.id, { onDelete: "cascade" }),
    playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
    betId: integer("bet_id"), // FK to bets table once recorded at resolution
    optionId: integer("option_id"),
    pick: text("pick"),
    wager: integer("wager").notNull(),
    won: boolean("won").notNull().default(false),
    payout: integer("payout").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lobby_round_bet_unique").on(t.roundId, t.playerId)],
);

export const insertLobbySchema = createInsertSchema(lobbiesTable).omit({ id: true, createdAt: true });
export const insertLobbyMemberSchema = createInsertSchema(lobbyMembersTable).omit({ id: true, joinedAt: true, lastSeenAt: true });
export const insertLobbyMessageSchema = createInsertSchema(lobbyMessagesTable).omit({ id: true, createdAt: true });

export type Lobby = typeof lobbiesTable.$inferSelect;
export type LobbyMember = typeof lobbyMembersTable.$inferSelect;
export type LobbyMessage = typeof lobbyMessagesTable.$inferSelect;
export type LobbyTransfer = typeof lobbyTransfersTable.$inferSelect;
export type LobbyRound = typeof lobbyRoundsTable.$inferSelect;
export type LobbyRoundBet = typeof lobbyRoundBetsTable.$inferSelect;
