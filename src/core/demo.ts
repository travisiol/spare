/**
 * Demo data. Example purchases are delivered through the same ingestion path
 * a real provider uses — as events for the "demo-bank" provider — so the demo
 * exercises the real rules. The merchants are invented.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { connections, preferences, purchases, roundupEntries, transactionEvents, users, weeklyBatches, type DemoFlags } from "@/db/schema";
import { closeBatch } from "./batches";
import { DomainError } from "./errors";
import { ingestEvent, type ProviderEvent, type ProviderEventType } from "./ingest";

type User = typeof users.$inferSelect;

interface Fixture {
  slug: string;
  type: ProviderEventType;
  merchant: string;
  amountCents: number;
  currency?: string;
  category?: string;
  pendingSlug?: string;
}

/** The first week: three round-ups that add up to $1.42, plus one of each excluded kind. */
export const FIRST_WEEK: Fixture[] = [
  { slug: "coffee", type: "transaction.posted", merchant: "Harbor Coffee", amountCents: 463 },
  { slug: "groceries", type: "transaction.posted", merchant: "Greenway Market", amountCents: 3120 },
  { slug: "bus", type: "transaction.posted", merchant: "Metro Transit", amountCents: 275 },
  { slug: "parking", type: "transaction.posted", merchant: "Dockside Parking", amountCents: 500 },
  { slug: "transfer", type: "transaction.posted", merchant: "Transfer to savings", amountCents: 20000, category: "transfer" },
  { slug: "bookshop", type: "transaction.posted", merchant: "Librairie du Canal", amountCents: 1845, currency: "EUR" },
  { slug: "streaming-auth", type: "transaction.pending", merchant: "Northlight Streaming", amountCents: 999 },
];

/** A follow-up delivery: the pending purchase posts, and two more purchases arrive. */
export const MORE_PURCHASES: Fixture[] = [
  { slug: "streaming", type: "transaction.posted", merchant: "Northlight Streaming", amountCents: 999, pendingSlug: "streaming-auth" },
  { slug: "lunch", type: "transaction.posted", merchant: "Tamarind Kitchen", amountCents: 1240 },
  { slug: "pharmacy", type: "transaction.posted", merchant: "Elm Street Pharmacy", amountCents: 715 },
];

async function demoConnection(db: Db, user: User) {
  if (user.env !== "demo") throw new DomainError("demo_only", "Example purchases exist only in the demo.", 403);
  const [conn] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.userId, user.id), eq(connections.kind, "transaction_source"), eq(connections.status, "active")));
  if (!conn) throw new DomainError("no_connection", "Connect the demo card first.", 409);
  return conn;
}

async function deliver(db: Db, user: User, fixtures: Fixture[], round: number, now: Date): Promise<number> {
  const conn = await demoConnection(db, user);
  // Ids are deterministic per account and round, so a repeated delivery is recognised as a duplicate.
  const id = (slug: string, r: number) => `${user.id}:${r}:${slug}`;
  let applied = 0;
  for (const [i, f] of fixtures.entries()) {
    const at = new Date(now.getTime() + i);
    const ev: ProviderEvent = {
      provider: conn.provider,
      eventId: `evt:${id(f.slug, round)}`,
      type: f.type,
      occurredAt: at,
      connectionRef: conn.externalRef,
      transaction: {
        id: `txn:${id(f.slug, round)}`,
        pendingId: f.pendingSlug ? `txn:${id(f.pendingSlug, round - 1)}` : null,
        merchant: f.merchant,
        amountCents: f.amountCents,
        currency: f.currency ?? "USD",
        category: f.category ?? "purchase",
        authorizedAt: at,
        postedAt: f.type === "transaction.posted" ? at : null,
      },
    };
    if ((await ingestEvent(db, ev, at)).outcome === "applied") applied++;
  }
  return applied;
}

async function deliveryRound(db: Db, user: User): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactionEvents)
    .where(and(eq(transactionEvents.provider, "demo-bank"), sql`(${transactionEvents.externalEventId} like ${`evt:${user.id}:%:coffee`} or ${transactionEvents.externalEventId} like ${`evt:${user.id}:%:lunch`})`));
  return row.n;
}

/** Called once when a demo account activates tracking. */
export async function deliverFirstWeek(db: Db, user: User, now: Date): Promise<number> {
  return deliver(db, user, FIRST_WEEK, 0, now);
}

export async function deliverMorePurchases(db: Db, user: User, now: Date): Promise<number> {
  const round = await deliveryRound(db, user);
  if (round === 0) return deliverFirstWeek(db, user, now);
  // Odd rounds post the pending purchase from the round before; even rounds start a fresh set.
  return round % 2 === 1 ? deliver(db, user, MORE_PURCHASES, round, now) : deliver(db, user, FIRST_WEEK, round, now);
}

/** The merchant refunds the most recent purchase whose round-up is tracked. */
export async function deliverRefund(db: Db, user: User, now: Date): Promise<string> {
  const conn = await demoConnection(db, user);
  const [target] = await db
    .select({ purchase: purchases })
    .from(roundupEntries)
    .innerJoin(purchases, eq(purchases.id, roundupEntries.purchaseId))
    .where(and(eq(roundupEntries.userId, user.id), eq(roundupEntries.status, "tracked"), eq(purchases.status, "posted")))
    .orderBy(desc(purchases.postedAt))
    .limit(1);
  if (!target) throw new DomainError("nothing_to_refund", "There is no tracked purchase to refund.", 409);
  const p = target.purchase;
  await ingestEvent(
    db,
    {
      provider: conn.provider,
      eventId: `evt:refund:${p.externalId}`,
      type: "transaction.refunded",
      occurredAt: now,
      connectionRef: conn.externalRef,
      transaction: { id: p.externalId, merchant: p.merchant, amountCents: p.amountCents, currency: p.currency, category: p.category, authorizedAt: p.authorizedAt },
    },
    now,
  );
  return p.merchant;
}

/** Demo only: run the weekly cutoff now instead of waiting for Sunday night. */
export async function closeWeekNow(db: Db, user: User, now: Date) {
  if (user.env !== "demo") throw new DomainError("demo_only", "Only the demo can close a week early.", 403);
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.userId, user.id), eq(weeklyBatches.status, "tracking")))
    .orderBy(weeklyBatches.weekStart)
    .limit(1);
  if (!batch) throw new DomainError("nothing_to_close", "There is no open week to close yet.", 409);
  return closeBatch(db, batch.id, now, { type: "user", id: user.id });
}

export async function setDemoFlags(db: Db, user: User, flags: DemoFlags): Promise<void> {
  if (user.env !== "demo") throw new DomainError("demo_only", "Failure switches exist only in the demo.", 403);
  await db.update(preferences).set({ demoFlags: flags }).where(eq(preferences.userId, user.id));
}
