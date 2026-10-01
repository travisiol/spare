// Standalone background worker for PostgreSQL deployments:
//   SPARE_INLINE_WORKER=0 on the web process, then `npm run worker` here.
// It runs the weekly cutoff, approval expiry and the durable job queue once a second.
// Not for the embedded database, which only one process can open.
import { getDb } from "../src/db/client";
import { createAdapterResolver } from "../src/core/adapters";
import { tick } from "../src/core/worker";

if (!process.env.DATABASE_URL) {
  console.error("The standalone worker needs DATABASE_URL. With the embedded database the web process runs the worker itself.");
  process.exit(1);
}
const db = await getDb();
const resolve = createAdapterResolver(db);
console.log("SPARE worker running.");
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));
while (!stopping) {
  try {
    const r = await tick(db, resolve);
    if (r.jobs || r.closed || r.expired) console.log(new Date().toISOString(), r);
  } catch (e) {
    console.error("tick failed:", e);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
process.exit(0);
