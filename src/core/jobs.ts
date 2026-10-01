/**
 * Durable job queue in Postgres. A job survives restarts, is claimed with a
 * lease, retried with backoff and parked as "dead" for an operator after
 * repeated failures. Handlers are written to be safe to run more than once.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/db/client";
import { jobs } from "@/db/schema";
import { audit, SYSTEM } from "./audit";

export type JobOutcome = "done" | { againInMs: number };
export type JobHandler = (payload: Record<string, string>, now: Date) => Promise<JobOutcome>;

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 6;

export async function enqueue(db: DbOrTx, kind: string, key: string, payload: Record<string, string>, runAt: Date): Promise<void> {
  await db.insert(jobs).values({ kind, key, payload, runAt }).onConflictDoNothing();
}

async function claim(db: Db, now: Date) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, "queued"), lte(jobs.runAt, now)),
          // A crashed worker's lease has run out: the job is claimable again.
          and(eq(jobs.status, "running"), or(isNull(jobs.lockedUntil), lte(jobs.lockedUntil, now))),
        ),
      )
      .orderBy(jobs.runAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    await tx
      .update(jobs)
      .set({ status: "running", lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${jobs.attempts} + 1`, updatedAt: now })
      .where(eq(jobs.id, job.id));
    return job;
  });
}

/** Runs every due job once. Returns how many ran. `clock` lets tests control time. */
export async function runDueJobs(db: Db, handlers: Record<string, JobHandler>, clock: () => Date = () => new Date(), limit = 25): Promise<number> {
  let ran = 0;
  while (ran < limit) {
    const now = clock();
    const job = await claim(db, now);
    if (!job) break;
    ran++;
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
      const outcome = await handler(job.payload, now);
      if (outcome === "done") {
        await db.update(jobs).set({ status: "done", lockedUntil: null, lastError: null, updatedAt: clock() }).where(eq(jobs.id, job.id));
      } else {
        // Waiting on a provider is not a failure: it does not use up attempts.
        await db
          .update(jobs)
          .set({ status: "queued", lockedUntil: null, attempts: job.attempts, runAt: new Date(now.getTime() + outcome.againInMs), updatedAt: clock() })
          .where(eq(jobs.id, job.id));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const attempts = job.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await db
        .update(jobs)
        .set({
          status: dead ? "dead" : "queued",
          lockedUntil: null,
          lastError: message,
          runAt: new Date(now.getTime() + Math.min(60_000, 1000 * 2 ** attempts)),
          updatedAt: clock(),
        })
        .where(eq(jobs.id, job.id));
      if (dead) await audit(db, "system", SYSTEM, "job.dead", { type: "job", id: job.id }, { kind: job.kind, key: job.key, error: message });
    }
  }
  return ran;
}

/** Puts a dead job back in the queue. Safe to call twice: only a dead job changes. */
export async function requeueDeadJob(db: Db, jobId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAt: now, lastError: null, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "dead")))
    .returning({ id: jobs.id });
  return rows.length > 0;
}
