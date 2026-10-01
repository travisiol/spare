/**
 * Operator read models, reconciliation and the few actions an operator may take.
 *
 * An operator can re-run a stuck job, retry an order with funds already
 * collected, or send those funds back. An operator cannot approve a batch or
 * start a charge: collection only ever follows the user's own approval record.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  approvals,
  auditEvents,
  connections,
  fundingAttempts,
  jobs,
  ledgerEntries,
  orders,
  settlements,
  transactionEvents,
  users,
  weeklyBatches,
  type Env,
} from "@/db/schema";
import { INSTRUMENTS } from "@/config/instruments";
import { POLICY } from "@/config/policy";
import type { AdapterResolver } from "./adapters";
import { audit, type Actor } from "./audit";
import { requeueDeadJob } from "./jobs";

export interface ReconciliationException {
  kind: string;
  subject: string;
  detail: string;
}

const STUCK_MS = 10 * 60_000;

/** Compares the ledger with the operational records and lists everything that does not line up. */
export async function reconcile(db: Db, env: Env, now: Date): Promise<ReconciliationException[]> {
  const out: ReconciliationException[] = [];

  const unbalanced = await db
    .select({ journalKey: ledgerEntries.journalKey, unit: ledgerEntries.unit, sum: sql<string>`sum(${ledgerEntries.amount})::text` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.env, env))
    .groupBy(ledgerEntries.journalKey, ledgerEntries.unit)
    .having(sql`sum(${ledgerEntries.amount}) <> 0`);
  for (const j of unbalanced) out.push({ kind: "unbalanced_journal", subject: j.journalKey, detail: `${j.unit} sums to ${j.sum}` });

  // Cash held for users must equal what is collected and not yet spent or returned.
  const held = await db
    .select({ userId: ledgerEntries.userId, sum: sql<string>`(-sum(${ledgerEntries.amount}))::text` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.env, env), eq(ledgerEntries.account, "user:funds"), eq(ledgerEntries.unit, "USD")))
    .groupBy(ledgerEntries.userId);
  const expected = await db
    .select({ userId: weeklyBatches.userId, sum: sql<string>`sum(${approvals.authorizedCents})::text` })
    .from(weeklyBatches)
    .innerJoin(approvals, eq(approvals.batchId, weeklyBatches.id))
    .where(and(eq(weeklyBatches.env, env), inArray(weeklyBatches.status, ["funded", "order_pending", "order_failed", "refund_pending"])))
    .groupBy(weeklyBatches.userId);
  const expectedBy = new Map(expected.map((e) => [e.userId, BigInt(e.sum)]));
  const seen = new Set<string>();
  for (const h of held) {
    seen.add(h.userId);
    const want = expectedBy.get(h.userId) ?? 0n;
    if (BigInt(h.sum) !== want) out.push({ kind: "funds_mismatch", subject: h.userId, detail: `ledger holds ${h.sum}¢, batches expect ${want}¢` });
  }
  for (const [userId, want] of expectedBy) {
    if (!seen.has(userId) && want !== 0n) out.push({ kind: "funds_mismatch", subject: userId, detail: `ledger holds 0¢, batches expect ${want}¢` });
  }

  // Tokens owed must equal filled orders that are not yet delivered.
  const owed = await db
    .select({ userId: ledgerEntries.userId, unit: ledgerEntries.unit, sum: sql<string>`(-sum(${ledgerEntries.amount}))::text` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.env, env), eq(ledgerEntries.account, "user:tokens_owed")))
    .groupBy(ledgerEntries.userId, ledgerEntries.unit);
  const undelivered = await db
    .select({ userId: weeklyBatches.userId, unit: orders.instrumentSymbol, sum: sql<string>`sum(${orders.filledQty}::numeric)::text` })
    .from(orders)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, orders.batchId))
    .where(and(eq(orders.env, env), eq(orders.status, "filled"), inArray(weeklyBatches.status, ["executed", "settlement_pending"])))
    .groupBy(weeklyBatches.userId, orders.instrumentSymbol);
  const undeliveredBy = new Map(undelivered.map((u) => [`${u.userId}:${u.unit}`, BigInt(u.sum)]));
  for (const o of owed) {
    const want = undeliveredBy.get(`${o.userId}:${o.unit}`) ?? 0n;
    if (BigInt(o.sum) !== want) out.push({ kind: "tokens_mismatch", subject: `${o.userId} ${o.unit}`, detail: `ledger owes ${o.sum}, orders expect ${want}` });
  }

  const cutoff = new Date(now.getTime() - STUCK_MS);
  const uncertainFunding = await db
    .select({ id: fundingAttempts.id, status: fundingAttempts.status, error: fundingAttempts.error })
    .from(fundingAttempts)
    .where(and(eq(fundingAttempts.env, env), inArray(fundingAttempts.status, ["created", "uncertain", "pending"]), lt(fundingAttempts.updatedAt, cutoff)));
  for (const a of uncertainFunding) out.push({ kind: "funding_unresolved", subject: a.id, detail: `${a.status}${a.error ? `: ${a.error}` : ""}` });

  const uncertainOrders = await db
    .select({ id: orders.id, status: orders.status, error: orders.error })
    .from(orders)
    .where(and(eq(orders.env, env), inArray(orders.status, ["created", "uncertain", "pending"]), lt(orders.updatedAt, cutoff)));
  for (const o of uncertainOrders) out.push({ kind: "order_unresolved", subject: o.id, detail: `${o.status}${o.error ? `: ${o.error}` : ""}` });

  const stuckSettlements = await db
    .select({ id: settlements.id, status: settlements.status, error: settlements.error })
    .from(settlements)
    .where(and(eq(settlements.env, env), inArray(settlements.status, ["created", "uncertain", "pending", "failed"]), lt(settlements.updatedAt, cutoff)));
  for (const s of stuckSettlements) out.push({ kind: "settlement_unresolved", subject: s.id, detail: `${s.status}${s.error ? `: ${s.error}` : ""}` });

  const failedOrders = await db
    .select({ id: weeklyBatches.id })
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.env, env), eq(weeklyBatches.status, "order_failed")));
  for (const b of failedOrders) out.push({ kind: "funds_held_after_failed_order", subject: b.id, detail: "Collected funds are held. Retry the order or refund." });

  return out;
}

export async function adminOverview(db: Db, resolve: AdapterResolver, env: Env, now: Date) {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const adapters = resolve(env);
  const [connectionRows, eventOutcomes, batchRows, fundingRows, orderRows, settlementRows, deadJobs, queuedJobs, auditRows, exceptions] = await Promise.all([
    db
      .select({ kind: connections.kind, provider: connections.provider, status: connections.status, n })
      .from(connections)
      .where(eq(connections.env, env))
      .groupBy(connections.kind, connections.provider, connections.status),
    db
      .select({ outcome: transactionEvents.outcome, n, last: sql<Date | null>`max(${transactionEvents.receivedAt})`.mapWith(transactionEvents.receivedAt) })
      .from(transactionEvents)
      .where(eq(transactionEvents.env, env))
      .groupBy(transactionEvents.outcome),
    db
      .select({ batch: weeklyBatches, wallet: users.walletAddress })
      .from(weeklyBatches)
      .innerJoin(users, eq(users.id, weeklyBatches.userId))
      .where(eq(weeklyBatches.env, env))
      .orderBy(desc(weeklyBatches.updatedAt))
      .limit(40),
    db.select().from(fundingAttempts).where(eq(fundingAttempts.env, env)).orderBy(desc(fundingAttempts.createdAt)).limit(25),
    db.select().from(orders).where(eq(orders.env, env)).orderBy(desc(orders.createdAt)).limit(25),
    db.select().from(settlements).where(eq(settlements.env, env)).orderBy(desc(settlements.createdAt)).limit(25),
    db.select().from(jobs).where(eq(jobs.status, "dead")).orderBy(desc(jobs.updatedAt)).limit(25),
    count(db.select({ n }).from(jobs).where(inArray(jobs.status, ["queued", "running"]))),
    db
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.env, [env, "system"]))
      .orderBy(desc(auditEvents.createdAt))
      .limit(60),
    reconcile(db, env, now),
  ]);
  const userCount = await count(db.select({ n }).from(users).where(eq(users.env, env)));

  return {
    env,
    userCount,
    connections: connectionRows,
    events: eventOutcomes,
    batches: batchRows,
    funding: fundingRows,
    orders: orderRows,
    settlements: settlementRows,
    deadJobs,
    queuedJobs,
    audit: auditRows,
    exceptions,
    providers: [
      { role: "Transaction data", provider: adapters.transactions.provider, label: adapters.transactions.label, ...adapters.transactions.availability() },
      { role: "Funding", provider: adapters.funding.provider, label: adapters.funding.label, ...adapters.funding.availability() },
      { role: "Prices", provider: "prices", label: adapters.prices.label, available: true as boolean, reason: undefined as string | undefined },
      { role: "Execution", provider: adapters.execution.provider, label: adapters.execution.label, ...adapters.execution.availability() },
      { role: "Settlement", provider: adapters.settlement.provider, label: adapters.settlement.label, ...adapters.settlement.availability() },
    ],
    instruments: INSTRUMENTS.map((i) => ({ ...i, route: adapters.execution.supports(i.symbol) })),
    policy: POLICY,
  };
}

export async function adminRequeueJob(db: Db, actor: Actor, jobId: string, now: Date): Promise<boolean> {
  const changed = await requeueDeadJob(db, jobId, now);
  await audit(db, "system", actor, "admin.job_requeued", { type: "job", id: jobId }, { changed });
  return changed;
}
