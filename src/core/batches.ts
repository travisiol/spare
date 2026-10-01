/**
 * Weekly batches: opening, freezing at the cutoff, the user's approval and
 * the paths that end without a charge (decline, expiry, carry-forward).
 *
 * Once a batch leaves "tracking" its contents are closed: later purchases go
 * to a later batch. Once it is approved nothing about it can change.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { approvals, connections, fundingAttempts, orders, preferences, roundupEntries, users, weeklyBatches } from "@/db/schema";
import { feeFor, POLICY } from "@/config/policy";
import { instrumentBySymbol } from "@/config/instruments";
import type { AdapterResolver } from "./adapters";
import { audit, SYSTEM, type Actor } from "./audit";
import { DomainError } from "./errors";
import { enqueue } from "./jobs";
import { formatUsd } from "./money";
import { addDays, weekEndInstant, weekStartFor } from "./weeks";

type Batch = typeof weeklyBatches.$inferSelect;

export async function lockBatch(tx: Tx, batchId: string): Promise<Batch> {
  const [batch] = await tx.select().from(weeklyBatches).where(eq(weeklyBatches.id, batchId)).for("update");
  if (!batch) throw new DomainError("not_found", "That weekly batch does not exist.", 404);
  return batch;
}

/**
 * The batch a purchase posted at `postedAt` belongs to: its own week if that
 * week is still tracking, otherwise the earliest later week that is.
 */
export async function openBatchFor(tx: Tx, user: { id: string; env: "demo" | "live"; timezone: string }, postedAt: Date, now: Date): Promise<Batch> {
  let week = weekStartFor(postedAt, user.timezone);
  const currentWeek = weekStartFor(now, user.timezone);
  for (let i = 0; i < 60; i++) {
    await tx
      .insert(weeklyBatches)
      .values({ userId: user.id, env: user.env, weekStart: week, timezone: user.timezone, endsAt: weekEndInstant(week, user.timezone) })
      .onConflictDoNothing();
    const [batch] = await tx
      .select()
      .from(weeklyBatches)
      .where(and(eq(weeklyBatches.userId, user.id), eq(weeklyBatches.weekStart, week)))
      .for("update");
    if (batch.status === "tracking") return batch;
    week = currentWeek > week ? currentWeek : addDays(week, 7);
  }
  throw new Error("No open batch found");
}

async function trackedEntries(tx: Tx, batchId: string) {
  return tx
    .select({ id: roundupEntries.id, purchaseId: roundupEntries.purchaseId, amountCents: roundupEntries.amountCents })
    .from(roundupEntries)
    .where(and(eq(roundupEntries.batchId, batchId), eq(roundupEntries.status, "tracked")))
    .orderBy(asc(roundupEntries.purchaseId));
}

function snapshotHash(batchId: string, instrument: string, feeCents: number, entries: { purchaseId: string; amountCents: number }[]): string {
  const body = JSON.stringify([batchId, instrument, feeCents, entries.map((e) => [e.purchaseId, e.amountCents])]);
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Computes the frozen figures for a closed, unapproved batch — or ends it
 * without a charge when there is nothing (or too little) to invest.
 */
async function freeze(tx: Tx, batch: Batch, now: Date): Promise<Batch["status"]> {
  const [user] = await tx.select().from(users).where(eq(users.id, batch.userId));
  const [prefs] = await tx.select().from(preferences).where(eq(preferences.userId, batch.userId));
  const entries = await trackedEntries(tx, batch.id);
  const total = entries.reduce((sum, e) => sum + e.amountCents, 0);
  const instrument = batch.instrumentSymbol ?? prefs?.instrumentSymbol ?? null;

  if (total === 0 || !instrument) {
    const status = batch.status === "tracking" ? "empty" : "cancelled";
    await tx
      .update(weeklyBatches)
      .set({ status, totalCents: 0, failureReason: total === 0 ? "No eligible round-ups in this batch." : "No company was selected.", frozenAt: batch.frozenAt ?? now, updatedAt: now })
      .where(eq(weeklyBatches.id, batch.id));
    return status;
  }

  if (total < POLICY.minOrderCents) {
    // Below the provider minimum: nothing is charged, the round-ups move to the next batch.
    const next = await openBatchFor(tx, user, batch.endsAt, now);
    await tx
      .update(roundupEntries)
      .set({ batchId: next.id, carriedFromBatchId: sql`coalesce(${roundupEntries.carriedFromBatchId}, ${batch.id}::uuid)`, updatedAt: now })
      .where(and(eq(roundupEntries.batchId, batch.id), eq(roundupEntries.status, "tracked")));
    await tx
      .update(weeklyBatches)
      .set({ status: "carried_forward", totalCents: total, frozenAt: batch.frozenAt ?? now, failureReason: `Below the ${formatUsd(POLICY.minOrderCents)} minimum. Carried into the next week.`, updatedAt: now })
      .where(eq(weeklyBatches.id, batch.id));
    await audit(tx, batch.env, SYSTEM, "batch.carried_forward", { type: "batch", id: batch.id }, { totalCents: total, toBatch: next.id });
    return "carried_forward";
  }

  const feeCents = feeFor(total);
  await tx
    .update(weeklyBatches)
    .set({
      status: "ready_for_approval",
      instrumentSymbol: instrument,
      totalCents: total,
      feeCents,
      authorizedCents: total + feeCents,
      snapshotHash: snapshotHash(batch.id, instrument, feeCents, entries),
      frozenAt: batch.frozenAt ?? now,
      approveBy: batch.approveBy ?? new Date(now.getTime() + POLICY.approvalWindowHours * 3_600_000),
      updatedAt: now,
    })
    .where(eq(weeklyBatches.id, batch.id));
  return "ready_for_approval";
}

/** Closes one tracking batch at (or, in the demo, before) its cutoff. */
export async function closeBatch(db: Db, batchId: string, now: Date, actor: Actor = SYSTEM): Promise<Batch["status"]> {
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "tracking") return batch.status;
    const status = await freeze(tx, batch, now);
    await audit(tx, batch.env, actor, "batch.closed", { type: "batch", id: batch.id }, { status });
    return status;
  });
}

/** A reversal landed on a closed, unapproved batch: recompute what the user will be asked to approve. */
export async function refreeze(tx: Tx, batch: Batch, now: Date): Promise<void> {
  if (batch.status !== "ready_for_approval") return;
  await freeze(tx, batch, now);
}

/** The weekly cutoff: closes every tracking batch whose week has ended, expires stale approvals. */
export async function sweepBatches(db: Db, now: Date): Promise<{ closed: number; expired: number }> {
  const due = await db
    .select({ id: weeklyBatches.id })
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.status, "tracking"), lte(weeklyBatches.endsAt, now)));
  for (const b of due) await closeBatch(db, b.id, now);

  const stale = await db
    .select({ id: weeklyBatches.id })
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.status, "ready_for_approval"), lte(weeklyBatches.approveBy, now)));
  for (const b of stale) {
    await db.transaction(async (tx) => {
      const batch = await lockBatch(tx, b.id);
      if (batch.status !== "ready_for_approval") return;
      await tx
        .update(weeklyBatches)
        .set({ status: "expired", failureReason: "Not approved in time. Nothing was charged.", updatedAt: now })
        .where(eq(weeklyBatches.id, batch.id));
      await audit(tx, batch.env, SYSTEM, "batch.expired", { type: "batch", id: batch.id });
    });
  }
  return { closed: due.length, expired: stale.length };
}

export function approvalStatement(p: { authorizedCents: number; roundupCents: number; feeCents: number; fundingLabel: string; symbol: string; destination: string; weekStart: string }): string {
  return (
    `I authorize SPARE to collect ${formatUsd(p.authorizedCents)} once ` +
    `(round-ups ${formatUsd(p.roundupCents)} + fees ${formatUsd(p.feeCents)}) from "${p.fundingLabel}" ` +
    `to buy ${p.symbol} stock tokens delivered to ${p.destination}, for the week of ${p.weekStart}. ` +
    `This amount cannot change after I approve.`
  );
}

export function destinationFor(user: { env: "demo" | "live"; walletAddress: string | null }): string {
  return user.env === "demo" ? "the demo wallet (simulated)" : user.walletAddress!;
}

/**
 * The user's approval. It is bound to the exact snapshot they reviewed: if the
 * batch changed in between (a reversal landed), the approval is refused and
 * they review again.
 */
export async function approveBatch(
  db: Db,
  resolve: AdapterResolver,
  input: { userId: string; batchId: string; snapshotHash: string; fundingConnectionId: string },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, input.batchId);
    if (batch.userId !== input.userId) throw new DomainError("not_found", "That weekly batch does not exist.", 404);
    if (batch.status !== "ready_for_approval") throw new DomainError("not_approvable", "This batch is no longer waiting for approval.", 409);
    if (batch.approveBy && batch.approveBy <= now) throw new DomainError("expired", "The approval window for this batch has passed. Nothing was charged.", 409);
    if (batch.snapshotHash !== input.snapshotHash) {
      throw new DomainError("changed", "This batch changed since you opened it. Review the updated amount before approving.", 409);
    }
    const [user] = await tx.select().from(users).where(eq(users.id, batch.userId));
    const adapters = resolve(user.env);
    const symbol = batch.instrumentSymbol!;
    if (!instrumentBySymbol(symbol) || !adapters.execution.supports(symbol)) {
      throw new DomainError("no_route", `${symbol} cannot be bought right now: ${adapters.execution.availability().reason ?? "no supported execution route."}`, 409);
    }
    if (!adapters.funding.availability().available) {
      throw new DomainError("no_funding", adapters.funding.availability().reason ?? "Funding is unavailable.", 409);
    }
    const [conn] = await tx.select().from(connections).where(eq(connections.id, input.fundingConnectionId));
    if (!conn || conn.userId !== user.id || conn.kind !== "funding" || conn.status !== "active" || conn.provider !== adapters.funding.provider) {
      throw new DomainError("funding_connection", "Connect a funding method before approving.", 409);
    }
    const destination = destinationFor(user);
    await tx.insert(approvals).values({
      batchId: batch.id,
      userId: user.id,
      roundupCents: batch.totalCents!,
      feeCents: batch.feeCents!,
      authorizedCents: batch.authorizedCents!,
      instrumentSymbol: symbol,
      fundingConnectionId: conn.id,
      destination,
      snapshotHash: batch.snapshotHash!,
      statement: approvalStatement({
        authorizedCents: batch.authorizedCents!,
        roundupCents: batch.totalCents!,
        feeCents: batch.feeCents!,
        fundingLabel: conn.label,
        symbol,
        destination,
        weekStart: batch.weekStart,
      }),
    });
    await tx.update(weeklyBatches).set({ status: "approved", approvedAt: now, failureReason: null, updatedAt: now }).where(eq(weeklyBatches.id, batch.id));
    await enqueue(tx, "batch.fund", `fund:${batch.id}:1`, { batchId: batch.id }, now);
    await audit(tx, batch.env, { type: "user", id: user.id }, "batch.approved", { type: "batch", id: batch.id }, { authorizedCents: batch.authorizedCents, symbol });
  });
}

export async function declineBatch(db: Db, userId: string, batchId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.userId !== userId) throw new DomainError("not_found", "That weekly batch does not exist.", 404);
    if (batch.status !== "ready_for_approval") throw new DomainError("not_approvable", "This batch is no longer waiting for approval.", 409);
    await tx.update(weeklyBatches).set({ status: "cancelled", failureReason: "You skipped this week. Nothing was charged.", updatedAt: now }).where(eq(weeklyBatches.id, batch.id));
    await audit(tx, batch.env, { type: "user", id: userId }, "batch.declined", { type: "batch", id: batch.id });
  });
}

/**
 * Retries collection after a definitive failure. Only the batch's owner can
 * ask for it — an administrator cannot start a charge. The amount is the one
 * already approved; the unique index on funding_attempts refuses a second
 * live attempt.
 */
export async function retryFunding(db: Db, userId: string, batchId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.userId !== userId) throw new DomainError("not_found", "That weekly batch does not exist.", 404);
    if (batch.status !== "funding_failed") throw new DomainError("not_retryable", "This batch is not waiting for a funding retry.", 409);
    const attempts = await tx.select({ status: fundingAttempts.status }).from(fundingAttempts).where(eq(fundingAttempts.batchId, batch.id));
    if (attempts.some((a) => a.status !== "failed")) throw new DomainError("not_retryable", "An earlier funding attempt has not been resolved yet.", 409);
    await tx.update(weeklyBatches).set({ status: "approved", failureReason: null, updatedAt: now }).where(eq(weeklyBatches.id, batch.id));
    await enqueue(tx, "batch.fund", `fund:${batch.id}:${attempts.length + 1}`, { batchId: batch.id }, now);
    await audit(tx, batch.env, { type: "user", id: userId }, "funding.retry_requested", { type: "batch", id: batch.id });
  });
}

/** Tries the order again with the funds already collected. Never collects again. */
export async function retryOrder(db: Db, actor: Actor, batchId: string, now: Date, ownerId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (ownerId && batch.userId !== ownerId) throw new DomainError("not_found", "That weekly batch does not exist.", 404);
    if (batch.status !== "order_failed") throw new DomainError("not_retryable", "This batch is not waiting for an order retry.", 409);
    const previous = await tx.select({ status: orders.status }).from(orders).where(eq(orders.batchId, batch.id));
    if (previous.some((o) => o.status !== "failed")) throw new DomainError("not_retryable", "An earlier order has not been resolved yet.", 409);
    if (previous.length >= POLICY.maxOrderAttempts) {
      throw new DomainError("max_attempts", "The order has failed too many times. Request a refund instead.", 409);
    }
    await tx.update(weeklyBatches).set({ status: "funded", failureReason: null, updatedAt: now }).where(eq(weeklyBatches.id, batch.id));
    await enqueue(tx, "batch.execute", `execute:${batch.id}:${previous.length + 1}`, { batchId: batch.id }, now);
    await audit(tx, batch.env, actor, "order.retry_requested", { type: "batch", id: batch.id });
  });
}

/** Sends the collected amount back after a failed order. */
export async function requestRefund(db: Db, actor: Actor, batchId: string, now: Date, ownerId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (ownerId && batch.userId !== ownerId) throw new DomainError("not_found", "That weekly batch does not exist.", 404);
    if (batch.status !== "order_failed") throw new DomainError("not_refundable", "Only a funded batch whose order failed can be refunded.", 409);
    const [attempt] = await tx
      .select()
      .from(fundingAttempts)
      .where(and(eq(fundingAttempts.batchId, batch.id), eq(fundingAttempts.status, "succeeded")));
    if (!attempt) throw new DomainError("not_refundable", "No collected funds were found for this batch.", 409);
    await tx.update(fundingAttempts).set({ status: "refund_pending", updatedAt: now }).where(eq(fundingAttempts.id, attempt.id));
    await tx.update(weeklyBatches).set({ status: "refund_pending", updatedAt: now }).where(eq(weeklyBatches.id, batch.id));
    await enqueue(tx, "batch.refund", `refund:${attempt.id}`, { batchId: batch.id }, now);
    await audit(tx, batch.env, actor, "refund.requested", { type: "batch", id: batch.id }, { amountCents: attempt.amountCents });
  });
}

export async function currentTrackingBatch(tx: Tx, user: { id: string; env: "demo" | "live"; timezone: string }, now: Date): Promise<Batch> {
  return openBatchFor(tx, user, now, now);
}
