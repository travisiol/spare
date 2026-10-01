/** All money is integer minor units (cents). No floats touch an amount. */

/** The difference between a purchase and the next whole dollar. Exact dollars round up by nothing. */
export function roundUpCents(purchaseCents: number): number {
  if (!Number.isInteger(purchaseCents) || purchaseCents < 0) {
    throw new RangeError("purchaseCents must be a non-negative integer");
  }
  return (100 - (purchaseCents % 100)) % 100;
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parses "12", "12.5" or "12.50" into cents. Returns null for anything else. */
export function parseUsdToCents(input: string): number | null {
  const m = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/** Parses a decimal price string ("329.88") into micro-dollars as a bigint. */
export function priceToMicros(price: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!m) throw new RangeError(`not a price: ${price}`);
  const frac = (m[2] ?? "").slice(0, 6).padEnd(6, "0");
  return BigInt(m[1]) * 1_000_000n + BigInt(frac);
}

/** Token base units bought by `notionalCents` at `price` USD per token, rounded down. */
export function tokensForNotional(notionalCents: number, price: string, decimals: number): bigint {
  const micros = priceToMicros(price);
  if (micros <= 0n) throw new RangeError("price must be positive");
  return (BigInt(notionalCents) * 10_000n * 10n ** BigInt(decimals)) / micros;
}

/** Formats token base units as a decimal string with up to `places` fraction digits. */
export function formatTokenQty(baseUnits: bigint | string, decimals: number, places = 6): string {
  const v = BigInt(baseUnits);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** USD cents value of `baseUnits` tokens at `price`, rounded down. */
export function valueCents(baseUnits: bigint | string, price: string, decimals: number): number {
  return Number((BigInt(baseUnits) * priceToMicros(price)) / (10_000n * 10n ** BigInt(decimals)));
}
