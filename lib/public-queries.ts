import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { devices, upstreamQuota, usageEvents } from "./db/schema";
import { windowsAt } from "./policy/windows";

/**
 * Data for the public home page, which has no login.
 *
 * This module deliberately selects the bare minimum: a device's name, how many tokens it used and
 * what that would have cost. No ids, IP addresses, notes or request logs — so a future change to
 * the page cannot accidentally publish something private. Anything more belongs behind /admin.
 */

export type LeaderRow = { name: string; tokens: number; cost: number };

export type Leaderboard = {
  /** Highest first. */
  top: LeaderRow[];
  /** The tail of the same ranking, still highest-first, so rank numbers read downward. */
  bottom: LeaderRow[];
  /** Largest value in the ranking, for scaling the bars. */
  max: number;
  /** Rank number of the first row in `bottom`. */
  bottomStartRank: number;
};

export type PublicSnapshot = {
  quota: {
    fiveHourRemaining: number | null;
    fiveHourReset: Date | null;
    weeklyRemaining: number | null;
    weeklyReset: Date | null;
    updatedAt: Date | null;
  };
  byTokens: Leaderboard;
  byCost: Leaderboard;
  deviceCount: number;
  weekStart: number;
};

const quotaTokens = sql`(${usageEvents.inputTokens} + ${usageEvents.cacheCreationTokens} + ${usageEvents.outputTokens})`;

/** Fraction of the window still available, or null when nothing has been recorded yet. */
function remaining(util: number | null): number | null {
  return util === null ? null : Math.max(0, Math.min(1, 1 - util));
}

/** Ranks devices by one metric, splitting off a bottom group that never repeats the top. */
function rank(rows: LeaderRow[], metric: (r: LeaderRow) => number): Leaderboard {
  const ranked = [...rows].sort((a, b) => metric(b) - metric(a) || a.name.localeCompare(b.name));
  const top = ranked.slice(0, 3);
  // With six or fewer devices a naive bottom-3 would list the same machines twice, which reads as
  // a bug. Take the tail only from those the top hasn't already claimed.
  const bottom = ranked.slice(top.length).slice(-3);
  return {
    top,
    bottom,
    max: ranked.length ? metric(ranked[0]) : 0,
    bottomStartRank: ranked.length - bottom.length + 1,
  };
}

export function publicSnapshot(now = Date.now()): PublicSnapshot {
  const w = windowsAt(now);
  const upstream = db().select().from(upstreamQuota).where(eq(upstreamQuota.id, 1)).get() ?? null;

  // Left join so a device that sent nothing this week still ranks, at zero.
  const rows = db()
    .select({
      name: devices.name,
      tokens: sql<number>`coalesce(sum(${quotaTokens}), 0)`,
      cost: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    })
    .from(devices)
    .leftJoin(
      usageEvents,
      and(
        eq(usageEvents.deviceId, devices.id),
        eq(usageEvents.endpoint, "messages"),
        gte(usageEvents.ts, new Date(w.weekStart)),
      ),
    )
    .where(and(isNull(devices.deletedAt), eq(devices.status, "enabled")))
    .groupBy(devices.id)
    .all();

  return {
    quota: {
      fiveHourRemaining: remaining(upstream?.fiveHourUtil ?? null),
      fiveHourReset: upstream?.fiveHourReset ?? null,
      weeklyRemaining: remaining(upstream?.weeklyUtil ?? null),
      weeklyReset: upstream?.weeklyReset ?? null,
      updatedAt: upstream?.updatedAt ?? null,
    },
    byTokens: rank(rows, (r) => r.tokens),
    byCost: rank(rows, (r) => r.cost),
    deviceCount: rows.length,
    weekStart: w.weekStart,
  };
}
