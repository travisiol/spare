/**
 * After approval: funding → order → settlement, one durable job per step.
 *
 *   Approval is not payment.   Funding is not execution.   Execution is not delivery.
 *
 * Each step records its attempt BEFORE calling the provider, then reconciles
 * by idempotency key. A crash or a lost response therefore leaves an attempt
 * that is looked up — never a second charge or a second order.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, connections, fundingAttempts, orders, quotes, settlements, users, weeklyBatches } from "@/db/schema";
import type { AdapterResolver } from "./adapters";
import type { OpResult, OrderResult, SettlementResult } from "./adapters/types";
import { audit, SYSTEM } from "./audit";
import { lockBatch } from "./batches";
import { enqueue, type JobHandler, type JobOutcome } from "./jobs";
import { postJournal } from "./ledger";

const POLL_MS = 1500;
const AGAIN: JobOutcome = { againInMs: POLL_MS };

async function batchContext(db: Db, batchId: string) {
  const [batch] = await db.select().from(weeklyBatches).where(eq(weeklyBatches.id, batchId));
  const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
  const [approval] = await db.select().from(approvals).where(eq(approvals.batchId, batchId));
  return { batch, user, approval };
}

/* ------------------------------------------------------------------ funding */

async function fund(db: Db, resolve: AdapterResolver, batchId: string, now: Date): Promise<JobOutcome> {
  const attempt = await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    const [approval] = await tx.select().from(approvals).where(eq(approvals.batchId, batchId));
    // No approval record, no charge — whoever enqueued the job.
    if (!approval) return null;
    if (batch.status === "approved") {
      const previous = await tx.select({ id: fundingAttempts.id }).from(fundingAttempts).where(eq(fundingAttempts.batchId, batchId));
      const adapters = resolve(batch.env);
      const [created] = await tx
        .insert(fundingAttempts)
        .values({
          batchId,
          env: batch.env,
          idempotencyKey: `fund:${batchId}:${previous.length + 1}`,
          provider: adapters.funding.provider,
          amountCents: approval.authorizedCents,
          status: "created",
        })
        .returning();
      await tx.update(weeklyBatches).set({ status: "funding_pending", updatedAt: now }).where(eq(weeklyBatches.id, batchId));
      return created;
    }
    if (batch.status !== "funding_pending") return null;
    const [live] = await tx
      .select()
      .from(fundingAttempts)
      .where(and(eq(fundingAttempts.batchId, batchId), ne(fundingAttempts.status, "failed")));
    return live ?? null;
  });
  if (!attempt || attempt.status === "succeeded") return "done";

  const { user, approval } = await batchContext(db, batchId);
  const adapter = resolve(user.env).funding;
  const [conn] = await db.select().from(connections).where(eq(connections.id, approval.fundingConnectionId));

  let result: OpResult | null;
  try {
    // Reconcile first: if the provider already knows this key, never submit again.
    result = await adapter.get(attempt.idempotencyKey);
    if (!result) {
      if (attempt.status === "pending") throw new Error("Provider lost a pending charge");
      result = await adapter.collect({
        idempotencyKey: attempt.idempotencyKey,
        userId: user.id,
        connectionRef: conn.externalRef,
        amountCents: attempt.amountCents,
        purpose: approval.statement,
      });
    }
  } catch (e) {
    // Outcome unknown. Mark it and look it up again; do not create another attempt.
    await db
      .update(fundingAttempts)
      .set({ status: "uncertain", error: e instanceof Error ? e.message : String(e), updatedAt: now })
      .where(eq(fundingAttempts.id, attempt.id));
    return { againInMs: POLL_MS * 2 };
  }

  if (result.status === "pending") {
    await db.update(fundingAttempts).set({ status: "pending", providerRef: result.providerRef, error: null, updatedAt: now }).where(eq(fundingAttempts.id, attempt.id));
    return AGAIN;
  }

  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "funding_pending") return;
    if (result.status === "succeeded") {
      await tx.update(fundingAttempts).set({ status: "succeeded", providerRef: result.providerRef, error: null, updatedAt: now }).where(eq(fundingAttempts.id, attempt.id));
      await postJournal(tx, {
        key: `funding:${attempt.id}`,
        userId: user.id,
        env: user.env,
        batchId,
        memo: "Round-ups collected for the approved weekly batch",
        lines: [
          { account: "clearing:funds_held", unit: "USD", amount: BigInt(attempt.amountCents) },
          { account: "user:funds", unit: "USD", amount: -BigInt(attempt.amountCents) },
        ],
      });
      await tx.update(weeklyBatches).set({ status: "funded", updatedAt: now }).where(eq(weeklyBatches.id, batchId));
      await enqueue(tx, "batch.execute", `execute:${batchId}:1`, { batchId }, now);
      await audit(tx, batch.env, SYSTEM, "funding.succeeded", { type: "batch", id: batchId }, { amountCents: attempt.amountCents, providerRef: result.providerRef });
    } else {
      await tx.update(fundingAttempts).set({ status: "failed", providerRef: result.providerRef, error: result.error ?? "Funding failed", updatedAt: now }).where(eq(fundingAttempts.id, attempt.id));
      await tx
        .update(weeklyBatches)
        .set({ status: "funding_failed", failureReason: result.error ?? "The funding method declined the charge. Nothing was collected.", updatedAt: now })
        .where(eq(weeklyBatches.id, batchId));
      await audit(tx, batch.env, SYSTEM, "funding.failed", { type: "batch", id: batchId }, { error: result.error });
    }
  });
  return "done";
}

/* ---------------------------------------------------------------- execution */

async function execute(db: Db, resolve: AdapterResolver, batchId: string, now: Date): Promise<JobOutcome> {
  const order = await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status === "funded") {
      const [approval] = await tx.select().from(approvals).where(eq(approvals.batchId, batchId));
      const previous = await tx.select({ id: orders.id }).from(orders).where(eq(orders.batchId, batchId));
      const [created] = await tx
        .insert(orders)
        .values({
          batchId,
          env: batch.env,
          idempotencyKey: `order:${batchId}:${previous.length + 1}`,
          provider: resolve(batch.env).execution.provider,
          instrumentSymbol: approval.instrumentSymbol,
          // The fee stays with SPARE; the round-ups buy stock.
          notionalCents: approval.roundupCents,
          status: "created",
        })
        .returning();
      await tx.update(weeklyBatches).set({ status: "order_pending", updatedAt: now }).where(eq(weeklyBatches.id, batchId));
      return created;
    }
    if (batch.status !== "order_pending") return null;
    const [live] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.batchId, batchId), ne(orders.status, "failed")));
    return live ?? null;
  });
  if (!order || order.status === "filled") return "done";

  const { user, approval } = await batchContext(db, batchId);
  const adapters = resolve(user.env);

  let result: OrderResult | null;
  try {
    result = await adapters.execution.get(order.idempotencyKey);
    if (!result) {
      if (order.status === "pending") throw new Error("Provider lost a pending order");
      const quote = await adapters.prices.quote(order.instrumentSymbol);
      if (quote) {
        await db.insert(quotes).values({ batchId, instrumentSymbol: order.instrumentSymbol, price: quote.price, source: quote.source, asOf: quote.asOf });
      }
      result = await adapters.execution.placeOrder({
        idempotencyKey: order.idempotencyKey,
        userId: user.id,
        symbol: order.instrumentSymbol,
        notionalCents: order.notionalCents,
      });
    }
  } catch (e) {
    await db.update(orders).set({ status: "uncertain", error: e instanceof Error ? e.message : String(e), updatedAt: now }).where(eq(orders.id, order.id));
    return { againInMs: POLL_MS * 2 };
  }

  if (result.status === "pending") {
    await db.update(orders).set({ status: "pending", providerRef: result.providerRef, error: null, updatedAt: now }).where(eq(orders.id, order.id));
    return AGAIN;
  }

  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "order_pending") return;
    if (result.status === "filled") {
      const qty = BigInt(result.filledQty!);
      await tx
        .update(orders)
        .set({ status: "filled", providerRef: result.providerRef, filledQty: qty.toString(), fillPrice: result.fillPrice ?? null, error: null, updatedAt: now })
        .where(eq(orders.id, order.id));
      await postJournal(tx, {
        key: `order:${order.id}`,
        userId: user.id,
        env: user.env,
        batchId,
        memo: `Bought ${order.instrumentSymbol} with the collected round-ups`,
        lines: [
          { account: "user:funds", unit: "USD", amount: BigInt(approval.authorizedCents) },
          { account: "clearing:funds_held", unit: "USD", amount: -BigInt(order.notionalCents) },
          { account: "revenue:fees", unit: "USD", amount: -BigInt(approval.feeCents) },
          { account: "clearing:tokens", unit: order.instrumentSymbol, amount: qty },
          { account: "user:tokens_owed", unit: order.instrumentSymbol, amount: -qty },
        ],
      });
      await tx.update(weeklyBatches).set({ status: "executed", updatedAt: now }).where(eq(weeklyBatches.id, batchId));
      await enqueue(tx, "batch.settle", `settle:${order.id}`, { batchId }, now);
      await audit(tx, batch.env, SYSTEM, "order.filled", { type: "batch", id: batchId }, { qty: qty.toString(), price: result.fillPrice, providerRef: result.providerRef });
    } else {
      await tx.update(orders).set({ status: "failed", providerRef: result.providerRef, error: result.error ?? "Order failed", updatedAt: now }).where(eq(orders.id, order.id));
      await tx
        .update(weeklyBatches)
        .set({ status: "order_failed", failureReason: result.error ?? "The order was not filled. Your funds are held and were not spent.", updatedAt: now })
        .where(eq(weeklyBatches.id, batchId));
      await audit(tx, batch.env, SYSTEM, "order.failed", { type: "batch", id: batchId }, { error: result.error });
    }
  });
  return "done";
}

/* --------------------------------------------------------------- settlement */

async function settle(db: Db, resolve: AdapterResolver, batchId: string, now: Date): Promise<JobOutcome> {
  const settlement = await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status === "executed") {
      const [order] = await tx.select().from(orders).where(and(eq(orders.batchId, batchId), eq(orders.status, "filled")));
      const [approval] = await tx.select().from(approvals).where(eq(approvals.batchId, batchId));
      const [created] = await tx
        .insert(settlements)
        .values({
          orderId: order.id,
          batchId,
          userId: batch.userId,
          env: batch.env,
          idempotencyKey: `settle:${order.id}`,
          provider: resolve(batch.env).settlement.provider,
          destination: approval.destination,
          instrumentSymbol: order.instrumentSymbol,
          qty: order.filledQty!,
          status: "created",
        })
        .returning();
      await tx.update(weeklyBatches).set({ status: "settlement_pending", updatedAt: now }).where(eq(weeklyBatches.id, batchId));
      return created;
    }
    if (batch.status !== "settlement_pending") return null;
    const [existing] = await tx.select().from(settlements).where(eq(settlements.batchId, batchId)).orderBy(desc(settlements.createdAt));
    return existing ?? null;
  });
  if (!settlement || settlement.status === "settled") return "done";

  const adapter = resolve(settlement.env).settlement;
  let result: SettlementResult | null;
  try {
    result = await adapter.get(settlement.idempotencyKey);
    if (!result) {
      if (settlement.status === "pending") throw new Error("Provider lost a pending delivery");
      result = await adapter.deliver({
        idempotencyKey: settlement.idempotencyKey,
        userId: settlement.userId,
        symbol: settlement.instrumentSymbol,
        qty: settlement.qty,
        destination: settlement.destination,
      });
    }
  } catch (e) {
    await db.update(settlements).set({ status: "uncertain", error: e instanceof Error ? e.message : String(e), updatedAt: now }).where(eq(settlements.id, settlement.id));
    return { againInMs: POLL_MS * 2 };
  }

  if (result.status === "pending") {
    await db.update(settlements).set({ status: "pending", error: null, updatedAt: now }).where(eq(settlements.id, settlement.id));
    return AGAIN;
  }
  if (result.status === "failed") {
    // The tokens are bought and owed. Delivery is retried by the queue, then raised to an operator.
    await db.update(settlements).set({ status: "uncertain", error: result.error ?? "Delivery failed", updatedAt: now }).where(eq(settlements.id, settlement.id));
    throw new Error(result.error ?? "Delivery failed");
  }

  await db.transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status !== "settlement_pending") return;
    const qty = BigInt(settlement.qty);
    await tx.update(settlements).set({ status: "settled", providerRef: result.providerRef, settledAt: now, error: null, updatedAt: now }).where(eq(settlements.id, settlement.id));
    await postJournal(tx, {
      key: `settlement:${settlement.id}`,
      userId: settlement.userId,
      env: settlement.env,
      batchId,
      memo: `Delivered ${settlement.instrumentSymbol} to ${settlement.destination}`,
      lines: [
        { account: "user:tokens_owed", unit: settlement.instrumentSymbol, amount: qty },
        { account: "clearing:tokens", unit: settlement.instrumentSymbol, amount: -qty },
      ],
    });
    await tx.update(weeklyBatches).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(weeklyBatches.id, batchId));
    await audit(tx, batch.env, SYSTEM, "settlement.settled", { type: "batch", id: batchId }, { providerRef: result.providerRef });
  });
  return "done";
}

/* ------------------------------------------------------------------- refund */

async function refund(db: Db, resolve: AdapterResolver, batchId: string, now: Date): Promise<JobOutcome> {
  const { batch, user } = await batchContext(db, batchId);
  if (batch.status !== "refund_pending") return "done";
  const [attempt] = await db
    .select()
    .from(fundingAttempts)
    .where(and(eq(fundingAttempts.batchId, batchId), eq(fundingAttempts.status, "refund_pending")));
  if (!attempt) return "done";
  const adapter = resolve(user.env).funding;
  const key = `refund:${attempt.id}`;
  const result =
    (await adapter.get(key)) ?? (await adapter.refund({ idempotencyKey: key, userId: user.id, chargeKey: attempt.idempotencyKey, amountCents: attempt.amountCents }));
  if (result.status === "pending") return AGAIN;
  if (result.status === "failed") throw new Error(result.error ?? "Refund failed");

  await db.transaction(async (tx) => {
    const locked = await lockBatch(tx, batchId);
    if (locked.status !== "refund_pending") return;
    await tx.update(fundingAttempts).set({ status: "refunded", updatedAt: now }).where(eq(fundingAttempts.id, attempt.id));
    await postJournal(tx, {
      key: `refund:${attempt.id}`,
      userId: user.id,
      env: user.env,
      batchId,
      memo: "Collected round-ups returned after the order failed",
      lines: [
        { account: "user:funds", unit: "USD", amount: BigInt(attempt.amountCents) },
        { account: "clearing:funds_held", unit: "USD", amount: -BigInt(attempt.amountCents) },
      ],
    });
    await tx
      .update(weeklyBatches)
      .set({ status: "refunded", failureReason: "The order could not be filled. The collected amount was returned.", completedAt: now, updatedAt: now })
      .where(eq(weeklyBatches.id, batchId));
    await audit(tx, locked.env, SYSTEM, "refund.completed", { type: "batch", id: batchId }, { amountCents: attempt.amountCents });
  });
  return "done";
}

export function pipelineHandlers(db: Db, resolve: AdapterResolver): Record<string, JobHandler> {
  return {
    "batch.fund": (p, now) => fund(db, resolve, p.batchId, now),
    "batch.execute": (p, now) => execute(db, resolve, p.batchId, now),
    "batch.settle": (p, now) => settle(db, resolve, p.batchId, now),
    "batch.refund": (p, now) => refund(db, resolve, p.batchId, now),
  };
}
