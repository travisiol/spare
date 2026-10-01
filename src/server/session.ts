import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminForSessionToken, isAdminWallet, userForSessionToken } from "@/core/auth";
import type { Actor } from "@/core/audit";
import { getRuntime } from "./runtime";

export const SESSION_COOKIE = "spare_session";
export const ADMIN_COOKIE = "spare_admin";

export function cookieOptions(expires: Date) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires };
}

/** The signed-in user for this request, or null. Every page and action starts here. */
export async function currentUser() {
  // Reading the cookie first marks the route as dynamic before the database is touched.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const { db } = await getRuntime();
  return userForSessionToken(db, token, new Date());
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/?signin=1");
  return user;
}

/** Admin identity, verified on the server: an allowlisted wallet session or an admin-token session. */
export async function currentAdmin(): Promise<Actor | null> {
  const jar = await cookies();
  const { db } = await getRuntime();
  const viaToken = await adminForSessionToken(db, jar.get(ADMIN_COOKIE)?.value, new Date());
  if (viaToken) return { type: "admin", id: viaToken.id };
  const user = await currentUser();
  if (isAdminWallet(user)) return { type: "admin", id: `wallet:${user!.walletAddress}` };
  return null;
}

/** The host this request was addressed to. Sign-in messages must be issued for it. */
export async function expectedDomain(): Promise<string> {
  if (process.env.SPARE_APP_DOMAIN) return process.env.SPARE_APP_DOMAIN;
  if (process.env.NODE_ENV === "production") throw new Error("SPARE_APP_DOMAIN must be set in production.");
  return (await headers()).get("host") ?? "localhost";
}

/** Rejects cross-site POSTs to the JSON endpoints (server actions do this themselves). */
export async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (h.get("host") ?? "");
  } catch {
    return false;
  }
}
