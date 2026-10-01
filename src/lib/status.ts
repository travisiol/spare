import type { BatchStatus, EntryStatus, PurchaseStatus } from "@/db/schema";

export type Tone = "neutral" | "active" | "good" | "warn";

/** What each batch state means, in the words the user sees. */
export const BATCH_STATUS: Record<BatchStatus, { label: string; tone: Tone; detail: string }> = {
  tracking: { label: "Tracking", tone: "neutral", detail: "This week is still open. Round-ups are being counted." },
  ready_for_approval: { label: "Ready for approval", tone: "active", detail: "The week is closed and waiting for your decision. Nothing has been charged." },
  approved: { label: "Approved", tone: "active", detail: "You approved this amount. Funding is about to start." },
  funding_pending: { label: "Funding pending", tone: "active", detail: "The approved amount is being collected. It is not confirmed yet." },
  funding_failed: { label: "Funding failed", tone: "warn", detail: "The charge did not go through. Nothing was collected." },
  funded: { label: "Funded", tone: "active", detail: "The amount was collected. The stock order has not been placed yet." },
  order_pending: { label: "Order pending", tone: "active", detail: "The order has been sent. It is not filled yet." },
  order_failed: { label: "Order failed", tone: "warn", detail: "The order was not filled. Your funds are held and were not spent." },
  executed: { label: "Executed", tone: "active", detail: "The order filled. The tokens have not been delivered yet." },
  settlement_pending: { label: "Settlement pending", tone: "active", detail: "The tokens are on their way to your wallet." },
  completed: { label: "Completed", tone: "good", detail: "The tokens were delivered." },
  refund_pending: { label: "Refund pending", tone: "active", detail: "The collected amount is being returned." },
  refunded: { label: "Refunded", tone: "neutral", detail: "The collected amount was returned in full." },
  cancelled: { label: "Skipped", tone: "neutral", detail: "This week was skipped. Nothing was charged." },
  expired: { label: "Expired", tone: "neutral", detail: "This week was not approved in time. Nothing was charged." },
  carried_forward: { label: "Carried forward", tone: "neutral", detail: "Below the minimum. Its round-ups moved into the next week." },
  empty: { label: "No round-ups", tone: "neutral", detail: "There were no eligible round-ups this week." },
};

/** The post-approval path, in order. */
export const PIPELINE: { key: string; label: string; reached: BatchStatus[]; active: BatchStatus[] }[] = [
  { key: "approved", label: "Approved", active: [], reached: ["approved", "funding_pending", "funding_failed", "funded", "order_pending", "order_failed", "executed", "settlement_pending", "completed", "refund_pending", "refunded"] },
  { key: "funded", label: "Funded", active: ["approved", "funding_pending"], reached: ["funded", "order_pending", "order_failed", "executed", "settlement_pending", "completed", "refund_pending", "refunded"] },
  { key: "executed", label: "Order filled", active: ["funded", "order_pending"], reached: ["executed", "settlement_pending", "completed"] },
  { key: "completed", label: "Delivered", active: ["executed", "settlement_pending"], reached: ["completed"] },
];

export const PURCHASE_STATUS: Record<PurchaseStatus, string> = {
  pending: "Pending",
  posted: "Posted",
  refunded: "Refunded",
  reversed: "Reversed",
  void: "Dropped",
};

export const ENTRY_STATUS: Record<EntryStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting to post", tone: "neutral" },
  tracked: { label: "Counted", tone: "good" },
  excluded: { label: "Excluded", tone: "neutral" },
  reversed: { label: "Removed", tone: "warn" },
};
