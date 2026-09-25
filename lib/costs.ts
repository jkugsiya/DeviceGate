import { desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "./db/client";
import { usageEvents } from "./db/schema";
import { costOf } from "./pricing";

export type PricingRun = {
  scanned: number;
  priced: number;
  /** Requests whose model has no entry in lib/pricing.ts, by model id. */
  unpriced: Map<string, number>;
};

/**
 * Prices recorded requests from the current table in lib/pricing.ts.
 *
 * `scope: "missing"` only touches rows that have no cost yet — cheap enough to run on every boot,
 * and a no-op once the backlog is cleared. `scope: "all"` re-prices everything, which is what you
 * want after changing a rate.
 *
 * A request that carried no tokens (refused, or a 429 from upstream) prices at zero rather than
 * staying NULL, so NULL keeps its single meaning: the model has no published rate.
 */
export function priceRequests(db: DB, scope: "missing" | "all"): PricingRun {
  const rows = db
    .select({
      id: usageEvents.id,
      model: usageEvents.model,
      input: usageEvents.inputTokens,
      output: usageEvents.outputTokens,
      cacheCreation: usageEvents.cacheCreationTokens,
      cacheCreation1h: usageEvents.cacheCreation1hTokens,
      cacheRead: usageEvents.cacheReadTokens,
      costUsd: usageEvents.costUsd,
    })
    .from(usageEvents)
    // Rows on an unpriced model stay NULL and so get re-examined on the next boot, which is what
    // picks them up once their rate is added.
    .where(scope === "missing" ? isNull(usageEvents.costUsd) : undefined)
    .all();

  const run: PricingRun = { scanned: rows.length, priced: 0, unpriced: new Map() };
  if (rows.length === 0) return run;

  db.transaction((tx) => {
    for (const r of rows) {
      const cost = costOf(r.model, r);
      if (cost === null) {
        if (r.input || r.output || r.cacheCreation || r.cacheRead) {
          const key = r.model ?? "(none)";
          run.unpriced.set(key, (run.unpriced.get(key) ?? 0) + 1);
        }
        continue;
      }
      if (cost === r.costUsd) continue;
      tx.update(usageEvents).set({ costUsd: cost }).where(eq(usageEvents.id, r.id)).run();
      run.priced++;
    }
  });
  return run;
}

export type ModelCostStatus = {
  model: string;
  requests: number;
  /**
   * Requests that carried tokens but have no cost, so real spend is missing from the totals.
   * A refused request has no tokens and no cost either way, which is not a gap.
   */
  missing: number;
  tokens: number;
  cost: number;
};

const tokenSum = sql`(${usageEvents.inputTokens} + ${usageEvents.outputTokens} + ${usageEvents.cacheCreationTokens} + ${usageEvents.cacheReadTokens})`;

/** What the database actually holds, per model. Used to explain a total rather than just show it. */
export function costStatus(db: DB): ModelCostStatus[] {
  return db
    .select({
      model: sql<string>`coalesce(${usageEvents.model}, '(none)')`,
      requests: sql<number>`count(*)`,
      missing: sql<number>`sum(case when ${usageEvents.costUsd} is null and ${tokenSum} > 0 then 1 else 0 end)`,
      tokens: sql<number>`coalesce(sum(${tokenSum}), 0)`,
      cost: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    })
    .from(usageEvents)
    .groupBy(usageEvents.model)
    .orderBy(desc(sql`count(*)`))
    .all();
}
