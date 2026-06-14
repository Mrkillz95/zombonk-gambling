import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, playersTable, redemptionItemsTable, redemptionRequestsTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const MOD_PASSWORD = process.env.MOD_PASSWORD ?? "zombonk123";
function requireMod(req: any, res: any): boolean {
  const pw = req.headers["x-mod-password"];
  if (pw !== MOD_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ── Player: list active items ──────────────────────────────────────────────
router.get("/redemptions/items", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(redemptionItemsTable)
    .where(eq(redemptionItemsTable.active, true))
    .orderBy(redemptionItemsTable.cost);

  res.json(items.map(fmt));
});

// ── Player: request an item ────────────────────────────────────────────────
router.post("/redemptions/items/:id/request", async (req, res): Promise<void> => {
  const itemId = parseInt(req.params.id ?? "0", 10);
  const body = z.object({ playerId: z.number().int() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "playerId required" }); return; }

  const [item] = await db.select().from(redemptionItemsTable).where(eq(redemptionItemsTable.id, itemId));
  if (!item || !item.active) { res.status(404).json({ error: "Item not found or inactive" }); return; }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, body.data.playerId));
  if (!player) { res.status(404).json({ error: "Player not found" }); return; }
  if (player.balance < item.cost) { res.status(400).json({ error: `Insufficient balance — need ${item.cost} coins` }); return; }

  // Deduct coins upfront
  await db.update(playersTable).set({ balance: player.balance - item.cost }).where(eq(playersTable.id, player.id));

  const [request] = await db
    .insert(redemptionRequestsTable)
    .values({ playerId: player.id, itemId: item.id, status: "pending" })
    .returning();

  res.json(fmtRequest(request, item, player));
});

// ── Mod: list all items ────────────────────────────────────────────────────
router.get("/mod/redemptions/items", async (req, res): Promise<void> => {
  if (!requireMod(req, res)) return;
  const items = await db.select().from(redemptionItemsTable).orderBy(redemptionItemsTable.cost);
  res.json(items.map(fmt));
});

// ── Mod: create item ───────────────────────────────────────────────────────
router.post("/mod/redemptions/items", async (req, res): Promise<void> => {
  if (!requireMod(req, res)) return;
  const body = z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    cost: z.number().int().min(1),
    active: z.boolean().default(true),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [item] = await db.insert(redemptionItemsTable).values(body.data).returning();
  res.json(fmt(item));
});

// ── Mod: update item ───────────────────────────────────────────────────────
router.patch("/mod/redemptions/items/:id", async (req, res): Promise<void> => {
  if (!requireMod(req, res)) return;
  const id = parseInt(req.params.id ?? "0", 10);
  const body = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    cost: z.number().int().min(1).optional(),
    active: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [item] = await db.update(redemptionItemsTable).set(body.data).where(eq(redemptionItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(item));
});

// ── Mod: delete item ───────────────────────────────────────────────────────
router.delete("/mod/redemptions/items/:id", async (req, res): Promise<void> => {
  if (!requireMod(req, res)) return;
  const id = parseInt(req.params.id ?? "0", 10);
  // Delete associated requests first to satisfy the foreign key constraint
  await db.delete(redemptionRequestsTable).where(eq(redemptionRequestsTable.itemId, id));
  await db.delete(redemptionItemsTable).where(eq(redemptionItemsTable.id, id));
  res.json({ success: true });
});

// ── Mod: list all requests ─────────────────────────────────────────────────
router.get("/mod/redemptions/requests", async (req, res): Promise<void> => {
  if (!requireMod(req, res)) return;
  const status = req.query.status as string | undefined;

  const rows = await db
    .select({
      request: redemptionRequestsTable,
      item: redemptionItemsTable,
      player: playersTable,
    })
    .from(redemptionRequestsTable)
    .leftJoin(redemptionItemsTable, eq(redemptionRequestsTable.itemId, redemptionItemsTable.id))
    .leftJoin(playersTable, eq(redemptionRequestsTable.playerId, playersTable.id))
    .where(status ? eq(redemptionRequestsTable.status, status) : undefined)
    .orderBy(desc(redemptionRequestsTable.createdAt));

  res.json(rows.map(r => fmtRequest(r.request, r.item as any, r.player as any)));
});

// ── Mod: fulfill or deny request ───────────────────────────────────────────
router.patch("/mod/redemptions/requests/:id", async (req, res): Promise<void> => {
  if (!requireMod(req, res)) return;
  const id = parseInt(req.params.id ?? "0", 10);
  const body = z.object({
    status: z.enum(["fulfilled", "denied"]),
    note: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "status must be fulfilled or denied" }); return; }

  const [request] = await db.select().from(redemptionRequestsTable).where(eq(redemptionRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "Not found" }); return; }
  if (request.status !== "pending") { res.status(400).json({ error: "Request already resolved" }); return; }

  // Refund coins if denied
  if (body.data.status === "denied") {
    const [item] = await db.select().from(redemptionItemsTable).where(eq(redemptionItemsTable.id, request.itemId));
    if (item) {
      const [player] = await db.select().from(playersTable).where(eq(playersTable.id, request.playerId));
      if (player) {
        await db.update(playersTable).set({ balance: player.balance + item.cost }).where(eq(playersTable.id, player.id));
      }
    }
  }

  const [updated] = await db
    .update(redemptionRequestsTable)
    .set({ status: body.data.status, note: body.data.note ?? null })
    .where(eq(redemptionRequestsTable.id, id))
    .returning();

  const [item] = await db.select().from(redemptionItemsTable).where(eq(redemptionItemsTable.id, updated.itemId));
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, updated.playerId));

  res.json(fmtRequest(updated, item as any, player as any));
});

// ── Formatters ─────────────────────────────────────────────────────────────
function fmt(item: any) {
  return { ...item, createdAt: item.createdAt?.toISOString() };
}

function fmtRequest(req: any, item: any, player: any) {
  return {
    id: req.id,
    status: req.status,
    note: req.note ?? null,
    createdAt: req.createdAt?.toISOString(),
    playerId: req.playerId,
    playerName: player?.name ?? null,
    itemId: req.itemId,
    itemName: item?.name ?? null,
    itemDescription: item?.description ?? null,
    itemCost: item?.cost ?? null,
  };
}

export default router;
