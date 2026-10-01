import { NextResponse } from "next/server";
import { createNonce } from "@/core/auth";
import { getRuntime } from "@/server/runtime";
import { assertSameOrigin } from "@/server/session";

/** Issues a one-time sign-in nonce. It expires in ten minutes and can be used once. */
export async function POST() {
  if (!(await assertSameOrigin())) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const { db } = await getRuntime();
  return NextResponse.json({ nonce: await createNonce(db, new Date()) }, { headers: { "cache-control": "no-store" } });
}
