/** Read models for the user-facing pages. Everything is scoped to one user id. */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  adjustments,
  approvals,
  connections,
  fundingAttempts,
  orders,
  purchases,
  quotes,
  roundupEntries,
  settlements,
  users,
  weeklyBatches,
  type BatchStatus,
} from "@/db/schema";
import { instrumentBySymbol } from "@/config/instruments";
import { POLICY } from "@/config/policy";
import { loadAccount } from "./accounts";
import type { AdapterResolver } from "./adapters";
import { approvalStatement, destinationFor } from "./batches";
import { tokensForNotional, valueCents } from "./money";
import { weekEndInstant, weekStartFor } from "./weeks";

type User = typeof users.$inferSelect;

/** Batches where the user's approval has set something in motion. */
export const IN_FLIGHT: BatchStatus[] = ["approved", "funding_pending", "funded", "order_pending", "executed", "settlement_pending", "refund_pending"];
export const NEEDS_USER: BatchStatus[] = ["ready_for_approval", "funding_failed", "order_failed"];

export async function trackedTotal(db: Db, batchId: string): Promise<{ total: number; ownWeek: number; count: number }> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${roundupEntries.amountCents}), 0)::int`,
      ownWeek: sql<number>`coalesce(sum(${roundupEntries.amountCents}) filter (where ${roundupEntries.carriedFromBatchId} is null), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(roundupEntries)
    .where(and(eq(roundupEntries.batchId, batchId), eq(roundupEntries.status, "tracked")));
  return row;
}

export async function listActivity(db: Db, userId: string, opts: { limit?: number; batchId?: string } = {}) {
  const where = opts.batchId ? and(eq(purchases.userId, userId), eq(roundupEntries.batchId, opts.batchId), eq(roundupEntries.status, "tracked")) : eq(purchases.userId, userId);
  return db
    .select({
      id: purchases.id,
      merchant: purchases.merchant,
      amountCents: purchases.amountCents,
      currency: purchases.currency,
      category: purchases.category,
      status: purchases.status,
      at: sql<Date>`coalesce(${purchases.postedAt}, ${purchases.authorizedAt})`.mapWith(purchases.authorizedAt),
      entryStatus: roundupEntries.status,
      roundupCents: roundupEntries.amountCents,
      reason: roundupEntries.reason,
      carried: sql<boolean>`${roundupEntries.carriedFromBatchId} is not null`,
      adjusted: sql<boolean>`${adjustments.id} is not null`,
    })
    .from(purchases)
    .innerJoin(roundupEntries, eq(roundupEntries.purchaseId, purchases.id))
    .leftJoin(adjustments, eq(adjustments.purchaseId, purchases.id))
    .where(where)
    .orderBy(desc(purchases.lastEventAt))
    .limit(opts.limit ?? 200);
}

export async function listBatches(db: Db, userId: string) {
  return db.select().from(weeklyBatches).where(eq(weeklyBatches.userId, userId)).orderBy(desc(weeklyBatches.weekStart));
}

export interface Holding {
  symbol: string;
  company: string;
  decimals: number;
  settledQty: bigint;
  pendingQty: bigint;
  price: { price: string; asOf: Date; source: string } | null;
  valueCents: number | null;
}

/** Settled tokens per instrument, with tokens bought but not yet delivered kept apart. */
export async function getHoldings(db: Db, resolve: AdapterResolver, user: User): Promise<Holding[]> {
  const rows = await db
    .select({ symbol: settlements.instrumentSymbol, status: settlements.status, qty: settlements.qty })
    .from(settlements)
    .where(eq(settlements.userId, user.id));
  // A filled order with no settlement row yet is also "bought, not delivered".
  const filled = await db
    .select({ symbol: orders.instrumentSymbol, qty: orders.filledQty })
    .from(orders)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, orders.batchId))
    .leftJoin(settlements, eq(settlements.orderId, orders.id))
    .where(and(eq(weeklyBatches.userId, user.id), eq(orders.status, "filled"), isNull(settlements.id)));

  const by = new Map<string, { settled: bigint; pending: bigint }>();
  const slot = (s: string) => by.get(s) ?? by.set(s, { settled: 0n, pending: 0n }).get(s)!;
  for (const r of rows) {
    if (r.status === "settled") slot(r.symbol).settled += BigInt(r.qty);
    else slot(r.symbol).pending += BigInt(r.qty);
  }
  for (const r of filled) slot(r.symbol).pending += BigInt(r.qty ?? "0");

  const prices = resolve(user.env).prices;
  return Promise.all(
    [...by.entries()].map(async ([symbol, q]) => {
      const instrument = instrumentBySymbol(symbol);
      const decimals = instrument?.decimals ?? 18;
      const price = q.settled > 0n ? await prices.quote(symbol) : null;
      return {
        symbol,
        company: instrument?.company ?? symbol,
        decimals,
        settledQty: q.settled,
        pendingQty: q.pending,
        price,
        valueCents: price ? valueCents(q.settled, price.price, decimals) : null,
      };
    }),
  );
}

/** Everything the weekly review screen shows for one batch. */
export async function getReview(db: Db, resolve: AdapterResolver, user: User, batchId: string) {
  const [batch] = await db.select().from(weeklyBatches).where(and(eq(weeklyBatches.id, batchId), eq(weeklyBatches.userId, user.id)));
  if (!batch) return null;
  const adapters = resolve(user.env);
  const account = await loadAccount(db, user.id);
  const [approval] = await db.select().from(approvals).where(eq(approvals.batchId, batch.id));
  const entries = await listActivity(db, user.id, { batchId: batch.id });
  const funding = await db.select().from(fundingAttempts).where(eq(fundingAttempts.batchId, batch.id)).orderBy(fundingAttempts.createdAt);
  const orderRows = await db.select().from(orders).where(eq(orders.batchId, batch.id)).orderBy(orders.createdAt);
  const [settlement] = await db.select().from(settlements).where(eq(settlements.batchId, batch.id));
  const [savedQuote] = await db.select().from(quotes).where(eq(quotes.batchId, batch.id)).orderBy(desc(quotes.createdAt)).limit(1);

  let estimate: { price: string; asOf: Date; source: string; qty: bigint } | null = null;
  const symbol = batch.instrumentSymbol;
  if (batch.status === "ready_for_approval" && symbol && batch.totalCents) {
    const q = await adapters.prices.quote(symbol);
    const instrument = instrumentBySymbol(symbol);
    if (q && instrument) estimate = { ...q, qty: tokensForNotional(batch.totalCents, q.price, instrument.decimals) };
  }

  const destination = destinationFor(user);
  const statement =
    batch.status === "ready_for_approval" && account.fundingMethod && symbol
      ? approvalStatement({
          authorizedCents: batch.authorizedCents!,
          roundupCents: batch.totalCents!,
          feeCents: batch.feeCents!,
          fundingLabel: account.fundingMethod.label,
          symbol,
          destination,
          weekStart: batch.weekStart,
        })
      : (approval?.statement ?? null);

  return {
    batch,
    approval: approval ?? null,
    entries,
    fundingAttempts: funding,
    orders: orderRows,
    settlement: settlement ?? null,
    savedQuote: savedQuote ?? null,
    estimate,
    statement,
    destination,
    fundingMethod: account.fundingMethod,
    execution: { label: adapters.execution.label, method: adapters.execution.method, available: symbol ? adapters.execution.supports(symbol) : false, reason: adapters.execution.availability().reason },
    fundingAvailable: adapters.funding.availability(),
    ordersLeft: POLICY.maxOrderAttempts - orderRows.length,
  };
}

/** The batch the weekly-review page should open on: one that needs the user, else one in flight, else the latest closed. */
export async function reviewTarget(db: Db, userId: string) {
  const all = await listBatches(db, userId);
  return (
    all.filter((b) => NEEDS_USER.includes(b.status)).at(-1) ??
    all.find((b) => IN_FLIGHT.includes(b.status)) ??
    all.find((b) => b.status !== "tracking") ??
    null
  );
}

export async function getOverview(db: Db, resolve: AdapterResolver, user: User, now: Date) {
  const account = await loadAccount(db, user.id);
  const batches = await listBatches(db, user.id);
  const tracking = batches.filter((b) => b.status === "tracking").at(-1) ?? null;
  const tracked = tracking ? await trackedTotal(db, tracking.id) : { total: 0, ownWeek: 0, count: 0 };
  const cap = account.prefs.weeklyCapCents;
  const week = tracking?.weekStart ?? weekStartFor(now, user.timezone);
  const nextCutoff = tracking?.endsAt ?? weekEndInstant(week, user.timezone);
  const attention = batches.filter((b) => NEEDS_USER.includes(b.status)).at(-1) ?? null;
  const inFlight = batches.find((b) => IN_FLIGHT.includes(b.status)) ?? null;
  const latestClosed = batches.find((b) => b.status !== "tracking") ?? null;
  const holdings = await getHoldings(db, resolve, user);
  const recent = await listActivity(db, user.id, { limit: 6 });
  const pendingCount = (
    await db
      .select({ id: roundupEntries.id })
      .from(roundupEntries)
      .where(and(eq(roundupEntries.userId, user.id), eq(roundupEntries.status, "pending")))
  ).length;
  return {
    ...account,
    tracking,
    weekStart: week,
    trackedCents: tracked.total,
    trackedCount: tracked.count,
    carriedCents: tracked.total - tracked.ownWeek,
    capCents: cap,
    capRemainingCents: Math.max(0, cap - tracked.ownWeek),
    nextCutoff,
    attention,
    inFlight,
    latestClosed,
    holdings,
    recent,
    pendingCount,
  };
}

export async function connectionHistory(db: Db, userId: string) {
  return db.select().from(connections).where(eq(connections.userId, userId)).orderBy(desc(connections.createdAt));
}


