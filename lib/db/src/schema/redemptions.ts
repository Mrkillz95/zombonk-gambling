import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";

export const redemptionItemsTable = pgTable("redemption_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  cost: integer("cost").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const redemptionRequestsTable = pgTable("redemption_requests", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  itemId: integer("item_id").notNull().references(() => redemptionItemsTable.id),
  status: text("status").notNull().default("pending"), // pending | fulfilled | denied
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRedemptionItemSchema = createInsertSchema(redemptionItemsTable).omit({ id: true, createdAt: true });
export const insertRedemptionRequestSchema = createInsertSchema(redemptionRequestsTable).omit({ id: true, createdAt: true });

export type RedemptionItem = typeof redemptionItemsTable.$inferSelect;
export type RedemptionRequest = typeof redemptionRequestsTable.$inferSelect;
export type InsertRedemptionItem = z.infer<typeof insertRedemptionItemSchema>;
export type InsertRedemptionRequest = z.infer<typeof insertRedemptionRequestSchema>;
