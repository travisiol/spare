import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { purchases, roundupEntries, transactionEvents, adjustments } from "../src/db/schema";
import { roundUpCents, parseUsdToCents, tokensForNotional, formatTokenQty, valueCents, formatUsd } from "../src/core/money";
import { weekStartFor, weekEndInstant, localMidnightToInstant } from "../src/core/weeks";
import { ingestEvent } from "../src/core/ingest";
import { closeBatch, approveBatch } from "../src/core/batches";
import { setPaused, setWeeklyCap } from "../src/core/accounts";
import { trackedTotal } from "../src/core/queries";
import { T0, at, batchesOf, event, onboardedUser, plus, post, world, drain } from "./helpers";

async function entryFor(db: Awaited<ReturnType<typeof world>>["db"], externalId: string) {
  const [row] = await db
    .select({ entry: roundupEntries, purchase: purchases })
    .from(purchases)
    .innerJoin(roundupEntries, eq(roundupEntries.purchaseId, purchases.id))
    .where(eq(purchases.externalId, externalId));
  return row;
}

test("round-up arithmetic is exact integer cents", () => {
  assert.equal(roundUpCents(463), 37);
  assert.equal(roundUpCents(3120), 80);
  assert.equal(roundUpCents(275), 25);
  assert.equal(roundUpCents(500), 0);
  assert.equal(roundUpCents(1), 99);
  assert.equal(roundUpCents(99), 1);
  assert.equal(roundUpCents(0), 0);
  assert.equal(roundUpCents(463) + roundUpCents(3120) + roundUpCents(275), 142);
  assert.throws(() => roundUpCents(4.63));
  assert.throws(() => roundUpCents(-1));
  for (let c = 0; c < 2000; c++) assert.equal((c + roundUpCents(c)) % 100, 0);
});

test("money helpers never use floats for amounts", () => {
  assert.equal(parseUsdToCents("10"), 1000);
  assert.equal(parseUsdToCents("$7.5"), 750);
  assert.equal(parseUsdToCents("0.07"), 7);
  assert.equal(parseUsdToCents("1.234"), null);
  assert.equal(parseUsdToCents("abc"), null);
  assert.equal(formatUsd(142), "$1.42");
  assert.equal(formatUsd(5), "$0.05");
  const qty = tokensForNotional(142, "250.00", 18);
  assert.equal(qty, 5_680_000_000_000_000n);
  assert.equal(formatTokenQty(qty, 18), "0.00568");
  assert.equal(valueCents(qty, "250.00", 18), 142);
});

test("weeks are Monday-based in the account's timezone, across DST", () => {
  // 2026-03-02 is a Monday.
  assert.equal(weekStartFor(at("2026-03-04T12:00:00Z"), "UTC"), "2026-03-02");
  // Sunday 23:30 in New York is already Monday in UTC — it still belongs to the earlier week.
  assert.equal(weekStartFor(at("2026-03-09T03:30:00Z"), "America/New_York"), "2026-03-02");
  assert.equal(weekStartFor(at("2026-03-09T03:30:00Z"), "UTC"), "2026-03-09");
  // Monday 00:30 in Tokyo is still Sunday in UTC.
  assert.equal(weekStartFor(at("2026-03-08T15:30:00Z"), "Asia/Tokyo"), "2026-03-09");
  // US DST starts 2026-03-08: the week of Mar 2 ends at Mar 9 00:00 EDT = 04:00 UTC.
  assert.equal(weekEndInstant("2026-03-02", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(localMidnightToInstant("2026-03-02", "America/New_York").toISOString(), "2026-03-02T05:00:00.000Z");
  assert.equal(weekEndInstant("2026-03-02", "Asia/Kolkata").toISOString(), "2026-03-08T18:30:00.000Z");
});

test("eligible posted purchases are tracked; exact dollars, transfers and foreign currency are not", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await post(w, user, "coffee", 463, plus(T0, 1000));
  await post(w, user, "groceries", 3120, plus(T0, 2000));
  await post(w, user, "bus", 275, plus(T0, 3000));
  await post(w, user, "parking", 500, plus(T0, 4000));
  await post(w, user, "transfer", 20000, plus(T0, 5000), { category: "transfer" });
  await post(w, user, "fee", 250, plus(T0, 5500), { category: "fee" });
  await post(w, user, "eur", 1845, plus(T0, 6000), { currency: "EUR" });

  const [batch] = await batchesOf(w.db, user.id);
  assert.equal(batch.status, "tracking");
  assert.equal((await trackedTotal(w.db, batch.id)).total, 142);
  assert.equal((await entryFor(w.db, "parking")).entry.reason, "exact_dollar");
  assert.equal((await entryFor(w.db, "transfer")).entry.reason, "not_a_purchase");
  assert.equal((await entryFor(w.db, "fee")).entry.reason, "not_a_purchase");
  assert.equal((await entryFor(w.db, "eur")).entry.reason, "unsupported_currency");
  assert.equal((await entryFor(w.db, "eur")).entry.status, "excluded");
});

test("a re-delivered event changes nothing", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  const ev = event(user, "transaction.posted", { id: "coffee", amountCents: 463 }, plus(T0, 1000), "evt-1");
  assert.equal((await ingestEvent(w.db, ev, plus(T0, 1000))).outcome, "applied");
  assert.equal((await ingestEvent(w.db, ev, plus(T0, 2000))).outcome, "duplicate");
  // A different event id for the same transaction is recognised too.
  const again = event(user, "transaction.posted", { id: "coffee", amountCents: 463 }, plus(T0, 3000), "evt-2");
  assert.equal((await ingestEvent(w.db, again, plus(T0, 3000))).outcome, "stale");
  const [batch] = await batchesOf(w.db, user.id);
  assert.equal((await trackedTotal(w.db, batch.id)).total, 37);
  assert.equal((await w.db.select().from(purchases).where(eq(purchases.userId, user.id))).length, 1);
  assert.equal((await w.db.select().from(transactionEvents)).length, 2);
});

test("pending purchases are not counted, and posting reuses the same purchase", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await ingestEvent(w.db, event(user, "transaction.pending", { id: "auth-1", amountCents: 999 }, plus(T0, 1000)), plus(T0, 1000));
  let row = await entryFor(w.db, "auth-1");
  assert.equal(row.entry.status, "pending");
  assert.equal((await batchesOf(w.db, user.id)).length, 0, "a pending purchase opens no batch");

  // Posts under a new id, with the tip added: amount changes, still one purchase.
  await post(w, user, "txn-1", 1163, plus(T0, 5000), { pendingId: "auth-1" });
  row = await entryFor(w.db, "txn-1");
  assert.equal(row.purchase.pendingExternalId, "auth-1");
  assert.equal(row.entry.status, "tracked");
  assert.equal(row.entry.amountCents, 37);
  assert.equal((await w.db.select().from(purchases).where(eq(purchases.userId, user.id))).length, 1);
});

test("out-of-order delivery: posted before pending, and refund before purchase", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await post(w, user, "txn-1", 463, plus(T0, 5000), { pendingId: "auth-1" });
  // The pending event shows up late. It must not create a second purchase or a pending entry.
  const late = await ingestEvent(w.db, event(user, "transaction.pending", { id: "auth-1", amountCents: 463 }, plus(T0, 1000)), plus(T0, 6000));
  assert.equal(late.outcome, "stale");
  assert.equal((await w.db.select().from(purchases).where(eq(purchases.userId, user.id))).length, 1);

  // A refund overtakes its purchase.
  const refund = await ingestEvent(w.db, event(user, "transaction.refunded", { id: "txn-2", amountCents: 275 }, plus(T0, 8000)), plus(T0, 8000));
  assert.equal(refund.outcome, "applied");
  const purchase = await post(w, user, "txn-2", 275, plus(T0, 7000));
  assert.equal(purchase.outcome, "stale");
  const [batch] = await batchesOf(w.db, user.id);
  assert.equal((await trackedTotal(w.db, batch.id)).total, 37);
});

test("a dropped pending authorization is excluded, with a reason", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await ingestEvent(w.db, event(user, "transaction.pending", { id: "auth-9", amountCents: 999 }, plus(T0, 1000)), plus(T0, 1000));
  await ingestEvent(w.db, event(user, "transaction.removed", { id: "auth-9", amountCents: 999 }, plus(T0, 2000)), plus(T0, 2000));
  const row = await entryFor(w.db, "auth-9");
  assert.equal(row.purchase.status, "void");
  assert.equal(row.entry.reason, "pending_dropped");
});

test("the weekly cap is enforced on the server; purchases beyond it are excluded", async () => {
  const w = await world();
  const user = await onboardedUser(w, { capCents: 100 });
  await post(w, user, "a", 150, plus(T0, 1000)); // 50
  await post(w, user, "b", 160, plus(T0, 2000)); // 40 → 90
  await post(w, user, "c", 175, plus(T0, 3000)); // 25 → would be 115: excluded
  await post(w, user, "d", 190, plus(T0, 4000)); // 10 → exactly 100: allowed
  await post(w, user, "e", 199, plus(T0, 5000)); // 1 → 101: excluded
  const [batch] = await batchesOf(w.db, user.id);
  assert.equal((await trackedTotal(w.db, batch.id)).total, 100);
  assert.equal((await entryFor(w.db, "c")).entry.reason, "over_weekly_cap");
  assert.equal((await entryFor(w.db, "e")).entry.reason, "over_weekly_cap");

  // Raising the cap applies to later purchases only; it never re-admits excluded ones.
  await setWeeklyCap(w.db, user, 500, plus(T0, 6000));
  await post(w, user, "f", 120, plus(T0, 7000)); // 80
  assert.equal((await trackedTotal(w.db, batch.id)).total, 180);
  assert.equal((await entryFor(w.db, "c")).entry.status, "excluded");
});

test("paused tracking and purchases before activation are excluded", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await post(w, user, "early", 463, plus(T0, -3_600_000));
  assert.equal((await entryFor(w.db, "early")).entry.reason, "tracking_not_active");
  await setPaused(w.db, user, true, plus(T0, 1000));
  await post(w, user, "paused", 463, plus(T0, 2000));
  assert.equal((await entryFor(w.db, "paused")).entry.reason, "tracking_paused");
  await setPaused(w.db, user, false, plus(T0, 3000));
  await post(w, user, "resumed", 463, plus(T0, 4000));
  assert.equal((await entryFor(w.db, "resumed")).entry.status, "tracked");
});

test("the cutoff follows the account's timezone", async () => {
  const w = await world();
  const ny = await onboardedUser(w, { timezone: "America/New_York", now: at("2026-03-04T12:00:00Z") });
  // Sunday 23:30 New York (Mar 8, after DST starts) = Mar 9 03:30 UTC → week of Mar 2.
  await post(w, ny, "late-sunday", 463, at("2026-03-09T03:30:00Z"));
  // Monday 00:30 New York = 04:30 UTC → week of Mar 9.
  await post(w, ny, "early-monday", 275, at("2026-03-09T04:30:00Z"));
  const batches = await batchesOf(w.db, ny.id);
  assert.deepEqual(batches.map((b) => b.weekStart), ["2026-03-02", "2026-03-09"]);
  assert.equal(batches[0].endsAt.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal((await trackedTotal(w.db, batches[0].id)).total, 37);
  assert.equal((await trackedTotal(w.db, batches[1].id)).total, 25);

  // The sweep closes a week only once its local cutoff has passed.
  await drain(w, at("2026-03-09T03:59:00Z"), 1);
  assert.equal((await batchesOf(w.db, ny.id))[0].status, "tracking");
});

test("a refund before approval updates the unapproved batch", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await post(w, user, "coffee", 463, plus(T0, 1000));
  await post(w, user, "groceries", 3120, plus(T0, 2000));
  await post(w, user, "lunch", 1220, plus(T0, 2500));
  await post(w, user, "snack", 310, plus(T0, 2600));
  const [batch] = await batchesOf(w.db, user.id);

  // While still tracking.
  await ingestEvent(w.db, event(user, "transaction.refunded", { id: "coffee", amountCents: 463 }, plus(T0, 3000)), plus(T0, 3000));
  assert.equal((await trackedTotal(w.db, batch.id)).total, 250);
  assert.equal((await entryFor(w.db, "coffee")).entry.status, "reversed");

  // After the cutoff, before approval: the frozen total and its hash both change.
  await closeBatch(w.db, batch.id, plus(T0, 4000));
  const frozen = (await batchesOf(w.db, user.id))[0];
  assert.equal(frozen.status, "ready_for_approval");
  assert.equal(frozen.totalCents, 250);
  await ingestEvent(w.db, event(user, "transaction.reversed", { id: "lunch", amountCents: 1220 }, plus(T0, 5000)), plus(T0, 5000));
  const after = (await batchesOf(w.db, user.id))[0];
  assert.equal(after.totalCents, 170);
  assert.equal(after.status, "ready_for_approval");
  assert.notEqual(after.snapshotHash, frozen.snapshotHash);

  // Approving with the stale snapshot is refused.
  const account = await w.db.query.connections.findFirst({ where: (c, { and, eq }) => and(eq(c.userId, user.id), eq(c.kind, "funding")) });
  await assert.rejects(
    approveBatch(w.db, w.resolve, { userId: user.id, batchId: batch.id, snapshotHash: frozen.snapshotHash!, fundingConnectionId: account!.id }, plus(T0, 6000)),
    /changed since you opened it/,
  );
  assert.equal((await w.db.select().from(adjustments)).length, 0);
});

test("a batch below the minimum carries forward and does not eat next week's cap", async () => {
  const w = await world();
  const user = await onboardedUser(w, { capCents: 100 });
  await post(w, user, "coffee", 463, plus(T0, 1000)); // 37 < $1.00 minimum
  const [first] = await batchesOf(w.db, user.id);
  assert.equal(await closeBatch(w.db, first.id, plus(T0, 2000)), "carried_forward");

  const batches = await batchesOf(w.db, user.id);
  assert.equal(batches[0].status, "carried_forward");
  assert.equal(batches[1].status, "tracking");
  assert.equal(batches[1].weekStart, "2026-03-09");
  const carried = await trackedTotal(w.db, batches[1].id);
  assert.equal(carried.total, 37);
  assert.equal(carried.ownWeek, 0);

  // Next week still has its whole $1.00 cap.
  await post(w, user, "b", 101, plus(T0, 3000)); // 99, lands in the open (next) batch
  assert.equal((await trackedTotal(w.db, batches[1].id)).total, 136);
  assert.equal(await closeBatch(w.db, batches[1].id, plus(T0, 4000)), "ready_for_approval");
});

test("an empty week closes without asking for anything", async () => {
  const w = await world();
  const user = await onboardedUser(w);
  await post(w, user, "parking", 500, plus(T0, 1000));
  assert.equal((await batchesOf(w.db, user.id)).length, 0, "an exact-dollar purchase opens no batch");
  await post(w, user, "coffee", 463, plus(T0, 2000));
  await ingestEvent(w.db, event(user, "transaction.refunded", { id: "coffee", amountCents: 463 }, plus(T0, 3000)), plus(T0, 3000));
  const [batch] = await batchesOf(w.db, user.id);
  assert.equal(await closeBatch(w.db, batch.id, plus(T0, 4000)), "empty");
  const rows = await w.db.select().from(roundupEntries).where(and(eq(roundupEntries.userId, user.id), eq(roundupEntries.status, "tracked")));
  assert.equal(rows.length, 0);
});
