import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSession } from "@/core/auth";
import { getRuntime } from "@/server/runtime";
import { SESSION_COOKIE, assertSameOrigin, currentUser } from "@/server/session";

/** Who the session belongs to. The header uses it to show the connected state. */
export async function GET() {
  const user = await currentUser();
  return NextResponse.json(
    { user: user ? { env: user.env, walletAddress: user.walletAddress } : null },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Ends the session (used when the wallet switches account or disconnects). */
export async function DELETE() {
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const { db } = await getRuntime();
  const jar = await cookies();
  await revokeSession(db, jar.get(SESSION_COOKIE)?.value, new Date());
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
