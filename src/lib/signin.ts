import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { CHAIN } from "@/config/network";

/** The statement every sign-in message carries. The server refuses any other. */
export const SIGN_IN_STATEMENT =
  "Sign in to SPARE. This signature only proves you own this wallet. It does not approve any payment or token spending.";

/** The EIP-4361 message the wallet signs. Valid for five minutes, for this site and chain only. */
export function buildSignInMessage(address: string, nonce: string, location: { host: string; origin: string }): string {
  const now = Date.now();
  return createSiweMessage({
    address: getAddress(address),
    chainId: CHAIN.id,
    domain: location.host,
    uri: location.origin,
    nonce,
    version: "1",
    statement: SIGN_IN_STATEMENT,
    issuedAt: new Date(now),
    expirationTime: new Date(now + 5 * 60_000),
  });
}
