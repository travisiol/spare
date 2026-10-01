/**
 * Account setup and controls. Every function takes the authenticated user's
 * id and only ever touches that user's rows.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { connections, preferences, users, type ConnectionKind } from "@/db/schema";
import { INSTRUMENTS } from "@/config/instruments";
import { POLICY } from "@/config/policy";
import type { AdapterResolver } from "./adapters";
import { audit } from "./audit";
import { revokeAllSessions } from "./auth";
import { DomainError } from "./errors";
import { isValidTimezone } from "./weeks";

type User = typeof users.$inferSelect;

export const ONBOARDING_STEPS = [
  { key: "wallet", title: "Sign in" },
  { key: "eligibility", title: "Eligibility" },
  { key: "company", title: "Pick a company" },
  { key: "transactions", title: "Purchase data" },
  { key: "funding", title: "Funding method" },
  { key: "cap", title: "Weekly cap" },
  { key: "approval", title: "Weekly approval" },
  { key: "activate", title: "Start tracking" },
] as const;
export type OnboardingKey = (typeof ONBOARDING_STEPS)[number]["key"];

export async function loadAccount(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [prefs] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  const conns = await db.select().from(connections).where(and(eq(connections.userId, userId), eq(connections.status, "active")));
  return {
    user,
    prefs,
    transactionSource: conns.find((c) => c.kind === "transaction_source") ?? null,
    fundingMethod: conns.find((c) => c.kind === "funding") ?? null,
  };
}

/** Which setup steps are done. Derived from stored facts, so setup resumes wherever it stopped. */
export async function onboardingState(db: Db, userId: string) {
  const a = await loadAccount(db, userId);
  const done: Record<OnboardingKey, boolean> = {
    wallet: true,
    eligibility: Boolean(a.user.eligibilityAttestedAt),
    company: Boolean(a.prefs.instrumentSymbol),
    transactions: Boolean(a.transactionSource),
    funding: Boolean(a.fundingMethod),
    cap: Boolean(a.prefs.capConfirmedAt),
    approval: Boolean(a.prefs.approvalAcknowledgedAt),
    activate: Boolean(a.prefs.trackingActivatedAt),
  };
  const current = ONBOARDING_STEPS.find((s) => !done[s.key])?.key ?? null;
  return { ...a, done, current, complete: current === null };
}

export function instrumentOptions(resolve: AdapterResolver, env: User["env"]) {
  const execution = resolve(env).execution;
  return INSTRUMENTS.map((i) => ({ ...i, selectable: execution.supports(i.symbol) }));
}

export async function attestEligibility(db: Db, user: User, now: Date): Promise<void> {
  await db.update(users).set({ eligibilityAttestedAt: now }).where(eq(users.id, user.id));
  await audit(db, user.env, { type: "user", id: user.id }, "eligibility.attested", { type: "user", id: user.id }, {
    statement: "Not a US person or US resident; not resident in a jurisdiction the issuer restricts.",
  });
}

/** Applies to batches that have not closed yet. Never sells holdings, never alters an approved batch. */
export async function chooseInstrument(db: Db, resolve: AdapterResolver, user: User, symbol: string, now: Date): Promise<void> {
  const option = instrumentOptions(resolve, user.env).find((i) => i.symbol === symbol);
  if (!option) throw new DomainError("unknown_instrument", "That company is not in the catalogue.");
  if (!option.selectable) {
    throw new DomainError("no_route", `${symbol} is not available yet: ${resolve(user.env).execution.availability().reason ?? "no supported execution route."}`, 409);
  }
  await db.update(preferences).set({ instrumentSymbol: symbol, updatedAt: now }).where(eq(preferences.userId, user.id));
  await audit(db, user.env, { type: "user", id: user.id }, "instrument.selected", { type: "user", id: user.id }, { symbol });
}

export async function connect(db: Db, resolve: AdapterResolver, user: User, kind: ConnectionKind, now: Date): Promise<void> {
  const adapters = resolve(user.env);
  const adapter = kind === "transaction_source" ? adapters.transactions : adapters.funding;
  const availability = adapter.availability();
  if (!availability.available) throw new DomainError("unavailable", availability.reason ?? "This connection is not available.", 409);
  const linked = await adapter.connect(user.id);
  await db
    .insert(connections)
    .values({ userId: user.id, env: user.env, kind, provider: adapter.provider, externalRef: linked.externalRef, label: linked.label })
    .onConflictDoUpdate({
      target: [connections.provider, connections.externalRef],
      set: { status: "active", disconnectedAt: null, label: linked.label },
      setWhere: eq(connections.userId, user.id),
    });
  await audit(db, user.env, { type: "user", id: user.id }, "connection.connected", { type: "user", id: user.id }, { kind, provider: adapter.provider, at: now.toISOString() });
}

export async function disconnect(db: Db, user: User, connectionId: string, now: Date): Promise<void> {
  const rows = await db
    .update(connections)
    .set({ status: "disconnected", disconnectedAt: now })
    .where(and(eq(connections.id, connectionId), eq(connections.userId, user.id), eq(connections.status, "active")))
    .returning({ kind: connections.kind });
  if (rows.length === 0) throw new DomainError("not_found", "That connection does not exist.", 404);
  await audit(db, user.env, { type: "user", id: user.id }, "connection.disconnected", { type: "connection", id: connectionId }, { kind: rows[0].kind });
}

export async function setWeeklyCap(db: Db, user: User, capCents: number, now: Date): Promise<void> {
  if (!Number.isInteger(capCents) || capCents < POLICY.minWeeklyCapCents || capCents > POLICY.maxWeeklyCapCents) {
    throw new DomainError("bad_cap", `Choose a weekly cap between $${POLICY.minWeeklyCapCents / 100} and $${POLICY.maxWeeklyCapCents / 100}.`);
  }
  await db.update(preferences).set({ weeklyCapCents: capCents, capConfirmedAt: now, updatedAt: now }).where(eq(preferences.userId, user.id));
  await audit(db, user.env, { type: "user", id: user.id }, "cap.set", { type: "user", id: user.id }, { capCents });
}

export async function acknowledgeApproval(db: Db, user: User, now: Date): Promise<void> {
  await db.update(preferences).set({ approvalAcknowledgedAt: now, updatedAt: now }).where(eq(preferences.userId, user.id));
}

export async function activateTracking(db: Db, user: User, now: Date): Promise<void> {
  const state = await onboardingState(db, user.id);
  if (state.current !== "activate") throw new DomainError("setup_incomplete", "Finish the earlier setup steps first.", 409);
  await db.update(preferences).set({ trackingActivatedAt: now, paused: false, updatedAt: now }).where(eq(preferences.userId, user.id));
  await audit(db, user.env, { type: "user", id: user.id }, "tracking.activated", { type: "user", id: user.id });
}

export async function setPaused(db: Db, user: User, paused: boolean, now: Date): Promise<void> {
  await db.update(preferences).set({ paused, updatedAt: now }).where(eq(preferences.userId, user.id));
  await audit(db, user.env, { type: "user", id: user.id }, paused ? "tracking.paused" : "tracking.resumed", { type: "user", id: user.id });
}

/** Takes effect for weeks that have not opened yet; open batches keep their own cutoff. */
export async function setTimezone(db: Db, user: User, timezone: string): Promise<void> {
  if (!isValidTimezone(timezone)) throw new DomainError("bad_timezone", "That timezone is not recognised.");
  await db.update(users).set({ timezone }).where(eq(users.id, user.id));
  await audit(db, user.env, { type: "user", id: user.id }, "timezone.set", { type: "user", id: user.id }, { timezone });
}

/** Stops everything SPARE does for this account. History is kept; holdings stay in the user's wallet. */
export async function closeAccount(db: Db, user: User, now: Date): Promise<void> {
  await db.update(preferences).set({ paused: true, updatedAt: now }).where(eq(preferences.userId, user.id));
  await db
    .update(connections)
    .set({ status: "disconnected", disconnectedAt: now })
    .where(and(eq(connections.userId, user.id), eq(connections.status, "active")));
  await revokeAllSessions(db, user.id, now);
  await audit(db, user.env, { type: "user", id: user.id }, "account.closed", { type: "user", id: user.id });
}
