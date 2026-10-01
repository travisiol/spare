import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Db } from "../src/db/client";
import { adjustments, approvals, connections, fundingAttempts, jobs, ledgerEntries, orders, roundupEntries, settlements, users, weeklyBatches } from "../src/db/schema";
import { chooseInstrument, connect, disconnect } from "../src/core/accounts";
import { reconcile } from "../src/core/admin";
import { approveBatch, closeBatch, declineBatch, requestRefund, retryFunding, retryOrder } from "../src/core/batches";
import { setDemoFlags } from "../src/core/demo";
import { ingestEvent } from "../src/core/ingest";
import { enqueue } from "../src/core/jobs";
import { accountBalance } from "../src/core/ledger";
import { getHoldings, trackedTotal } from "../src/core/queries";
import { signInWithWallet, createNonce } from "../src/core/auth";
import { liveAdapters } from "../src/core/adapters/live";
import { T0, batchesOf, drain, event, getUser, onboardedUser, plus, post, world, type World } from "./helpers";

async function fundingConn(db: Db, userId: string) {
  const [c] = await db.select().from(connections).where(and(eq(connections.userId, userId), eq(connections.kind, "funding")));
  return c;
}

/** A user with $1.42 of round-ups in a closed batch that is waiting for approval. */
async function readyBatch(w: World, tag = "") {
  const user = await onboardedUser(w);
  await post(w, user, `${tag}coffee`, 463, plus(T0, 1000));
  await post(w, user, `${tag}groceries`, 3120, plus(T0, 2000));
  await post(w, user, `${tag}bus`, 275, plus(T0, 3000));
  const [open] = await batchesOf(w.db, user.id);
  await closeBatch(w.db, open.id, plus(T0, 10_000));
  const [batch] = await batchesOf(w.db, user.id);
  return { user, batch, conn: await fundingConn(w.db, user.id) };
}

const approve = (w: World, r: Awaited<ReturnType<typeof readyBatch>>, now = plus(T0, 20_000)) =>
  approveBatch(w.db, w.resolve, { userId: r.user.id, batchId: r.batch.id, snapshotHash: r.batch.snapshotHash!, fundingConnectionId: r.conn.id }, now);

const statusOf = async (db: Db, id: string) => (await db.select().from(weeklyBatches).where(eq(weeklyBatches.id, id)))[0].status;

test("the happy path: approval → funding → order → settlement, with a balanced ledger", async () => {
  const w = await world();
  const r = await readyBatch(w);
  assert.equal(r.batch.status, "ready_for_approval");
  assert.equal(r.batch.totalCents, 142);
  assert.equal(r.batch.authorizedCents, 142);

  // Nothing has moved before approval.
  assert.equal((await w.db.select().from(ledgerEntries)).length, 0);
  assert.equal((await w.db.select().from(fundingAttempts)).length, 0);

  await approve(w, r);
  assert.equal(await statusOf(w.db, r.batch.id), "approved");

  // Each step is its own state: watch them go by one tick at a time.
  const seen: string[] = [];
  let now = plus(T0, 30_000);
  for (let i = 0; i < 30; i++) {
    const t = now;
    const { tick } = await import("../src/core/worker");
    await tick(w.db, w.resolve, () => t);
    const s = await statusOf(w.db, r.batch.id);
    if (seen.at(-1) !== s) seen.push(s);
    if (s === "completed") break;
    now = plus(now, 2000);
  }
  for (const s of ["funding_pending", "order_pending", "settlement_pending", "completed"]) assert.ok(seen.includes(s), `passed through ${s}: ${seen.join(" → ")}`);

  const [attempt] = await w.db.select().from(fundingAttempts);
  assert.equal(attempt.status, "succeeded");
  assert.equal(attempt.amountCents, 142);
  const [order] = await w.db.select().from(orders);
  assert.equal(order.status, "filled");
  assert.equal(order.notionalCents, 142);
  const [settlement] = await w.db.select().from(settlements);
  assert.equal(settlement.status, "settled");
  assert.ok(settlement.providerRef!.startsWith("demo:"), "a simulated settlement is never given a transaction hash");

  // The ledger is square: no cash held, no tokens owed, every journal balanced.
  assert.equal(await accountBalance(w.db, r.user.id, "user:funds", "USD"), 0n);
  assert.equal(await accountBalance(w.db, r.user.id, "clearing:funds_held", "USD"), 0n);
  assert.equal(await accountBalance(w.db, r.user.id, "user:tokens_owed", "AAPL"), 0n);
  assert.deepEqual(await reconcile(w.db, "demo", now), []);

  const [holding] = await getHoldings(w.db, w.resolve, r.user);
  assert.equal(holding.symbol, "AAPL");
  assert.equal(holding.settledQty, 5_680_000_000_000_000n);
  assert.equal(holding.pendingQty, 0n);
});

test("an approved batch is immutable: later purchases go to a later batch", async () => {
  const w = await world();
  const r = await readyBatch(w);
  // A purchase arrives after the cutoff, before approval.
  await post(w, r.user, "late-1", 110, plus(T0, 15_000));
  await approve(w, r);
  await post(w, r.user, "late-2", 120, plus(T0, 25_000));

  const batches = await batchesOf(w.db, r.user.id);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].totalCents, 142);
  assert.equal(batches[0].authorizedCents, 142);
  assert.equal((await trackedTotal(w.db, batches[0].id)).total, 142);
  assert.equal((await trackedTotal(w.db, batches[1].id)).total, 170);

  const [approval] = await w.db.select().from(approvals);
  assert.equal(approval.authorizedCents, 142);
  assert.match(approval.statement, /collect \$1\.42 once/);
  assert.match(approval.statement, /AAPL/);

  // Approving twice is refused; the amount collected is the approved amount.
  await assert.rejects(approve(w, r), /no longer waiting for approval/);
  await drain(w, plus(T0, 30_000));
  const attempts = await w.db.select().from(fundingAttempts);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].amountCents, 142);
});

test("changing company affects future batches only", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await chooseInstrument(w.db, w.resolve, r.user, "TSLA", plus(T0, 12_000));
  const [frozen] = await batchesOf(w.db, r.user.id);
  assert.equal(frozen.instrumentSymbol, "AAPL", "a closed batch keeps the company it closed with");
  await approve(w, r);
  await drain(w, plus(T0, 30_000));
  const [order] = await w.db.select().from(orders);
  assert.equal(order.instrumentSymbol, "AAPL");

  await post(w, r.user, "next", 101, plus(T0, 200_000)); // 99
  await post(w, r.user, "next-2", 150, plus(T0, 201_000)); // 50
  const next = (await batchesOf(w.db, r.user.id))[1];
  await closeBatch(w.db, next.id, plus(T0, 300_000));
  assert.equal((await batchesOf(w.db, r.user.id))[1].instrumentSymbol, "TSLA");
  // Nothing was sold.
  const holdings = await getHoldings(w.db, w.resolve, r.user);
  assert.equal(holdings.find((h) => h.symbol === "AAPL")!.settledQty, 5_680_000_000_000_000n);
});

test("authorization boundaries: another user cannot approve, decline or retry a batch", async () => {
  const w = await world();
  const r = await readyBatch(w);
  const other = await onboardedUser(w);
  const otherConn = await fundingConn(w.db, other.id);
  const input = { batchId: r.batch.id, snapshotHash: r.batch.snapshotHash! };

  await assert.rejects(approveBatch(w.db, w.resolve, { ...input, userId: other.id, fundingConnectionId: otherConn.id }, plus(T0, 20_000)), /does not exist/);
  // The owner cannot fund from someone else's funding method either.
  await assert.rejects(approveBatch(w.db, w.resolve, { ...input, userId: r.user.id, fundingConnectionId: otherConn.id }, plus(T0, 20_000)), /Connect a funding method/);
  await assert.rejects(declineBatch(w.db, other.id, r.batch.id, plus(T0, 20_000)), /does not exist/);
  await assert.rejects(retryFunding(w.db, other.id, r.batch.id, plus(T0, 20_000)), /does not exist/);
  await assert.rejects(disconnect(w.db, other, r.conn.id, plus(T0, 20_000)), /does not exist/);
  assert.equal(await statusOf(w.db, r.batch.id), "ready_for_approval");

  // A disconnected funding method cannot be charged.
  await disconnect(w.db, r.user, r.conn.id, plus(T0, 21_000));
  await assert.rejects(approve(w, r), /Connect a funding method/);
});

test("a funding job without an approval record collects nothing", async () => {
  const w = await world();
  const r = await readyBatch(w);
  // Simulate an operator (or a bug) enqueueing the charge directly.
  await enqueue(w.db, "batch.fund", `fund:${r.batch.id}:1`, { batchId: r.batch.id }, plus(T0, 20_000));
  await drain(w, plus(T0, 30_000));
  assert.equal((await w.db.select().from(fundingAttempts)).length, 0);
  assert.equal(await statusOf(w.db, r.batch.id), "ready_for_approval");
});

test("declined and expired batches charge nothing", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await declineBatch(w.db, r.user.id, r.batch.id, plus(T0, 20_000));
  assert.equal(await statusOf(w.db, r.batch.id), "cancelled");

  const r2 = await readyBatch(w, "second-");
  const afterWindow = new Date(r2.batch.approveBy!.getTime() + 1000);
  await assert.rejects(approve(w, r2, afterWindow), /approval window/);
  await drain(w, afterWindow, 2);
  assert.equal(await statusOf(w.db, r2.batch.id), "expired");
  assert.equal((await w.db.select().from(fundingAttempts)).length, 0);
});

test("a declined charge can be retried by the user and is collected exactly once", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await setDemoFlags(w.db, r.user, { nextFunding: "fail" });
  await approve(w, r);
  let now = await drain(w, plus(T0, 30_000));
  assert.equal(await statusOf(w.db, r.batch.id), "funding_failed");
  assert.equal(await accountBalance(w.db, r.user.id, "clearing:funds_held", "USD"), 0n, "a failed charge moves no money");

  await retryFunding(w.db, r.user.id, r.batch.id, now);
  await assert.rejects(retryFunding(w.db, r.user.id, r.batch.id, now), /not waiting for a funding retry/);
  now = await drain(w, now);
  assert.equal(await statusOf(w.db, r.batch.id), "completed");
  const attempts = await w.db.select().from(fundingAttempts).orderBy(fundingAttempts.createdAt);
  assert.deepEqual(attempts.map((a) => a.status), ["failed", "succeeded"]);
  assert.deepEqual(await reconcile(w.db, "demo", now), []);
});

test("an uncertain funding outcome is reconciled, never charged twice", async () => {
  const w = await world();
  const r = await readyBatch(w);
  // The provider takes the charge but the response is lost.
  await setDemoFlags(w.db, r.user, { nextFunding: "uncertain" });
  await approve(w, r);
  const { tick } = await import("../src/core/worker");
  const t1 = plus(T0, 30_000);
  await tick(w.db, w.resolve, () => t1);
  const [uncertain] = await w.db.select().from(fundingAttempts);
  assert.equal(uncertain.status, "uncertain");
  assert.equal(await statusOf(w.db, r.batch.id), "funding_pending");

  // The user cannot start another charge while one is unresolved.
  await assert.rejects(retryFunding(w.db, r.user.id, r.batch.id, t1), /not waiting for a funding retry/);
  // The database itself refuses a second live attempt for the batch.
  await assert.rejects(
    w.db.insert(fundingAttempts).values({ batchId: r.batch.id, env: "demo", idempotencyKey: "rogue", provider: "demo-funding", amountCents: 142, status: "created" }),
  );

  const now = await drain(w, plus(T0, 40_000));
  assert.equal(await statusOf(w.db, r.batch.id), "completed");
  const attempts = await w.db.select().from(fundingAttempts);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "succeeded");
  assert.equal(await accountBalance(w.db, r.user.id, "revenue:fees", "USD"), 0n);
  assert.deepEqual(await reconcile(w.db, "demo", now), []);
});

test("replaying finished jobs posts nothing twice", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await approve(w, r);
  let now = await drain(w, plus(T0, 30_000));
  const before = (await w.db.select().from(ledgerEntries)).length;
  // Force every job to run again, as after a crash.
  await w.db.update(jobs).set({ status: "queued", runAt: now });
  now = await drain(w, now);
  assert.equal((await w.db.select().from(ledgerEntries)).length, before);
  assert.equal((await w.db.select().from(fundingAttempts)).length, 1);
  assert.equal((await w.db.select().from(orders)).length, 1);
  assert.equal((await w.db.select().from(settlements)).length, 1);
  assert.equal(await statusOf(w.db, r.batch.id), "completed");
});

test("funding succeeds, the order fails: funds are held, retried without a second charge", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await setDemoFlags(w.db, r.user, { nextOrder: "fail" });
  await approve(w, r);
  let now = await drain(w, plus(T0, 30_000));
  assert.equal(await statusOf(w.db, r.batch.id), "order_failed");
  assert.equal(await accountBalance(w.db, r.user.id, "user:funds", "USD"), -142n, "SPARE owes the user $1.42");
  assert.equal(await accountBalance(w.db, r.user.id, "clearing:funds_held", "USD"), 142n);
  const exceptions = await reconcile(w.db, "demo", now);
  assert.deepEqual(exceptions.map((e) => e.kind), ["funds_held_after_failed_order"]);

  // Collecting again is not an option in this state.
  await assert.rejects(retryFunding(w.db, r.user.id, r.batch.id, now), /not waiting for a funding retry/);

  await retryOrder(w.db, { type: "user", id: r.user.id }, r.batch.id, now, r.user.id);
  now = await drain(w, now);
  assert.equal(await statusOf(w.db, r.batch.id), "completed");
  assert.equal((await w.db.select().from(fundingAttempts)).length, 1, "one charge, however many orders");
  const allOrders = await w.db.select().from(orders).orderBy(orders.createdAt);
  assert.deepEqual(allOrders.map((o) => o.status), ["failed", "filled"]);
  assert.equal(await accountBalance(w.db, r.user.id, "user:funds", "USD"), 0n);
  assert.deepEqual(await reconcile(w.db, "demo", now), []);
});

test("funding succeeds, the order fails, the user is refunded in full", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await setDemoFlags(w.db, r.user, { nextOrder: "fail" });
  await approve(w, r);
  let now = await drain(w, plus(T0, 30_000));
  const other = await onboardedUser(w);
  await assert.rejects(requestRefund(w.db, { type: "user", id: other.id }, r.batch.id, now, other.id), /does not exist/);

  await requestRefund(w.db, { type: "admin", id: "ops" }, r.batch.id, now);
  await assert.rejects(requestRefund(w.db, { type: "admin", id: "ops" }, r.batch.id, now), /Only a funded batch/);
  now = await drain(w, now);
  assert.equal(await statusOf(w.db, r.batch.id), "refunded");
  const [attempt] = await w.db.select().from(fundingAttempts);
  assert.equal(attempt.status, "refunded");
  assert.equal(await accountBalance(w.db, r.user.id, "user:funds", "USD"), 0n);
  assert.equal(await accountBalance(w.db, r.user.id, "clearing:funds_held", "USD"), 0n);
  assert.equal((await getHoldings(w.db, w.resolve, r.user)).length, 0);
  assert.deepEqual(await reconcile(w.db, "demo", now), []);
});

test("settlement is reconciled separately from execution", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await setDemoFlags(w.db, r.user, { nextSettlement: "slow" });
  await approve(w, r);
  const { tick } = await import("../src/core/worker");
  let now = plus(T0, 30_000);
  for (let i = 0; i < 12 && (await statusOf(w.db, r.batch.id)) !== "settlement_pending"; i++) {
    const t = now;
    await tick(w.db, w.resolve, () => t);
    now = plus(now, 2000);
  }
  assert.equal(await statusOf(w.db, r.batch.id), "settlement_pending");
  // Bought but not delivered: shown as pending, not as a holding.
  const [pending] = await getHoldings(w.db, w.resolve, r.user);
  assert.equal(pending.settledQty, 0n);
  assert.equal(pending.pendingQty, 5_680_000_000_000_000n);
  assert.equal(await accountBalance(w.db, r.user.id, "user:tokens_owed", "AAPL"), -5_680_000_000_000_000n);
  assert.deepEqual(await reconcile(w.db, "demo", now), []);

  now = await drain(w, now);
  assert.equal(await statusOf(w.db, r.batch.id), "completed");
  const [settled] = await getHoldings(w.db, w.resolve, r.user);
  assert.equal(settled.settledQty, 5_680_000_000_000_000n);
  assert.equal(settled.pendingQty, 0n);
});

test("a refund after approval is recorded as an adjustment: no sale, no extra charge", async () => {
  const w = await world();
  const r = await readyBatch(w);
  await approve(w, r);
  let now = await drain(w, plus(T0, 30_000));
  await ingestEvent(w.db, event(r.user, "transaction.refunded", { id: "coffee", amountCents: 463 }, now), now);
  now = await drain(w, now);

  const [adj] = await w.db.select().from(adjustments);
  assert.equal(adj.amountCents, 37);
  assert.equal(adj.policy, "record_only");
  const [batch] = await batchesOf(w.db, r.user.id);
  assert.equal(batch.status, "completed");
  assert.equal(batch.totalCents, 142, "history is preserved");
  const [entry] = await w.db.select().from(roundupEntries).where(eq(roundupEntries.amountCents, 37));
  assert.equal(entry.status, "tracked");
  assert.equal((await w.db.select().from(fundingAttempts)).length, 1);
  assert.equal((await w.db.select().from(orders)).length, 1);
  assert.equal((await getHoldings(w.db, w.resolve, r.user))[0].settledQty, 5_680_000_000_000_000n);
});

test("demo and live are isolated", async () => {
  const w = await world();
  const demo = await onboardedUser(w);
  const [live] = await w.db.insert(users).values({ env: "live", walletAddress: "0x00000000000000000000000000000000000000aa" }).returning();
  await w.db.insert((await import("../src/db/schema")).preferences).values({ userId: live.id, weeklyCapCents: 1000 });

  // A live account gets live adapters, which are not configured — never the demo ones.
  const adapters = w.resolve("live");
  assert.equal(adapters.funding.availability().available, false);
  assert.equal(adapters.execution.supports("AAPL"), false);
  await assert.rejects(chooseInstrument(w.db, w.resolve, live, "AAPL", T0), /not available yet/);
  await assert.rejects(connect(w.db, w.resolve, live, "funding", T0), /No funding provider/);
  await assert.rejects(connect(w.db, w.resolve, live, "transaction_source", T0), /No transaction data provider/);

  // Demo adapters refuse to act for a live account even if called directly.
  const demoSet = w.resolve("demo");
  await assert.rejects(demoSet.funding.collect({ idempotencyKey: "x", userId: live.id, connectionRef: "x", amountCents: 100, purpose: "x" }), /only act for demo accounts/);
  await assert.rejects(demoSet.execution.placeOrder({ idempotencyKey: "y", userId: live.id, symbol: "AAPL", notionalCents: 100 }), /only act for demo accounts/);
  await assert.rejects(setDemoFlags(w.db, live, { nextOrder: "fail" }), /only in the demo/);

  // A demo-provider event cannot land on a live connection.
  await w.db.insert(connections).values({ userId: live.id, env: "live", kind: "transaction_source", provider: "demo-bank", externalRef: "spoof", label: "x" });
  const ev = { ...event(demo, "transaction.posted", { id: "spoofed", amountCents: 463 }, plus(T0, 1000)), connectionRef: "spoof" };
  assert.equal((await ingestEvent(w.db, ev, plus(T0, 1000))).outcome, "ignored");
  assert.equal((await batchesOf(w.db, live.id)).length, 0);
  assert.equal(liveAdapters().settlement.availability().available, false);
  assert.equal((await getUser(w.db, demo.id)).env, "demo");
});

test("wallet sign-in: nonce is single-use, expiring and bound to this domain and chain", async () => {
  const w = await world();
  const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
  const { createSiweMessage } = await import("viem/siwe");
  const { SIGN_IN_STATEMENT, userForSessionToken, revokeSession } = await import("../src/core/auth");
  const account = privateKeyToAccount(generatePrivateKey());
  const build = (nonce: string, over: Partial<{ domain: string; chainId: number; uri: string }> = {}) =>
    createSiweMessage({
      address: account.address,
      chainId: over.chainId ?? 4663,
      domain: over.domain ?? "spare.test",
      nonce,
      uri: over.uri ?? "https://spare.test",
      version: "1",
      statement: SIGN_IN_STATEMENT,
      issuedAt: T0,
      expirationTime: plus(T0, 600_000),
    });
  const signIn = async (message: string, now = plus(T0, 1000), signer = account) =>
    signInWithWallet(w.db, { message, signature: await signer.signMessage({ message }), expectedDomain: "spare.test" }, now);

  const nonce = await createNonce(w.db, T0);
  const message = build(nonce);
  const session = await signIn(message);
  const user = await userForSessionToken(w.db, session.token, plus(T0, 2000));
  assert.equal(user!.walletAddress, account.address.toLowerCase());
  assert.equal(user!.env, "live");

  await assert.rejects(signIn(message), /already used/, "replay is refused");
  await assert.rejects(signIn(build("neverissued00000")), /expired or was already used/);
  await assert.rejects(signIn(build(await createNonce(w.db, T0), { domain: "evil.test", uri: "https://evil.test" })), /different site/);
  await assert.rejects(signIn(build(await createNonce(w.db, T0), { chainId: 1 })), /Robinhood Chain/);
  await assert.rejects(signIn(build(await createNonce(w.db, T0)), plus(T0, 11 * 60_000)), /expired/);
  const stranger = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(signIn(build(await createNonce(w.db, T0)), plus(T0, 1000), stranger), /does not match this wallet/);

  // Signing in twice with the same wallet is the same account; sessions expire and revoke.
  const again = await signIn(build(await createNonce(w.db, T0)));
  assert.equal(again.userId, session.userId);
  assert.equal(await userForSessionToken(w.db, session.token, plus(T0, 8 * 24 * 3_600_000)), null);
  await revokeSession(w.db, again.token, plus(T0, 3000));
  assert.equal(await userForSessionToken(w.db, again.token, plus(T0, 4000)), null);
  assert.equal(await userForSessionToken(w.db, "not-a-token", plus(T0, 4000)), null);
});
