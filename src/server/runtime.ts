import "server-only";
import { getDb, type Db } from "@/db/client";
import { createAdapterResolver, type AdapterResolver } from "@/core/adapters";
import { tick } from "@/core/worker";

export interface Runtime {
  db: Db;
  resolve: AdapterResolver;
}

const holder = globalThis as unknown as { __spareRuntime?: Promise<Runtime>; __spareWorker?: boolean };

/**
 * The in-process worker: it runs the weekly cutoff and the durable job queue
 * every second. Jobs live in Postgres, so a restart resumes where it stopped.
 * Set SPARE_INLINE_WORKER=0 to run `npm run worker` (or a cron hitting
 * /api/internal/tick) instead.
 */
function startWorker(runtime: Runtime) {
  if (holder.__spareWorker || process.env.SPARE_INLINE_WORKER === "0") return;
  holder.__spareWorker = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    const started = Date.now();
    try {
      const result = await tick(runtime.db, runtime.resolve);
      if (Date.now() - started > 5000) console.warn(`[spare] slow worker tick: ${Date.now() - started}ms`, result);
    } catch (e) {
      console.error("[spare] worker tick failed:", e);
    } finally {
      busy = false;
    }
  }, 1000);
  timer.unref?.();
}

export function getRuntime(): Promise<Runtime> {
  if (!holder.__spareRuntime) {
    holder.__spareRuntime = getDb().then((db) => {
      const runtime = { db, resolve: createAdapterResolver(db) };
      startWorker(runtime);
      return runtime;
    });
  }
  return holder.__spareRuntime;
}
