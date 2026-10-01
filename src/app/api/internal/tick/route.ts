import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tick } from "@/core/worker";
import { getRuntime } from "@/server/runtime";

/** Runs one pass of background work. For platforms without a long-lived process: call it from a cron. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (secret.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { db, resolve } = await getRuntime();
  return NextResponse.json(await tick(db, resolve));
}
