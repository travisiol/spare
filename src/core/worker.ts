import type { Db } from "@/db/client";
import type { AdapterResolver } from "./adapters";
import { sweepBatches } from "./batches";
import { runDueJobs } from "./jobs";
import { pipelineHandlers } from "./pipeline";

/** One pass of background work: the weekly cutoff, approval expiry, then every due job. */
export async function tick(db: Db, resolve: AdapterResolver, clock: () => Date = () => new Date()): Promise<{ closed: number; expired: number; jobs: number }> {
  const swept = await sweepBatches(db, clock());
  const jobs = await runDueJobs(db, pipelineHandlers(db, resolve), clock);
  return { ...swept, jobs };
}
