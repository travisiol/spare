// Seeds one deterministic demo account with history, using the same code paths as the app:
// a completed week, a week whose order failed (funds held), and an open week.
// It is for the admin screens; reviewers get their own fresh demo account from the site.
// With the embedded database, stop the dev server first: it can only be opened by one process.
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { connections, users, weeklyBatches } from "../src/db/schema";
import { acknowledgeApproval, activateTracking, attestEligibility, chooseInstrument, connect, setWeeklyCap } from "../src/core/accounts";
import { createAdapterResolver } from "../src/core/adapters";
import { startDemoSession } from "../src/core/auth";
import { approveBatch } from "../src/core/batches";
import { closeWeekNow, deliverFirstWeek, deliverMorePurchases, setDemoFlags } from "../src/core/demo";
import { tick } from "../src/core/worker";

const db = await getDb();
const resolve = createAdapterResolver(db);
let now = new Date();
const step = (ms = 2000) => (now = new Date(now.getTime() + ms));

const { userId } = await startDemoSession(db, "UTC", now);
const [user] = await db.select().from(users).where(eq(users.id, userId));
await attestEligibility(db, user, now);
await chooseInstrument(db, resolve, user, "AAPL", now);
await connect(db, resolve, user, "transaction_source", now);
await connect(db, resolve, user, "funding", now);
await setWeeklyCap(db, user, 1000, now);
await acknowledgeApproval(db, user, now);
await activateTracking(db, user, now);

async function approveLatest() {
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.userId, userId), eq(weeklyBatches.status, "ready_for_approval")));
  const [funding] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.kind, "funding")));
  await approveBatch(db, resolve, { userId, batchId: batch.id, snapshotHash: batch.snapshotHash!, fundingConnectionId: funding.id }, step());
  for (let i = 0; i < 20; i++) {
    const t = step();
    if ((await tick(db, resolve, () => t)).jobs === 0) break;
  }
}

await deliverFirstWeek(db, user, step());
await closeWeekNow(db, user, step());
await approveLatest(); // completed

await deliverMorePurchases(db, user, step());
await setDemoFlags(db, user, { nextOrder: "fail" });
await closeWeekNow(db, user, step());
await approveLatest(); // order failed, funds held

await deliverMorePurchases(db, user, step()); // open week

console.log(`Seeded demo account ${userId}: one completed week, one failed order, one open week.`);
process.exit(0);
