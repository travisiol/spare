import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSession, startDemoSession } from "@/core/auth";
import { getRuntime } from "@/server/runtime";
import { SESSION_COOKIE, assertSameOrigin, cookieOptions } from "@/server/session";

/** Starts a fresh, isolated demo account. No wallet, no real provider, no real money. */
export async function POST(request: Request) {
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  if (process.env.SPARE_DEMO_ENABLED === "0") return NextResponse.json({ error: "The demo is disabled on this deployment." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { timezone?: unknown } | null;
  const { db } = await getRuntime();
  const jar = await cookies();
  const now = new Date();
  await revokeSession(db, jar.get(SESSION_COOKIE)?.value, now);
  const session = await startDemoSession(db, typeof body?.timezone === "string" ? body.timezone : undefined, now);
  jar.set(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt));
  return NextResponse.json({ ok: true });
}
