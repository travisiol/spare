/**
 * Product policy — every number a user is told about lives here.
 * Values can be overridden by environment variables on the server.
 */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const POLICY = {
  /** MVP currency. Purchases in any other currency are tracked as ineligible. */
  currency: "USD",
  /** Default and allowed range for the weekly round-up cap, in cents. */
  defaultWeeklyCapCents: 1000,
  minWeeklyCapCents: 100,
  maxWeeklyCapCents: 10000,
  /** SPARE fee, in basis points of the round-up total. Added on top, shown before approval. */
  feeBps: intEnv("SPARE_FEE_BPS", 0),
  /** Smallest batch the execution provider accepts. Smaller batches carry forward. */
  minOrderCents: intEnv("SPARE_MIN_ORDER_CENTS", 100),
  /** How long a closed batch waits for the user's approval before it expires. */
  approvalWindowHours: intEnv("SPARE_APPROVAL_WINDOW_HOURS", 144),
  /** Order attempts allowed against one funded batch before a refund is the only path. */
  maxOrderAttempts: 3,
  /**
   * What happens when a purchase is refunded after its batch was approved.
   * "record_only": the refund is recorded as an adjustment. SPARE never sells
   * stock and never initiates another charge because of it.
   */
  postApprovalReversalPolicy: "record_only",
  /** Weeks run Monday 00:00 to Sunday 23:59:59 in the account's timezone. */
  weekStartsOn: "monday",
} as const;

export function feeFor(totalCents: number): number {
  return Math.floor((totalCents * POLICY.feeBps) / 10_000);
}
