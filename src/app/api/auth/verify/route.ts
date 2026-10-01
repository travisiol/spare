import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signInWithWallet } from "@/core/auth";
import { isDomainError } from "@/core/errors";
import { getRuntime } from "@/server/runtime";
import { SESSION_COOKIE, assertSameOrigin, cookieOptions, expectedDomain } from "@/server/session";

/** Verifies a signed sign-in message and starts a session. */
export async function POST(request: Request) {
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { message?: unknown; signature?: unknown; timezone?: unknown } | null;
  if (!body || typeof body.message !== "string" || typeof body.signature !== "string") {
    return NextResponse.json({ error: "A signed message is required." }, { status: 400 });
  }
  try {
    const { db } = await getRuntime();
    const session = await signInWithWallet(
      db,
      { message: body.message, signature: body.signature, expectedDomain: await expectedDomain(), timezone: typeof body.timezone === "string" ? body.timezone : undefined },
      new Date(),
    );
    (await cookies()).set(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[spare] sign-in failed:", e);
    return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
  }
}
