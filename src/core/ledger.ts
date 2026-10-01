/**
 * Double-entry ledger. Balances shown anywhere in the product are derived
 * from these rows, never from UI state.
 *
 * Sign convention: positive = debit, negative = credit.
 *
 * Accounts
 *   clearing:funds_held   money collected from the user, held for their order (asset)
 *   user:funds            what SPARE owes the user in cash until the order fills (liability)
 *   revenue:fees          SPARE fees
 *   clearing:tokens       tokens bought, not yet delivered (asset)
 *   user:tokens_owed      tokens SPARE owes the user until delivery (liability)
 *
 * Tracked round-ups are NOT in the ledger: until funding succeeds no money has moved.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ledgerEntries, type Env } from "@/db/schema";

export interface JournalLine {
  account: string;
  unit: string;
  amount: bigint;
}

export async function postJournal(
  tx: DbOrTx,
  journal: { key: string; userId: string; env: Env; batchId?: string | null; memo: string; lines: JournalLine[] },
): Promise<void> {
  const sums = new Map<string, bigint>();
  for (const line of journal.lines) sums.set(line.unit, (sums.get(line.unit) ?? 0n) + line.amount);
  for (const [unit, sum] of sums) {
    if (sum !== 0n) throw new Error(`Unbalanced journal ${journal.key}: ${unit} sums to ${sum}`);
  }
  const lines = journal.lines.filter((l) => l.amount !== 0n);
  if (lines.length === 0) return;
  const journalId = randomUUID();
  // The unique (journal_key, account, unit) index makes a replayed step a no-op.
  await tx
    .insert(ledgerEntries)
    .values(
      lines.map((l) => ({
        journalId,
        journalKey: journal.key,
        userId: journal.userId,
        env: journal.env,
        batchId: journal.batchId ?? null,
        account: l.account,
        unit: l.unit,
        amount: l.amount.toString(),
        memo: journal.memo,
      })),
    )
    .onConflictDoNothing();
}

export async function accountBalance(db: DbOrTx, userId: string, account: string, unit: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::text` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.account, account), eq(ledgerEntries.unit, unit)));
  return BigInt(row?.total ?? "0");
}
