/**
 * Demo adapters — a deterministic stand-in for external providers.
 *
 * They exist only for accounts whose env is "demo". Nothing here talks to a
 * network, moves money or produces a transaction hash. References are
 * prefixed "demo:" so a simulated record can never be mistaken for a real one.
 *
 * The simulated provider keeps its own record of each operation by
 * idempotency key (demo_provider_ops), exactly as a real processor would, so
 * the same retry and reconciliation paths run in the demo as in production.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { demoProviderOps, preferences, users, type DemoFlags } from "@/db/schema";
import { INSTRUMENTS, instrumentBySymbol } from "@/config/instruments";
import { tokensForNotional } from "../money";
import type {
  AdapterSet,
  ExecutionAdapter,
  FundingAdapter,
  OpResult,
  OrderResult,
  PriceSource,
  SettlementAdapter,
  SettlementResult,
  TransactionSourceAdapter,
} from "./types";

/** Fixed demo prices. Not market prices — labelled as such wherever shown. */
export const DEMO_PRICES: Record<string, string> = {
  AAPL: "250.00",
  TSLA: "400.00",
  NFLX: "100.00",
  NVDA: "125.00",
};
export const DEMO_PRICE_AS_OF = new Date("2026-01-01T00:00:00Z");

async function assertDemoUser(db: Db, userId: string) {
  const [u] = await db.select({ env: users.env }).from(users).where(eq(users.id, userId));
  if (!u || u.env !== "demo") throw new Error("Demo adapters can only act for demo accounts.");
}

/** Reads and clears a one-shot failure switch set from the demo controls. */
async function takeFlag<K extends keyof DemoFlags>(db: Db, userId: string, flag: K): Promise<DemoFlags[K]> {
  const [p] = await db.select({ demoFlags: preferences.demoFlags }).from(preferences).where(eq(preferences.userId, userId));
  const value = p?.demoFlags?.[flag];
  if (value) {
    const rest = { ...p!.demoFlags };
    delete rest[flag];
    await db.update(preferences).set({ demoFlags: rest }).where(eq(preferences.userId, userId));
  }
  return value;
}

async function createOp(db: Db, op: { key: string; kind: string; userId: string; finalStatus: string; pollsLeft: number; result?: Record<string, string> }) {
  await db.insert(demoProviderOps).values({ ...op, result: op.result ?? {} }).onConflictDoNothing();
}

/** One poll of the simulated provider: pending until its polls run out, then final. */
async function pollOp(db: Db, key: string) {
  const [op] = await db.select().from(demoProviderOps).where(eq(demoProviderOps.key, key));
  if (!op) return null;
  if (op.pollsLeft > 0) {
    await db.update(demoProviderOps).set({ pollsLeft: sql`${demoProviderOps.pollsLeft} - 1` }).where(eq(demoProviderOps.key, key));
    return { ...op, status: "pending" as const };
  }
  return { ...op, status: op.finalStatus };
}

const ref = (key: string) => `demo:${key}`;

function transactions(): TransactionSourceAdapter {
  return {
    provider: "demo-bank",
    label: "Demo card (simulated purchases)",
    availability: () => ({ available: true }),
    connect: async (userId) => ({ externalRef: `demo-card-${userId}`, label: "Demo card •••• 4242" }),
  };
}

function funding(db: Db): FundingAdapter {
  const toResult = (op: NonNullable<Awaited<ReturnType<typeof pollOp>>>): OpResult => ({
    status: op.status as OpResult["status"],
    providerRef: ref(op.key),
    error: op.status === "failed" ? op.result.error : undefined,
  });
  return {
    provider: "demo-funding",
    label: "Demo balance (simulated)",
    availability: () => ({ available: true }),
    connect: async (userId) => ({ externalRef: `demo-balance-${userId}`, label: "Demo balance (no real money)" }),
    async collect(req) {
      await assertDemoUser(db, req.userId);
      const existing = await pollOp(db, req.idempotencyKey);
      if (existing) return toResult(existing);
      const flag = await takeFlag(db, req.userId, "nextFunding");
      await createOp(db, {
        key: req.idempotencyKey,
        kind: "collect",
        userId: req.userId,
        finalStatus: flag === "fail" ? "failed" : "succeeded",
        pollsLeft: 1,
        result: flag === "fail" ? { error: "Simulated decline: the demo funding method refused the charge." } : {},
      });
      if (flag === "uncertain") {
        // The provider accepted the charge but the response was lost.
        throw new Error("Simulated timeout: no response from the demo funding provider.");
      }
      return { status: "pending", providerRef: ref(req.idempotencyKey) };
    },
    async refund(req) {
      await assertDemoUser(db, req.userId);
      await createOp(db, { key: req.idempotencyKey, kind: "refund", userId: req.userId, finalStatus: "succeeded", pollsLeft: 1 });
      return toResult((await pollOp(db, req.idempotencyKey))!);
    },
    async get(key) {
      const op = await pollOp(db, key);
      return op ? toResult(op) : null;
    },
  };
}

function prices(): PriceSource {
  return {
    label: "Demo price (fixed, not a market price)",
    quote: async (symbol) =>
      DEMO_PRICES[symbol] ? { price: DEMO_PRICES[symbol], asOf: DEMO_PRICE_AS_OF, source: "Demo price (fixed, not a market price)" } : null,
  };
}

function execution(db: Db): ExecutionAdapter {
  const toResult = (op: NonNullable<Awaited<ReturnType<typeof pollOp>>>): OrderResult => ({
    status: op.status as OrderResult["status"],
    providerRef: ref(op.key),
    filledQty: op.status === "filled" ? op.result.qty : undefined,
    fillPrice: op.status === "filled" ? op.result.price : undefined,
    error: op.status === "failed" ? op.result.error : undefined,
  });
  return {
    provider: "demo-execution",
    label: "Demo execution (simulated)",
    method: "Simulated market order at the fixed demo price. No real order is placed.",
    availability: () => ({ available: true }),
    supports: (symbol) => INSTRUMENTS.some((i) => i.symbol === symbol) && symbol in DEMO_PRICES,
    async placeOrder(req) {
      await assertDemoUser(db, req.userId);
      const existing = await pollOp(db, req.idempotencyKey);
      if (existing) return toResult(existing);
      const flag = await takeFlag(db, req.userId, "nextOrder");
      const instrument = instrumentBySymbol(req.symbol)!;
      const price = DEMO_PRICES[req.symbol];
      await createOp(db, {
        key: req.idempotencyKey,
        kind: "order",
        userId: req.userId,
        finalStatus: flag === "fail" ? "failed" : "filled",
        pollsLeft: 1,
        result:
          flag === "fail"
            ? { error: "Simulated rejection: the demo venue did not fill the order." }
            : { price, qty: tokensForNotional(req.notionalCents, price, instrument.decimals).toString() },
      });
      return { status: "pending", providerRef: ref(req.idempotencyKey) };
    },
    async get(key) {
      const op = await pollOp(db, key);
      return op ? toResult(op) : null;
    },
  };
}

function settlement(db: Db): SettlementAdapter {
  const toResult = (op: NonNullable<Awaited<ReturnType<typeof pollOp>>>): SettlementResult => ({
    status: op.status as SettlementResult["status"],
    providerRef: ref(op.key),
  });
  return {
    provider: "demo-settlement",
    label: "Demo wallet (simulated delivery)",
    availability: () => ({ available: true }),
    async deliver(req) {
      await assertDemoUser(db, req.userId);
      const existing = await pollOp(db, req.idempotencyKey);
      if (existing) return toResult(existing);
      const flag = await takeFlag(db, req.userId, "nextSettlement");
      await createOp(db, { key: req.idempotencyKey, kind: "deliver", userId: req.userId, finalStatus: "settled", pollsLeft: flag === "slow" ? 6 : 1 });
      return { status: "pending", providerRef: ref(req.idempotencyKey) };
    },
    async get(key) {
      const op = await pollOp(db, key);
      return op ? toResult(op) : null;
    },
  };
}

export function demoAdapters(db: Db): AdapterSet {
  return {
    env: "demo",
    transactions: transactions(),
    funding: funding(db),
    prices: prices(),
    execution: execution(db),
    settlement: settlement(db),
  };
}
