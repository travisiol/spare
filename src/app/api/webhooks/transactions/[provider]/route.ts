import { NextResponse } from "next/server";
import { ingestEvent } from "@/core/ingest";
import { parseWebhookEvent, verifyWebhookSignature } from "@/core/webhook";
import { getRuntime } from "@/server/runtime";

/**
 * Transaction events from a live data provider. Only the "webhook" provider is
 * accepted here: demo purchases never come in through a public endpoint.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const secret = process.env.SPARE_TXN_WEBHOOK_SECRET ?? "";
  if (provider !== "webhook" || !secret) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  const raw = await request.text();
  const now = new Date();
  if (!verifyWebhookSignature(secret, raw, request.headers.get("x-spare-signature"), now)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const event = parseWebhookEvent(provider, raw);
  if (!event) return NextResponse.json({ error: "Malformed event." }, { status: 400 });

  const { db } = await getRuntime();
  // A duplicate or stale event is still a 200: the provider must stop retrying it.
  return NextResponse.json(await ingestEvent(db, event, now));
}
