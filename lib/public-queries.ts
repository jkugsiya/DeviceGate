import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { devices, upstreamQuota, usageEvents } from "./db/schema";
import { windowsAt } from "./policy/windows";
import { addDays, dayKey, dayStartAt, dayStartOf, HOUR_MS, hourStartAt } from "./timezone";
import { dailySeries, hourlySeries } from "./usage-queries";

/**
 * Data for the public home page, which has no login.
 *
 * This module deliberately selects the bare minimum: a device's name, how many tokens it used and
 * what that would have cost. No ids, IP addresses, notes or request logs — so a future change to
 * the page cannot accidentally publish something private. Anything more belongs behind /admin.
 * The gateway-wide totals and trend below are aggregates only, with no per-device split at all.
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

export type Totals = { tokens: number; cost: number };

export type UsageTotals = {
  allTime: Totals;
  /** Since local midnight in the gateway's timezone. */
  today: Totals;
  /** First recorded request, or null before any traffic. */
  since: Date | null;
};

/**
 * Gateway-wide tokens and API-equivalent cost, all time and today, in one pass. Counts every
 * device, including ones since disabled or deleted: the traffic still happened.
 */
export function usageTotals(now = Date.now()): UsageTotals {
  const todayStart = dayStartAt(now);
  const isToday = gte(usageEvents.ts, new Date(todayStart));
  const row = db()
    .select({
      tokens: sql<number>`coalesce(sum(${quotaTokens}), 0)`,
      cost: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
      todayTokens: sql<number>`coalesce(sum(case when ${isToday} then ${quotaTokens} end), 0)`,
      todayCost: sql<number>`coalesce(sum(case when ${isToday} then ${usageEvents.costUsd} end), 0)`,
      since: sql<number | null>`min(${usageEvents.ts})`,
    })
    .from(usageEvents)
    .where(eq(usageEvents.endpoint, "messages"))
    .get()!;

  return {
    allTime: { tokens: row.tokens, cost: row.cost },
    today: { tokens: row.todayTokens, cost: row.todayCost },
    since: row.since === null ? null : new Date(row.since),
  };
}

export const TREND_RANGES = ["1d", "7d", "30d", "90d", "all"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export type TrendPoint = { start: number; tokens: number; cost: number };

export type Trend = {
  /** "1d" is hourly so the day has a shape; everything longer is one point per local day. */
  bucket: "hour" | "day";
  points: TrendPoint[];
  total: Totals;
};

/**
 * Gateway-wide usage over time. "1d" is the last 24 hours, current hour included; "7d" and up are
 * whole local days ending today, matching the admin's presets.
 */
export function usageTrend(range: TrendRange, now = Date.now()): Trend {
  let bucket: Trend["bucket"];
  let points: TrendPoint[];
  if (range === "1d") {
    bucket = "hour";
    points = hourlySeries({ from: hourStartAt(now) - 23 * HOUR_MS, to: null }, now).map(
      ({ start, tokens, cost }) => ({ start, tokens, cost }),
    );
  } else {
    bucket = "day";
    const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 0;
    const from = days === 0 ? null : dayStartOf(addDays(dayKey(now), -(days - 1)));
    points = dailySeries({ from, to: null }, now).map(({ day, tokens, cost }) => ({
      start: dayStartOf(day),
      tokens,
      cost,
    }));
  }

  const total = { tokens: 0, cost: 0 };
  for (const p of points) {
    total.tokens += p.tokens;
    total.cost += p.cost;
  }
  return { bucket, points, total };
}
