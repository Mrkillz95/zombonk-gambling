import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  discordUser: text("discord_user"),
  password: text("password").notNull().default(""),
  sessionToken: text("session_token"),
  balance: integer("balance").notNull().default(0),
  globalRig: jsonb("global_rig"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
