/**
 * Signed webhook for transaction data providers.
 *
 * Header:  x-spare-signature: t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">
 * The signature is checked against the raw bytes before anything is parsed,
 * and a timestamp outside the tolerance is refused (replay protection on top
 * of the per-event idempotency key).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderEvent, ProviderEventType } from "./ingest";

const TOLERANCE_S = 300;
const TYPES: ProviderEventType[] = ["transaction.pending", "transaction.posted", "transaction.refunded", "transaction.reversed", "transaction.removed"];

export function signWebhook(secret: string, rawBody: string, timestamp: number): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null, now: Date): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(now.getTime() / 1000 - t) > TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Validates the body shape. Returns null for anything malformed — nothing is guessed. */
export function parseWebhookEvent(provider: string, rawBody: string): ProviderEvent | null {
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const t = b.transaction as Record<string, unknown> | undefined;
  const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
  const date = (v: unknown) => (str(v) && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  if (!t || !str(b.id) || !str(b.account_id) || !TYPES.includes(b.type as ProviderEventType)) return null;
  const occurredAt = date(b.occurred_at);
  const authorizedAt = date(t.authorized_at);
  if (!occurredAt || !authorizedAt || !str(t.id) || !str(t.merchant) || !str(t.currency) || !str(t.category)) return null;
  if (typeof t.amount_minor !== "number" || !Number.isInteger(t.amount_minor)) return null;
  return {
    provider,
    eventId: b.id,
    type: b.type as ProviderEventType,
    occurredAt,
    connectionRef: b.account_id,
    transaction: {
      id: t.id,
      pendingId: str(t.pending_id) ? t.pending_id : null,
      merchant: t.merchant,
      amountCents: t.amount_minor,
      currency: t.currency.toUpperCase(),
      category: t.category,
      authorizedAt,
      postedAt: date(t.posted_at),
    },
  };
}
