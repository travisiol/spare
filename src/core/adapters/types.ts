/**
 * Provider boundaries. Each concern is a separate adapter because each is a
 * separate permission in the real world:
 *
 *   wallet identity  ≠  reading transactions  ≠  collecting money  ≠  buying stock  ≠  delivering it
 *
 * Every mutating call takes an idempotency key and every adapter can look an
 * operation up by that key, so an uncertain outcome is reconciled before
 * anything is retried.
 */

export interface Availability {
  available: boolean;
  /** Shown to users and admins when unavailable: what is missing. */
  reason?: string;
}

export interface TransactionSourceAdapter {
  provider: string;
  label: string;
  availability(): Availability;
  /** Links an account for read-only transaction data. Grants no ability to move money. */
  connect(userId: string): Promise<{ externalRef: string; label: string }>;
}

export interface OpResult {
  status: "pending" | "succeeded" | "failed";
  providerRef: string;
  error?: string;
}

export interface FundingAdapter {
  provider: string;
  label: string;
  availability(): Availability;
  /** Sets up the method a later, per-batch approval can collect from. Collects nothing. */
  connect(userId: string): Promise<{ externalRef: string; label: string }>;
  collect(req: { idempotencyKey: string; userId: string; connectionRef: string; amountCents: number; purpose: string }): Promise<OpResult>;
  refund(req: { idempotencyKey: string; userId: string; chargeKey: string; amountCents: number }): Promise<OpResult>;
  /** Null when the provider has never seen this key. */
  get(idempotencyKey: string): Promise<OpResult | null>;
}

export interface PriceQuote {
  /** USD per token, decimal string. */
  price: string;
  asOf: Date;
  source: string;
}

export interface PriceSource {
  label: string;
  quote(symbol: string): Promise<PriceQuote | null>;
}

export interface OrderResult {
  status: "pending" | "filled" | "failed";
  providerRef: string;
  /** Token base units. Present when filled. */
  filledQty?: string;
  fillPrice?: string;
  error?: string;
}

export interface ExecutionAdapter {
  provider: string;
  label: string;
  /** How the price is determined, in words the review screen can show. */
  method: string;
  availability(): Availability;
  /** True only when a supported execution route exists for this instrument. */
  supports(symbol: string): boolean;
  placeOrder(req: { idempotencyKey: string; userId: string; symbol: string; notionalCents: number }): Promise<OrderResult>;
  get(idempotencyKey: string): Promise<OrderResult | null>;
}

export interface SettlementResult {
  status: "pending" | "settled" | "failed";
  providerRef: string;
  error?: string;
}

export interface SettlementAdapter {
  provider: string;
  label: string;
  availability(): Availability;
  deliver(req: { idempotencyKey: string; userId: string; symbol: string; qty: string; destination: string }): Promise<SettlementResult>;
  get(idempotencyKey: string): Promise<SettlementResult | null>;
}

export interface AdapterSet {
  env: "demo" | "live";
  transactions: TransactionSourceAdapter;
  funding: FundingAdapter;
  prices: PriceSource;
  execution: ExecutionAdapter;
  settlement: SettlementAdapter;
}
