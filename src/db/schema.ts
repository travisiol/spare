import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => ts("created_at").notNull().defaultNow();

/** "demo" and "live" records never mix: every provider-facing row carries its env. */
export type Env = "demo" | "live";

export const users = pgTable(
  "users",
  {
    id: id(),
    env: text("env").$type<Env>().notNull(),
    /** Lower-case EVM address. Null for demo accounts, which have no wallet. */
    walletAddress: text("wallet_address"),
    timezone: text("timezone").notNull().default("UTC"),
    eligibilityAttestedAt: ts("eligibility_attested_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_env_wallet").on(t.env, t.walletAddress)],
);

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash").on(t.tokenHash)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("admin_sessions_token_hash").on(t.tokenHash)],
);

export interface DemoFlags {
  nextFunding?: "fail" | "uncertain";
  nextOrder?: "fail";
  nextSettlement?: "slow";
}

export const preferences = pgTable("preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  instrumentSymbol: text("instrument_symbol"),
  weeklyCapCents: integer("weekly_cap_cents").notNull(),
  capConfirmedAt: ts("cap_confirmed_at"),
  approvalAcknowledgedAt: ts("approval_acknowledged_at"),
  trackingActivatedAt: ts("tracking_activated_at"),
  paused: boolean("paused").notNull().default(false),
  demoFlags: jsonb("demo_flags").$type<DemoFlags>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type ConnectionKind = "transaction_source" | "funding";

export const connections = pgTable(
  "connections",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    env: text("env").$type<Env>().notNull(),
    kind: text("kind").$type<ConnectionKind>().notNull(),
    provider: text("provider").notNull(),
    /** The provider's own reference for this account or mandate. */
    externalRef: text("external_ref").notNull(),
    label: text("label").notNull(),
    status: text("status").$type<"active" | "disconnected">().notNull().default("active"),
    createdAt: createdAt(),
    disconnectedAt: ts("disconnected_at"),
  },
  (t) => [
    uniqueIndex("connections_provider_ref").on(t.provider, t.externalRef),
    index("connections_user").on(t.userId),
  ],
);

/** Raw provider deliveries. The unique key makes re-delivery a no-op. */
export const transactionEvents = pgTable(
  "transaction_events",
  {
    id: id(),
    env: text("env").$type<Env>().notNull(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    outcome: text("outcome").notNull().default("received"),
    detail: text("detail"),
  },
  (t) => [uniqueIndex("transaction_events_provider_event").on(t.provider, t.externalEventId)],
);

export type PurchaseStatus = "pending" | "posted" | "refunded" | "reversed" | "void";

/** One canonical row per real-world transaction, whatever the number of events. */
export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    env: text("env").$type<Env>().notNull(),
    connectionId: uuid("connection_id").notNull().references(() => connections.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    /** The provider's id for the pending authorization this posted from. */
    pendingExternalId: text("pending_external_id"),
    merchant: text("merchant").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    category: text("category").notNull(),
    status: text("status").$type<PurchaseStatus>().notNull(),
    authorizedAt: ts("authorized_at").notNull(),
    postedAt: ts("posted_at"),
    lastEventAt: ts("last_event_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("purchases_provider_external").on(t.provider, t.externalId),
    uniqueIndex("purchases_provider_pending").on(t.provider, t.pendingExternalId),
    index("purchases_user").on(t.userId, t.authorizedAt),
  ],
);

export type EntryStatus = "pending" | "tracked" | "excluded" | "reversed";

export const roundupEntries = pgTable(
  "roundup_entries",
  {
    id: id(),
    purchaseId: uuid("purchase_id").notNull().references(() => purchases.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    batchId: uuid("batch_id"),
    /** Set when a below-minimum batch carried this entry into a later one. */
    carriedFromBatchId: uuid("carried_from_batch_id"),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").$type<EntryStatus>().notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roundup_entries_purchase").on(t.purchaseId),
    index("roundup_entries_batch").on(t.batchId),
  ],
);

export type BatchStatus =
  | "tracking"
  | "ready_for_approval"
  | "approved"
  | "funding_pending"
  | "funding_failed"
  | "funded"
  | "order_pending"
  | "order_failed"
  | "executed"
  | "settlement_pending"
  | "completed"
  | "refund_pending"
  | "refunded"
  | "cancelled"
  | "expired"
  | "carried_forward"
  | "empty";

export const weeklyBatches = pgTable(
  "weekly_batches",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    env: text("env").$type<Env>().notNull(),
    /** Local Monday of the week, YYYY-MM-DD, in `timezone`. */
    weekStart: text("week_start").notNull(),
    timezone: text("timezone").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: text("status").$type<BatchStatus>().notNull().default("tracking"),
    instrumentSymbol: text("instrument_symbol"),
    totalCents: integer("total_cents"),
    feeCents: integer("fee_cents"),
    authorizedCents: integer("authorized_cents"),
    snapshotHash: text("snapshot_hash"),
    frozenAt: ts("frozen_at"),
    approveBy: ts("approve_by"),
    approvedAt: ts("approved_at"),
    completedAt: ts("completed_at"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("weekly_batches_user_week").on(t.userId, t.weekStart)],
);

/** The user's consent. One per batch, never updated. */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => weeklyBatches.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    roundupCents: integer("roundup_cents").notNull(),
    feeCents: integer("fee_cents").notNull(),
    authorizedCents: integer("authorized_cents").notNull(),
    instrumentSymbol: text("instrument_symbol").notNull(),
    fundingConnectionId: uuid("funding_connection_id").notNull().references(() => connections.id),
    destination: text("destination").notNull(),
    statement: text("statement").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approvals_batch").on(t.batchId)],
);

export type AttemptStatus = "created" | "pending" | "succeeded" | "failed" | "uncertain" | "refund_pending" | "refunded";

export const fundingAttempts = pgTable(
  "funding_attempts",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => weeklyBatches.id),
    env: text("env").$type<Env>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").$type<AttemptStatus>().notNull(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("funding_attempts_key").on(t.idempotencyKey),
    // The duplicate-charge guard: at most one attempt per batch that is not definitively failed.
    uniqueIndex("funding_attempts_one_live").on(t.batchId).where(sql`status <> 'failed'`),
  ],
);

export const quotes = pgTable("quotes", {
  id: id(),
  batchId: uuid("batch_id").notNull().references(() => weeklyBatches.id),
  instrumentSymbol: text("instrument_symbol").notNull(),
  /** USD per token, decimal string. */
  price: text("price").notNull(),
  source: text("source").notNull(),
  asOf: ts("as_of").notNull(),
  createdAt: createdAt(),
});

export type OrderStatus = "created" | "pending" | "filled" | "failed" | "uncertain";

export const orders = pgTable(
  "orders",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => weeklyBatches.id),
    env: text("env").$type<Env>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    instrumentSymbol: text("instrument_symbol").notNull(),
    notionalCents: integer("notional_cents").notNull(),
    status: text("status").$type<OrderStatus>().notNull(),
    /** Token base units (integer string). */
    filledQty: text("filled_qty"),
    fillPrice: text("fill_price"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_key").on(t.idempotencyKey),
    uniqueIndex("orders_one_live").on(t.batchId).where(sql`status <> 'failed'`),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    batchId: uuid("batch_id").notNull().references(() => weeklyBatches.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    env: text("env").$type<Env>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    provider: text("provider").notNull(),
    /** Provider reference or transaction hash. Never invented. */
    providerRef: text("provider_ref"),
    destination: text("destination").notNull(),
    instrumentSymbol: text("instrument_symbol").notNull(),
    qty: text("qty").notNull(),
    status: text("status").$type<"created" | "pending" | "settled" | "failed" | "uncertain">().notNull(),
    error: text("error"),
    settledAt: ts("settled_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("settlements_order").on(t.orderId),
    uniqueIndex("settlements_key").on(t.idempotencyKey),
    uniqueIndex("settlements_provider_ref").on(t.provider, t.providerRef),
  ],
);

/**
 * Double-entry ledger. Every journal sums to zero per unit.
 * Amounts are signed integers: cents for USD, base units for tokens.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    journalId: uuid("journal_id").notNull(),
    /** Unique per business event, so a retried step cannot post twice. */
    journalKey: text("journal_key").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    env: text("env").$type<Env>().notNull(),
    batchId: uuid("batch_id"),
    account: text("account").notNull(),
    unit: text("unit").notNull(),
    amount: numeric("amount", { precision: 60, scale: 0 }).notNull(),
    memo: text("memo").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ledger_journal_line").on(t.journalKey, t.account, t.unit),
    index("ledger_user").on(t.userId),
  ],
);

/** A refund that arrived after its batch was approved. Recorded, never acted on automatically. */
export const adjustments = pgTable(
  "adjustments",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    purchaseId: uuid("purchase_id").notNull().references(() => purchases.id),
    batchId: uuid("batch_id").notNull().references(() => weeklyBatches.id),
    amountCents: integer("amount_cents").notNull(),
    policy: text("policy").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("adjustments_purchase").on(t.purchaseId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    env: text("env").$type<Env | "system">().notNull(),
    actorType: text("actor_type").$type<"user" | "admin" | "system" | "provider">().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created").on(t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    /** Idempotency key: enqueueing the same key twice keeps one job. */
    key: text("key").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "dead">().notNull().default("queued"),
    runAt: ts("run_at").notNull(),
    lockedUntil: ts("locked_until"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_key").on(t.key), index("jobs_due").on(t.status, t.runAt)],
);

/**
 * State of the simulated demo provider — it stands in for an external
 * processor, so it keeps its own idempotent record of each operation.
 */
export const demoProviderOps = pgTable("demo_provider_ops", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  finalStatus: text("final_status").notNull(),
  pollsLeft: integer("polls_left").notNull(),
  result: jsonb("result").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});
