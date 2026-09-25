// Re-prices every recorded request from the current table in lib/pricing.ts, then reports what the
// database holds per model. Run it after editing a rate, after adding a model the admin UI flagged
// as "no price", or any time costs read as $0 and you want to know why.
// Usage: bun run recompute-costs
import { costStatus, priceRequests } from "../lib/costs";
import { db, migrateDb } from "../lib/db/client";

migrateDb(db());

const run = priceRequests(db(), "all");
console.log(`Re-priced ${run.priced} of ${run.scanned} requests.\n`);

const rows = costStatus(db());
if (rows.length === 0) {
  console.log("No requests recorded yet.");
} else {
  const pad = Math.max(...rows.map((r) => r.model.length), 5);
  console.log(`${"model".padEnd(pad)}  requests  no price      tokens        cost`);
  for (const r of rows) {
    console.log(
      `${r.model.padEnd(pad)}  ${String(r.requests).padStart(8)}  ${String(r.missing).padStart(8)}  ` +
        `${String(r.tokens).padStart(10)}  ${`$${r.cost.toFixed(4)}`.padStart(10)}`,
    );
  }
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const missing = rows.reduce((s, r) => s + r.missing, 0);
  console.log(`\nTotal $${total.toFixed(4)} across ${rows.reduce((s, r) => s + r.requests, 0)} requests.`);
  if (missing > 0) {
    console.log(
      `${missing} request(s) still have no cost. Those models are missing from lib/pricing.ts — add their\n` +
        `rates (see the "no price" column above) and run this again.`,
    );
  }
}
