import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

const STARTING_BALANCE_KEY = "starting_balance";
const DEFAULT_STARTING_BALANCE = 0;

export async function getStartingBalance(): Promise<number> {
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, STARTING_BALANCE_KEY))
    .limit(1);
  if (!row) return DEFAULT_STARTING_BALANCE;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STARTING_BALANCE;
}

export async function setStartingBalance(amount: number): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: STARTING_BALANCE_KEY, value: String(amount) })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: String(amount) },
    });
}
