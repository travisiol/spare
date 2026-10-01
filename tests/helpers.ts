import { eq } from "drizzle-orm";
import { createMemoryDb, type Db } from "../src/db/client";
import { users, weeklyBatches } from "../src/db/schema";
import { acknowledgeApproval, activateTracking, attestEligibility, chooseInstrument, connect, setWeeklyCap } from "../src/core/accounts";
import { createAdapterResolver, type AdapterResolver } from "../src/core/adapters";
import { startDemoSession } from "../src/core/auth";
import { ingestEvent, type ProviderEvent, type ProviderEventType } from "../src/core/ingest";
import { tick } from "../src/core/worker";

export interface World {
  db: Db;
  resolve: AdapterResolver;
}

export async function world(): Promise<World> {
  const db = await createMemoryDb();
  return { db, resolve: createAdapterResolver(db) };
}

/** Wednesday 2026-03-04 12:00 UTC. */
export const T0 = new Date("2026-03-04T12:00:00Z");
export const at = (iso: string) => new Date(iso);
export const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

export async function getUser(db: Db, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u;
}

/** A demo account that has finished setup and is tracking. */
export async function onboardedUser(w: World, opts: { timezone?: string; capCents?: number; symbol?: string; now?: Date } = {}) {
  const now = opts.now ?? T0;
  const { userId } = await startDemoSession(w.db, opts.timezone ?? "UTC", now);
  const user = await getUser(w.db, userId);
  await attestEligibility(w.db, user, now);
  await chooseInstrument(w.db, w.resolve, user, opts.symbol ?? "AAPL", now);
  await connect(w.db, w.resolve, user, "transaction_source", now);
  await connect(w.db, w.resolve, user, "funding", now);
  await setWeeklyCap(w.db, user, opts.capCents ?? 1000, now);
  await acknowledgeApproval(w.db, user, now);
  await activateTracking(w.db, user, now);
  return user;
}

let seq = 0;
export function event(
  user: { id: string },
  type: ProviderEventType,
  txn: { id: string; pendingId?: string; amountCents: number; merchant?: string; currency?: string; category?: string },
  when: Date,
  eventId?: string,
): ProviderEvent {
  return {
    provider: "demo-bank",
    eventId: eventId ?? `e${++seq}`,
    type,
    occurredAt: when,
    connectionRef: `demo-card-${user.id}`,
    transaction: {
      id: txn.id,
      pendingId: txn.pendingId ?? null,
      merchant: txn.merchant ?? "Test Merchant",
      amountCents: txn.amountCents,
      currency: txn.currency ?? "USD",
      category: txn.category ?? "purchase",
      authorizedAt: when,
      postedAt: type === "transaction.posted" ? when : null,
    },
  };
}

export const post = (w: World, user: { id: string }, id: string, amountCents: number, when: Date, extra: Partial<{ currency: string; category: string; pendingId: string }> = {}) =>
  ingestEvent(w.db, event(user, "transaction.posted", { id, amountCents, ...extra }, when), when);

export async function batchesOf(db: Db, userId: string) {
  return db.select().from(weeklyBatches).where(eq(weeklyBatches.userId, userId)).orderBy(weeklyBatches.weekStart);
}

/** Runs background work, advancing a fake clock, until nothing is left to do. */
export async function drain(w: World, from: Date, maxRounds = 40): Promise<Date> {
  let now = from;
  for (let i = 0; i < maxRounds; i++) {
    const current = now;
    const r = await tick(w.db, w.resolve, () => current);
    now = plus(now, 5000);
    if (r.jobs === 0 && r.closed === 0 && r.expired === 0) break;
  }
  return now;
}
