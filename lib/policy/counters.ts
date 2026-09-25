import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { usageEvents } from "../db/schema";
import { windowsAt } from "./windows";

// In-memory usage per device. usage_events stays the source of truth: a device's day/week
// totals are loaded from it on first use and whenever the day rolls over.
export type DeviceCounters = {
  dayStart: number;
  dayRequests: number;
  dayTokens: number;
  weekRequests: number;
  weekTokens: number;
  // Admission timestamps within the last minute, oldest first.
  recent: number[];
  inflight: number;
};

const MINUTE_MS = 60_000;
const globalForCounters = globalThis as unknown as { __gatewayCounters?: Map<string, DeviceCounters> };
const counters = (globalForCounters.__gatewayCounters ??= new Map());

// Must match quotaTokens() in lib/proxy/usage.ts.
const tokenSum = sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.cacheCreationTokens} + ${usageEvents.outputTokens}), 0)`;

function loadTotals(db: DbOrTx, deviceId: string, since: number) {
  return db
    .select({ requests: sql<number>`count(*)`, tokens: tokenSum })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.deviceId, deviceId),
        eq(usageEvents.endpoint, "messages"),
        // Requests the gateway refused never reached upstream and don't count.
        isNull(usageEvents.errorType),
        gte(usageEvents.ts, new Date(since)),
      ),
    )
    .get()!;
}

/** Current counters for a device, reloading day/week totals from the DB on a new day. */
export function countersFor(db: DbOrTx, deviceId: string, now: number): DeviceCounters {
  const w = windowsAt(now);
  let c = counters.get(deviceId);
  if (!c || c.dayStart !== w.dayStart) {
    const day = loadTotals(db, deviceId, w.dayStart);
    const week = loadTotals(db, deviceId, w.weekStart);
    // In-flight and per-minute state carry over; only the quota windows reset.
    c = {
      dayStart: w.dayStart,
      dayRequests: day.requests,
      dayTokens: day.tokens,
      weekRequests: week.requests,
      weekTokens: week.tokens,
      recent: c?.recent ?? [],
      inflight: c?.inflight ?? 0,
    };
    counters.set(deviceId, c);
  }
  while (c.recent.length && c.recent[0] <= now - MINUTE_MS) c.recent.shift();
  return c;
}

export type Release = (tokens: number, at: number, opts?: { refund?: boolean }) => void;

/**
 * Books an admitted request. The returned release must run when the request ends; later calls
 * are ignored. `refund` un-counts a request that never reached upstream.
 */
export function admit(c: DeviceCounters, now: number): Release {
  c.dayRequests++;
  c.weekRequests++;
  c.recent.push(now);
  c.inflight++;
  let released = false;
  return (tokens, at, opts) => {
    if (released) return;
    released = true;
    c.inflight--;
    // After a rollover the next countersFor() reloads from the DB, which already has this row.
    if (windowsAt(at).dayStart !== c.dayStart) return;
    c.dayTokens += tokens;
    c.weekTokens += tokens;
    if (opts?.refund) {
      c.dayRequests--;
      c.weekRequests--;
    }
  };
}

/** Test helper. */
export function resetCounters() {
  counters.clear();
}
