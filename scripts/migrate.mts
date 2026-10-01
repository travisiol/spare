// Applies database migrations (drizzle/) to DATABASE_URL, or to the embedded database when it is unset.
// With the embedded database, stop the dev server first: it can only be opened by one process.
import { getDb } from "../src/db/client";

await getDb();
console.log(process.env.DATABASE_URL ? "Migrations applied to DATABASE_URL." : "Migrations applied to the embedded database in ./data/pg.");
process.exit(0);
