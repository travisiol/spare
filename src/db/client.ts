import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const MIGRATIONS = join(process.cwd(), "drizzle");

/** In-memory Postgres (PGlite) with all migrations applied. Used by tests. */
export async function createMemoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const db = drizzle(new Pool({ connectionString: url }), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Db;
  }
  if (process.env.NODE_ENV === "production" && process.env.SPARE_ALLOW_EMBEDDED_DB !== "1") {
    throw new Error("DATABASE_URL is required in production (set SPARE_ALLOW_EMBEDDED_DB=1 to run the embedded database).");
  }
  // Local default: embedded Postgres (PGlite) persisted under ./data/pg.
  const dir = join(process.cwd(), "data", "pg");
  mkdirSync(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

const holder = globalThis as unknown as { __spareDb?: Promise<Db> };

/** One handle per process, kept across dev reloads. */
export function getDb(): Promise<Db> {
  if (!holder.__spareDb) holder.__spareDb = open();
  return holder.__spareDb;
}
