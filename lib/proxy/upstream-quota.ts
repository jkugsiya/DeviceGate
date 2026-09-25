import type { DbOrTx } from "../db/client";
import { upstreamQuota } from "../db/schema";

const PREFIX = "anthropic-ratelimit-unified-";

const num = (v: string | undefined) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
// Reset headers are epoch seconds.
const epoch = (v: string | undefined) => {
  const n = num(v);
  return n === null ? null : new Date(n * 1000);
};

/** Stores the subscription's 5h/7d utilization from response headers; no-op when absent. */
export function recordUpstreamQuota(db: DbOrTx, headers: Headers) {
  const raw: Record<string, string> = {};
  headers.forEach((v, k) => {
    if (k.startsWith(PREFIX)) raw[k.slice(PREFIX.length)] = v;
  });
  if (Object.keys(raw).length === 0) return;

  const row = {
    fiveHourUtil: num(raw["5h-utilization"]),
    fiveHourReset: epoch(raw["5h-reset"]),
    weeklyUtil: num(raw["7d-utilization"]),
    weeklyReset: epoch(raw["7d-reset"]),
    status: raw["status"] ?? null,
    raw,
    updatedAt: new Date(),
  };
  db.insert(upstreamQuota)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: upstreamQuota.id, set: row })
    .run();
}
