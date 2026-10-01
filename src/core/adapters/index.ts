import type { Db } from "@/db/client";
import type { Env } from "@/db/schema";
import { demoAdapters } from "./demo";
import { liveAdapters } from "./live";
import type { AdapterSet } from "./types";

export type AdapterResolver = (env: Env) => AdapterSet;

/**
 * The only place an env is mapped to providers. A live account can never be
 * handed a demo adapter, whatever is or is not configured.
 */
export function createAdapterResolver(db: Db): AdapterResolver {
  const demo = demoAdapters(db);
  const live = liveAdapters();
  return (env) => (env === "demo" ? demo : live);
}

export type { AdapterSet } from "./types";
