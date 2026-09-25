export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fails fast on an invalid TIMEZONE rather than on the first request.
    const { TIME_ZONE } = await import("./lib/timezone");
    console.log(`[gateway] quota days and weeks use ${TIME_ZONE} time`);

    const { db, migrateDb } = await import("./lib/db/client");
    // Apply pending migrations before the server accepts requests.
    migrateDb(db());

    // Price any request recorded before costs existed. Only touches rows with no cost yet, so
    // this is a no-op on every boot after the first. `bun run recompute-costs` re-prices
    // everything, which is what a rate change needs.
    const { priceRequests } = await import("./lib/costs");
    const run = priceRequests(db(), "missing");
    if (run.priced > 0) console.log(`[gateway] priced ${run.priced} request(s) recorded before cost tracking`);
    for (const [model, n] of run.unpriced) {
      console.warn(`[gateway] no price for ${model} (${n} request(s)) — add its rate to lib/pricing.ts`);
    }
  }
}
