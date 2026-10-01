/**
 * Transaction ingestion: provider events in, one canonical purchase and one
 * round-up entry out — however many times, and in whatever order, the
 * provider delivers them.
 *
 * Reading a transaction never moves money. A tracked round-up is a number
 * waiting for the user's weekly approval, not a balance.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import {
  adjustments,
  connections,
  preferences,
  purchases,
  roundupEntries,
  transactionEvents,
  users,
  weeklyBatches,
  type EntryStatus,
  type Env,
} from "@/db/schema";
import { POLICY } from "@/config/policy";
import { audit } from "./audit";
import { openBatchFor, refreeze } from "./batches";
import { roundUpCents } from "./money";

export type ProviderEventType =
  | "transaction.pending"
  | "transaction.posted"
  | "transaction.refunded"
  | "transaction.reversed"
  | "transaction.removed";

export interface ProviderEvent {
  provider: string;
  /** The provider's unique id for this delivery. */
  eventId: string;
  type: ProviderEventType;
  occurredAt: Date;
  /** The provider's reference for the linked account. */
  connectionRef: string;
  transaction: {
    id: string;
    /** For a posted transaction: the id of the pending authorization it replaces. */
    pendingId?: string | null;
    merchant: string;
    amountCents: number;
    currency: string;
    /** "purchase" is the only category that can round up. */
    category: string;
    authorizedAt: Date;
    postedAt?: Date | null;
  };
}

export type IngestOutcome = "applied" | "duplicate" | "stale" | "ignored";

/** Why a purchase does not round up. Keys are stored; text is shown to the user. */
export const EXCLUSION_REASONS: Record<string, string> = {
  exact_dollar: "The purchase was a whole-dollar amount, so there was nothing to round up.",
  not_a_purchase: "Transfers, fees, funding movements, investments and income are not purchases.",
  unsupported_currency: `Only ${POLICY.currency} purchases round up for now.`,
  over_weekly_cap: "This round-up would have gone over your weekly cap, so it was left out.",
  tracking_paused: "Tracking was paused when this purchase posted.",
  tracking_not_active: "This purchase posted before tracking was activated.",
  purchase_refunded: "The purchase was refunded before the weekly approval.",
  purchase_reversed: "The purchase was reversed before the weekly approval.",
  pending_dropped: "The pending authorization was dropped and never posted.",
};

function envOfProvider(provider: string): Env {
  return provider.startsWith("demo-") ? "demo" : "live";
}

type Purchase = typeof purchases.$inferSelect;

/** Static eligibility: everything that does not depend on the weekly cap. */
function ineligibility(p: { category: string; currency: string; amountCents: number }): string | null {
  if (p.category !== "purchase" || p.amountCents <= 0) return "not_a_purchase";
  if (p.currency !== POLICY.currency) return "unsupported_currency";
  if (roundUpCents(p.amountCents) === 0) return "exact_dollar";
  return null;
}

async function upsertEntry(tx: Tx, purchase: Purchase, values: { status: EntryStatus; amountCents: number; reason: string | null; batchId: string | null }, now: Date) {
  await tx
    .insert(roundupEntries)
    .values({ purchaseId: purchase.id, userId: purchase.userId, ...values })
    .onConflictDoUpdate({ target: roundupEntries.purchaseId, set: { ...values, updatedAt: now } });
}

/** A purchase has settled: decide whether its round-up is tracked, and in which batch. */
async function evaluatePosted(tx: Tx, purchase: Purchase, now: Date): Promise<void> {
  const [user] = await tx.select().from(users).where(eq(users.id, purchase.userId));
  const [prefs] = await tx.select().from(preferences).where(eq(preferences.userId, purchase.userId));
  const amount = purchase.currency === POLICY.currency && purchase.amountCents > 0 ? roundUpCents(purchase.amountCents) : 0;
  const exclude = (reason: string) => upsertEntry(tx, purchase, { status: "excluded", amountCents: amount, reason, batchId: null }, now);

  const staticReason = ineligibility(purchase);
  if (staticReason) return exclude(staticReason);
  const postedAt = purchase.postedAt ?? now;
  if (!prefs?.trackingActivatedAt || postedAt < prefs.trackingActivatedAt) return exclude("tracking_not_active");
  if (prefs.paused) return exclude("tracking_paused");

  const batch = await openBatchFor(tx, user, postedAt, now);
  // The cap is enforced here, on the server, against this week's own round-ups.
  const [{ sum }] = await tx
    .select({ sum: sql<number>`coalesce(sum(${roundupEntries.amountCents}), 0)::int` })
    .from(roundupEntries)
    .where(and(eq(roundupEntries.batchId, batch.id), eq(roundupEntries.status, "tracked"), isNull(roundupEntries.carriedFromBatchId)));
  if (sum + amount > prefs.weeklyCapCents) return exclude("over_weekly_cap");
  await upsertEntry(tx, purchase, { status: "tracked", amountCents: amount, reason: null, batchId: batch.id }, now);
}

async function applyReversal(tx: Tx, purchase: Purchase, status: "refunded" | "reversed", now: Date): Promise<void> {
  const [entry] = await tx.select().from(roundupEntries).where(eq(roundupEntries.purchaseId, purchase.id));
  if (!entry) return;
  const reason = `purchase_${status}`;
  if (entry.status === "pending") {
    await tx.update(roundupEntries).set({ status: "excluded", reason, updatedAt: now }).where(eq(roundupEntries.id, entry.id));
    return;
  }
  if (entry.status !== "tracked" || !entry.batchId) return;
  const [batch] = await tx.select().from(weeklyBatches).where(eq(weeklyBatches.id, entry.batchId)).for("update");
  if (batch.status === "tracking" || batch.status === "ready_for_approval") {
    // Not approved yet: the round-up simply leaves the batch.
    await tx.update(roundupEntries).set({ status: "reversed", reason, updatedAt: now }).where(eq(roundupEntries.id, entry.id));
    await refreeze(tx, batch, now);
    return;
  }
  // Approved or beyond: history stays as it happened. No sale, no extra charge.
  await tx
    .insert(adjustments)
    .values({ userId: purchase.userId, purchaseId: purchase.id, batchId: batch.id, amountCents: entry.amountCents, policy: POLICY.postApprovalReversalPolicy })
    .onConflictDoNothing();
  await audit(tx, purchase.env, { type: "provider", id: purchase.provider }, "adjustment.recorded", { type: "purchase", id: purchase.id }, {
    batchId: batch.id,
    amountCents: entry.amountCents,
    policy: POLICY.postApprovalReversalPolicy,
  });
}

async function apply(tx: Tx, ev: ProviderEvent, conn: typeof connections.$inferSelect, now: Date): Promise<{ outcome: IngestOutcome; detail?: string }> {
  const t = ev.transaction;
  const ids = [t.id, ...(t.pendingId ? [t.pendingId] : [])];
  const [existing] = await tx
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.provider, ev.provider),
        or(...ids.flatMap((id) => [eq(purchases.externalId, id), eq(purchases.pendingExternalId, id)])),
      ),
    )
    .for("update");
  if (existing && existing.userId !== conn.userId) return { outcome: "ignored", detail: "transaction belongs to another connection" };

  const base = {
    userId: conn.userId,
    env: conn.env,
    connectionId: conn.id,
    provider: ev.provider,
    externalId: t.id,
    merchant: t.merchant,
    amountCents: t.amountCents,
    currency: t.currency,
    category: t.category,
    authorizedAt: t.authorizedAt,
    lastEventAt: ev.occurredAt,
  };

  switch (ev.type) {
    case "transaction.pending": {
      if (existing) {
        if (existing.status !== "pending") return { outcome: "stale", detail: `already ${existing.status}` };
        if (ev.occurredAt <= existing.lastEventAt) return { outcome: "stale", detail: "older than the last update" };
        await tx.update(purchases).set({ merchant: t.merchant, amountCents: t.amountCents, lastEventAt: ev.occurredAt }).where(eq(purchases.id, existing.id));
        return { outcome: "applied" };
      }
      const [row] = await tx.insert(purchases).values({ ...base, status: "pending" }).returning();
      const reason = ineligibility(row);
      // Pending purchases are shown but never counted: only settled purchases round up.
      await upsertEntry(tx, row, { status: reason ? "excluded" : "pending", amountCents: reason ? 0 : roundUpCents(row.amountCents), reason, batchId: null }, now);
      return { outcome: "applied" };
    }

    case "transaction.posted": {
      const postedAt = t.postedAt ?? ev.occurredAt;
      let row: Purchase;
      if (existing) {
        if (existing.status === "refunded" || existing.status === "reversed") return { outcome: "stale", detail: `already ${existing.status}` };
        if (existing.status === "posted") return { outcome: "stale", detail: "already posted" };
        // Pending (or dropped pending) becomes posted: same row, never a second one.
        [row] = await tx
          .update(purchases)
          .set({
            status: "posted",
            externalId: t.id,
            pendingExternalId: existing.externalId !== t.id ? existing.externalId : existing.pendingExternalId,
            merchant: t.merchant,
            amountCents: t.amountCents,
            currency: t.currency,
            category: t.category,
            postedAt,
            lastEventAt: ev.occurredAt,
          })
          .where(eq(purchases.id, existing.id))
          .returning();
      } else {
        [row] = await tx.insert(purchases).values({ ...base, status: "posted", postedAt, pendingExternalId: t.pendingId ?? null }).returning();
      }
      await evaluatePosted(tx, row, now);
      return { outcome: "applied" };
    }

    case "transaction.refunded":
    case "transaction.reversed": {
      const status = ev.type === "transaction.refunded" ? "refunded" : "reversed";
      if (!existing) {
        // The reversal overtook the purchase. Record it so the late purchase event is recognised as stale.
        const [row] = await tx.insert(purchases).values({ ...base, status }).returning();
        await upsertEntry(tx, row, { status: "excluded", amountCents: 0, reason: `purchase_${status}`, batchId: null }, now);
        return { outcome: "applied", detail: "recorded before the purchase arrived" };
      }
      if (existing.status === "refunded" || existing.status === "reversed") return { outcome: "stale", detail: `already ${existing.status}` };
      await tx.update(purchases).set({ status, lastEventAt: ev.occurredAt }).where(eq(purchases.id, existing.id));
      await applyReversal(tx, existing, status, now);
      return { outcome: "applied" };
    }

    case "transaction.removed": {
      if (!existing || existing.status !== "pending") return { outcome: "stale", detail: "no pending authorization to drop" };
      await tx.update(purchases).set({ status: "void", lastEventAt: ev.occurredAt }).where(eq(purchases.id, existing.id));
      await tx.update(roundupEntries).set({ status: "excluded", reason: "pending_dropped", updatedAt: now }).where(eq(roundupEntries.purchaseId, existing.id));
      return { outcome: "applied" };
    }
  }
}

export async function ingestEvent(db: Db, ev: ProviderEvent, now: Date): Promise<{ outcome: IngestOutcome; detail?: string }> {
  if (!Number.isInteger(ev.transaction.amountCents)) throw new RangeError("amountCents must be an integer");
  return db.transaction(async (tx) => {
    const env = envOfProvider(ev.provider);
    // First writer wins: a re-delivered event id inserts nothing and changes nothing.
    const inserted = await tx
      .insert(transactionEvents)
      .values({
        env,
        provider: ev.provider,
        externalEventId: ev.eventId,
        type: ev.type,
        occurredAt: ev.occurredAt,
        payload: JSON.parse(JSON.stringify(ev)),
      })
      .onConflictDoNothing()
      .returning({ id: transactionEvents.id });
    if (inserted.length === 0) return { outcome: "duplicate" as const };

    const [conn] = await tx
      .select()
      .from(connections)
      .where(and(eq(connections.provider, ev.provider), eq(connections.externalRef, ev.connectionRef)));
    let result: { outcome: IngestOutcome; detail?: string };
    if (!conn || conn.kind !== "transaction_source" || conn.env !== env) result = { outcome: "ignored", detail: "no matching transaction connection" };
    else if (conn.status !== "active") result = { outcome: "ignored", detail: "connection is disconnected" };
    else result = await apply(tx, ev, conn, now);

    await tx.update(transactionEvents).set({ outcome: result.outcome, detail: result.detail ?? null }).where(eq(transactionEvents.id, inserted[0].id));
    return result;
  });
}
