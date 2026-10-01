/**
 * Live adapters.
 *
 * What is real today:
 *  - prices: the issuer's read-only price API (bid/ask with a timestamp).
 *  - transactions: a signed-webhook ingestion endpoint
 *    (POST /api/webhooks/transactions/webhook) for a card or bank data
 *    provider. It is available once SPARE_TXN_WEBHOOK_SECRET is set.
 *
 * What is NOT connected, and therefore reports itself unavailable instead of
 * pretending:
 *  - funding: no payment processor or on-chain collection contract is configured.
 *  - execution: the issuer publishes no order API. Stock tokens trade on
 *    secondary venues (RFQ aggregators, AMMs); routing customer orders there
 *    needs a reviewed, compliant integration. A generic token swap is not one.
 *  - settlement: follows from execution.
 *
 * A live account can therefore sign in, attest eligibility and manage
 * settings, but cannot start a charge. Nothing falls back to the demo.
 */
import { ISSUER } from "@/config/network";
import type {
  AdapterSet,
  Availability,
  ExecutionAdapter,
  FundingAdapter,
  PriceSource,
  SettlementAdapter,
  TransactionSourceAdapter,
} from "./types";

export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured for live accounts.`);
    this.name = "NotConfiguredError";
  }
}

const FUNDING_MISSING: Availability = {
  available: false,
  reason: "No funding provider is connected yet. SPARE cannot collect money from live accounts until a payment processor or on-chain collection contract is configured.",
};
const EXECUTION_MISSING: Availability = {
  available: false,
  reason: "No execution provider is connected yet. The token issuer offers no order API, so buying stock tokens for customers needs a reviewed route through a supported trading venue.",
};

function transactions(): TransactionSourceAdapter {
  const configured = Boolean(process.env.SPARE_TXN_WEBHOOK_SECRET);
  return {
    provider: "webhook",
    label: "Card or bank data provider (signed webhook)",
    availability: () =>
      configured
        ? { available: true }
        : { available: false, reason: "No transaction data provider is connected yet. Set SPARE_TXN_WEBHOOK_SECRET and point a card or bank data provider at the webhook endpoint." },
    connect: async () => {
      // Linking happens in the provider's own flow, which then calls back with an account reference.
      throw new NotConfiguredError("Account linking");
    },
  };
}

function funding(): FundingAdapter {
  const fail = async (): Promise<never> => {
    throw new NotConfiguredError("Funding");
  };
  return {
    provider: "unconfigured-funding",
    label: "Not connected",
    availability: () => FUNDING_MISSING,
    connect: fail,
    collect: fail,
    refund: fail,
    get: async () => null,
  };
}

interface RhjQuote {
  tokenBid?: string;
  tokenAsk?: string;
  isTradingHalt?: boolean;
  generatedAt?: string;
  currency?: string;
}

/** Issuer price API. tokenBid/tokenAsk already include the corporate-action multiplier. */
export function issuerPrices(fetchImpl: typeof fetch = fetch): PriceSource {
  return {
    label: "Issuer price API (token mid price)",
    async quote(symbol) {
      try {
        const res = await fetchImpl(`${ISSUER.apiBase}/prices/${encodeURIComponent(symbol)}`, {
          headers: { accept: "application/json", "user-agent": "spare/0.1" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { quotes?: RhjQuote[] };
        const q = body.quotes?.[0];
        if (!q?.tokenBid || !q.tokenAsk || !q.generatedAt || q.currency !== "USD" || q.isTradingHalt) return null;
        const mid = (Number(q.tokenBid) + Number(q.tokenAsk)) / 2;
        if (!Number.isFinite(mid) || mid <= 0) return null;
        return { price: mid.toFixed(4), asOf: new Date(q.generatedAt), source: "Issuer price API (token mid price)" };
      } catch {
        return null;
      }
    },
  };
}

function execution(): ExecutionAdapter {
  const fail = async (): Promise<never> => {
    throw new NotConfiguredError("Execution");
  };
  return {
    provider: "unconfigured-execution",
    label: "Not connected",
    method: "Not available",
    availability: () => EXECUTION_MISSING,
    supports: () => false,
    placeOrder: fail,
    get: async () => null,
  };
}

function settlement(): SettlementAdapter {
  return {
    provider: "unconfigured-settlement",
    label: "Not connected",
    availability: () => EXECUTION_MISSING,
    deliver: async () => {
      throw new NotConfiguredError("Settlement");
    },
    get: async () => null,
  };
}

export function liveAdapters(): AdapterSet {
  return {
    env: "live",
    transactions: transactions(),
    funding: funding(),
    prices: issuerPrices(),
    execution: execution(),
    settlement: settlement(),
  };
}
