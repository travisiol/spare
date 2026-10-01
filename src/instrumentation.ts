/** Opens the database and starts the background worker when the server boots. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { getRuntime } = await import("./server/runtime");
    await getRuntime();
  }
}
