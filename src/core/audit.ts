import type { DbOrTx } from "@/db/client";
import { auditEvents, type Env } from "@/db/schema";

export interface Actor {
  type: "user" | "admin" | "system" | "provider";
  id?: string | null;
}

export const SYSTEM: Actor = { type: "system" };

export async function audit(
  db: DbOrTx,
  env: Env | "system",
  actor: Actor,
  action: string,
  subject?: { type: string; id: string },
  data?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditEvents).values({
    env,
    actorType: actor.type,
    actorId: actor.id ?? null,
    action,
    subjectType: subject?.type ?? null,
    subjectId: subject?.id ?? null,
    data: data ?? null,
  });
}
