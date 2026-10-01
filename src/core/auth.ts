/**
 * Wallet authentication: Sign-In with Ethereum (EIP-4361) on Robinhood Chain.
 *
 * Connecting a wallet proves nothing. A session exists only after the wallet
 * signs a message carrying a one-time, expiring nonce issued by this server,
 * for this domain and this chain. Signing in asks for no spending permission.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createPublicClient, http, verifyMessage, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import type { Db } from "@/db/client";
import { adminSessions, authNonces, preferences, sessions, users } from "@/db/schema";
import { CHAIN } from "@/config/network";
import { POLICY } from "@/config/policy";
import { SIGN_IN_STATEMENT } from "@/lib/signin";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { isValidTimezone } from "./weeks";

const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 3_600_000;
const ADMIN_SESSION_TTL_MS = 8 * 3_600_000;

export { SIGN_IN_STATEMENT };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createNonce(db: Db, now: Date): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  await db.insert(authNonces).values({ nonce, expiresAt: new Date(now.getTime() + NONCE_TTL_MS) });
  return nonce;
}

export type SignatureVerifier = (args: { address: Hex; message: string; signature: Hex }) => Promise<boolean>;

/** EOA signatures are checked locally; contract wallets (ERC-1271) are checked on chain. */
export const defaultVerifier: SignatureVerifier = async (args) => {
  try {
    if (await verifyMessage(args)) return true;
  } catch {
    // Not a recoverable EOA signature; fall through to the on-chain check.
  }
  try {
    const client = createPublicClient({ transport: http(CHAIN.rpcUrl, { timeout: 5000 }) });
    return await client.verifyMessage(args);
  } catch {
    return false;
  }
};

export async function ensurePreferences(db: Db, userId: string): Promise<void> {
  await db.insert(preferences).values({ userId, weeklyCapCents: POLICY.defaultWeeklyCapCents }).onConflictDoNothing();
}

export async function createSession(db: Db, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: hash(token), expiresAt });
  return { token, expiresAt };
}

export async function signInWithWallet(
  db: Db,
  input: { message: string; signature: string; expectedDomain: string; timezone?: string },
  now: Date,
  verify: SignatureVerifier = defaultVerifier,
): Promise<{ token: string; expiresAt: Date; userId: string }> {
  const bad = (message: string) => new DomainError("sign_in_failed", message, 401);
  const parsed = parseSiweMessage(input.message);
  if (!parsed.address || !parsed.nonce) throw bad("That sign-in message is not valid.");
  if (parsed.chainId !== CHAIN.id) throw bad(`Switch your wallet to ${CHAIN.name} to sign in.`);
  if (parsed.statement !== SIGN_IN_STATEMENT) throw bad("That sign-in message is not valid.");
  // Domain binding: a signature collected by another site is useless here.
  if (!validateSiweMessage({ message: parsed, domain: input.expectedDomain, nonce: parsed.nonce, time: now })) {
    throw bad("That sign-in message was issued for a different site or has expired.");
  }
  if (!parsed.uri || new URL(parsed.uri).host !== input.expectedDomain) throw bad("That sign-in message was issued for a different site.");
  if (!(await verify({ address: parsed.address, message: input.message, signature: input.signature as Hex }))) {
    throw bad("The signature does not match this wallet.");
  }
  // One use only, and only while it is fresh. The update is the atomic claim.
  const claimed = await db
    .update(authNonces)
    .set({ consumedAt: now })
    .where(and(eq(authNonces.nonce, parsed.nonce), isNull(authNonces.consumedAt), gt(authNonces.expiresAt, now)))
    .returning({ nonce: authNonces.nonce });
  if (claimed.length === 0) throw bad("That sign-in request has expired or was already used. Try again.");

  const wallet = parsed.address.toLowerCase();
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "UTC";
  await db.insert(users).values({ env: "live", walletAddress: wallet, timezone }).onConflictDoNothing();
  const [user] = await db.select().from(users).where(and(eq(users.env, "live"), eq(users.walletAddress, wallet)));
  await ensurePreferences(db, user.id);
  await audit(db, "live", { type: "user", id: user.id }, "auth.signed_in", { type: "user", id: user.id });
  return { ...(await createSession(db, user.id, now)), userId: user.id };
}

/** A demo account: no wallet, no real provider, its own isolated records. */
export async function startDemoSession(db: Db, timezone: string | undefined, now: Date): Promise<{ token: string; expiresAt: Date; userId: string }> {
  const tz = timezone && isValidTimezone(timezone) ? timezone : "UTC";
  const [user] = await db.insert(users).values({ env: "demo", walletAddress: null, timezone: tz }).returning();
  await ensurePreferences(db, user.id);
  await audit(db, "demo", { type: "user", id: user.id }, "demo.started", { type: "user", id: user.id });
  return { ...(await createSession(db, user.id, now)), userId: user.id };
}

export async function userForSessionToken(db: Db, token: string | undefined, now: Date) {
  if (!token) return null;
  const [row] = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hash(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  return row ? { ...row.user, sessionId: row.sessionId } : null;
}

export async function revokeSession(db: Db, token: string | undefined, now: Date): Promise<void> {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.tokenHash, hash(token)));
}

export async function revokeAllSessions(db: Db, userId: string, now: Date): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/* -------------------------------------------------------------------- admin */

function adminWallets(): string[] {
  return (process.env.ADMIN_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
}

/** A signed-in live wallet on the ADMIN_WALLETS allowlist is an administrator. */
export function isAdminWallet(user: { env: string; walletAddress: string | null } | null): boolean {
  return Boolean(user && user.env === "live" && user.walletAddress && adminWallets().includes(user.walletAddress));
}

/** Operator sign-in with ADMIN_TOKEN, for setups without an admin wallet. */
export async function signInAdminWithToken(db: Db, token: string, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const expected = process.env.ADMIN_TOKEN ?? "";
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(expected).digest();
  const { timingSafeEqual } = await import("node:crypto");
  if (expected.length < 16 || !timingSafeEqual(a, b)) {
    await audit(db, "system", { type: "admin" }, "admin.sign_in_refused");
    throw new DomainError("admin_refused", "That admin token is not valid.", 401);
  }
  const session = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_MS);
  await db.insert(adminSessions).values({ tokenHash: hash(session), label: "token", expiresAt });
  await audit(db, "system", { type: "admin", id: "token" }, "admin.signed_in");
  return { token: session, expiresAt };
}

export async function adminForSessionToken(db: Db, token: string | undefined, now: Date): Promise<{ id: string } | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: adminSessions.id })
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, hash(token)), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, now)));
  return row ? { id: `token:${row.id}` } : null;
}

export async function revokeAdminSession(db: Db, token: string | undefined, now: Date): Promise<void> {
  if (!token) return;
  await db.update(adminSessions).set({ revokedAt: now }).where(eq(adminSessions.tokenHash, hash(token)));
}
