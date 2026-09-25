import { and, asc, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { db } from "./db/client";
import { devices, usageEvents } from "./db/schema";
import { addDays, dayKey, dayStartOf } from "./timezone";

/**
 * Read models for the usage explorer. Every figure here is scoped by one `UsageFilters`, so the
 * summary, the breakdowns, the chart and the request log always agree with each other.
 *
 * Token figures are quota tokens (input + cache writes + output) to match what limits count;
 * cache reads are reported separately because they cost money without counting against quota.
 */

export const RANGES = ["today", "7d", "30d", "90d", "all", "custom"] as const;
export type Range = (typeof RANGES)[number];

export const OUTCOMES = ["ok", "blocked", "error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Resolved window plus the dimensions to narrow by. `from`/`to` are epoch ms; null means open. */
export type UsageFilters = {
  from: number | null;
  to: number | null;
  deviceId?: string;
  model?: string;
  outcome?: Outcome;
  q?: string;
};

/** A `YYYY-MM-DD` URL parameter as a real calendar day, or null if it isn't one. */
function parseDayKey(key: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March rather than rejecting it.
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== key ? null : key;
}

/**
 * Turns URL parameters into a window. An explicit `from`/`to` wins over a preset, so a shared link
 * keeps showing the same dates rather than drifting with the calendar. `to` is inclusive: passing
 * the same day twice gives that whole day.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  now = Date.now(),
): { range: Range; from: number | null; to: number | null; fromKey: string; toKey: string } {
  const todayKey = dayKey(now);
  const customFrom = parseDayKey(params.from ?? "");
  const customTo = parseDayKey(params.to ?? "");

  if (customFrom !== null || customTo !== null) {
    // A half-filled range still works: the open end stays open.
    return {
      range: "custom",
      from: customFrom === null ? null : dayStartOf(customFrom),
      to: customTo === null ? null : dayStartOf(addDays(customTo, 1)),
      fromKey: customFrom ?? "",
      toKey: customTo ?? "",
    };
  }

  const range = (RANGES as readonly string[]).includes(params.range ?? "") ? (params.range as Range) : "7d";
  const days = range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 0;
  const fromKey = days === 0 ? "" : addDays(todayKey, -(days - 1));
  return {
    range: range === "custom" ? "7d" : range,
    from: fromKey ? dayStartOf(fromKey) : null,
    to: null,
    fromKey,
    toKey: todayKey,
  };
}

// Tokens that count against quota, matching quotaTokens() in lib/proxy/usage.ts.
const quotaTokens = sql`(${usageEvents.inputTokens} + ${usageEvents.cacheCreationTokens} + ${usageEvents.outputTokens})`;
// Everything that costs money. A cache-read-only request has no quota tokens but is not free, so
// "did this request have anything to price?" has to use this rather than quotaTokens.
const billedTokens = sql`(${quotaTokens} + ${usageEvents.cacheReadTokens})`;
const costUsd = sql`coalesce(${usageEvents.costUsd}, 0)`;

/** Escapes a user's text so `%` and `_` match literally instead of acting as wildcards. */
function likeTerm(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Predicates shared by every query below. `q` searches the request's own fields and the device
 * name, which is why callers that use it must join `devices`.
 */
function where(f: UsageFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    // The proxy only ever records /v1/messages, but being explicit keeps totals honest if that changes.
    eq(usageEvents.endpoint, "messages"),
    f.from === null ? undefined : gte(usageEvents.ts, new Date(f.from)),
    f.to === null ? undefined : lt(usageEvents.ts, new Date(f.to)),
    f.deviceId ? eq(usageEvents.deviceId, f.deviceId) : undefined,
    f.model ? eq(usageEvents.model, f.model) : undefined,
  ];
  // A gateway refusal carries an error_type; a bare 4xx/5xx came back from upstream.
  if (f.outcome === "blocked") parts.push(isNotNull(usageEvents.errorType));
  if (f.outcome === "error") parts.push(and(isNull(usageEvents.errorType), gte(usageEvents.statusCode, 400)));
  if (f.outcome === "ok") parts.push(and(isNull(usageEvents.errorType), lt(usageEvents.statusCode, 400)));
  if (f.q?.trim()) {
    const term = likeTerm(f.q);
    parts.push(
      or(
        sql`${usageEvents.model} like ${term} escape '\\'`,
        sql`${usageEvents.clientIp} like ${term} escape '\\'`,
        sql`${usageEvents.requestId} like ${term} escape '\\'`,
        sql`${devices.name} like ${term} escape '\\'`,
      ),
    );
  }
  return and(...parts);
}

/** True when the filters reach into the device table, which decides whether a join is needed. */
const needsDeviceJoin = (f: UsageFilters) => !!f.q?.trim();

export type UsageSummary = {
  requests: number;
  blocked: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  cost: number;
  /** Requests whose model has no published rate, so their spend is missing from `cost`. */
  unpriced: number;
  avgLatencyMs: number | null;
};

/**
 * Headline figures for a filtered window, in one pass. `requests` counts every matching request;
 * refused ones are reported separately as `blocked` and contribute no tokens either way.
 */
export function usageSummary(f: UsageFilters): UsageSummary {
  const base = db()
    .select({
      requests: sql<number>`count(*)`,
      blocked: sql<number>`coalesce(sum(case when ${usageEvents.errorType} is not null then 1 else 0 end), 0)`,
      input: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      output: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
      cacheWrite: sql<number>`coalesce(sum(${usageEvents.cacheCreationTokens}), 0)`,
      cacheRead: sql<number>`coalesce(sum(${usageEvents.cacheReadTokens}), 0)`,
      tokens: sql<number>`coalesce(sum(${quotaTokens}), 0)`,
      cost: sql<number>`coalesce(sum(${costUsd}), 0)`,
      unpriced: sql<number>`coalesce(sum(case when ${usageEvents.costUsd} is null and ${billedTokens} > 0 then 1 else 0 end), 0)`,
      // Refusals return in about a millisecond and would drag the mean toward zero, so they sit
      // outside it. NULL (nothing to average) is reported as null rather than a misleading 0 ms.
      avgLatencyMs: sql<number | null>`avg(case when ${usageEvents.errorType} is null then ${usageEvents.latencyMs} end)`,
    })
    .from(usageEvents);
  const q = needsDeviceJoin(f) ? base.innerJoin(devices, eq(devices.id, usageEvents.deviceId)) : base;
  return q.where(where(f)).get()!;
}

export type BreakdownSort = "cost" | "tokens" | "requests" | "name";
export type SortDir = "asc" | "desc";

export type BreakdownRow = {
  key: string;
  label: string;
  requests: number;
  blocked: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  cost: number;
  unpriced: number;
};

const breakdownColumns = {
  requests: sql<number>`count(*)`,
  blocked: sql<number>`coalesce(sum(case when ${usageEvents.errorType} is not null then 1 else 0 end), 0)`,
  input: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
  output: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
  cacheWrite: sql<number>`coalesce(sum(${usageEvents.cacheCreationTokens}), 0)`,
  cacheRead: sql<number>`coalesce(sum(${usageEvents.cacheReadTokens}), 0)`,
  tokens: sql<number>`coalesce(sum(${quotaTokens}), 0)`,
  cost: sql<number>`coalesce(sum(${costUsd}), 0)`,
  unpriced: sql<number>`coalesce(sum(case when ${usageEvents.costUsd} is null and ${billedTokens} > 0 then 1 else 0 end), 0)`,
};

function breakdownOrder(sort: BreakdownSort, dir: SortDir, nameExpr: SQL): SQL {
  const wrap = dir === "asc" ? asc : desc;
  if (sort === "name") return wrap(nameExpr);
  if (sort === "requests") return wrap(sql`count(*)`);
  if (sort === "tokens") return wrap(sql`sum(${quotaTokens})`);
  return wrap(sql`sum(${costUsd})`);
}

/** Spend and tokens per provider model id, for the filtered window. */
export function usageByModel(f: UsageFilters, sort: BreakdownSort = "cost", dir: SortDir = "desc"): BreakdownRow[] {
  const key = sql<string>`coalesce(${usageEvents.model}, 'unknown')`;
  const base = db().select({ key, label: key, ...breakdownColumns }).from(usageEvents);
  const q = needsDeviceJoin(f) ? base.innerJoin(devices, eq(devices.id, usageEvents.deviceId)) : base;
  return q.where(where(f)).groupBy(usageEvents.model).orderBy(breakdownOrder(sort, dir, key)).all();
}

/** Spend and tokens per device — the "who used this" view when a model filter is applied. */
export function usageByDevice(f: UsageFilters, sort: BreakdownSort = "cost", dir: SortDir = "desc"): BreakdownRow[] {
  const label = sql<string>`coalesce(${devices.name}, ${usageEvents.deviceId})`;
  return db()
    .select({ key: usageEvents.deviceId, label, ...breakdownColumns })
    .from(usageEvents)
    .innerJoin(devices, eq(devices.id, usageEvents.deviceId))
    .where(where(f))
    .groupBy(usageEvents.deviceId)
    .orderBy(breakdownOrder(sort, dir, label))
    .all();
}

export type DayPoint = { day: string; requests: number; tokens: number; cost: number };

// SQLite has no timezone database, so group into 15-minute UTC slots and fold those into local
// days below. Every real-world UTC offset is a whole number of 15-minute steps, DST included, so
// no slot straddles a local midnight.
const SLOT_MS = 15 * 60_000;
const slotExpr = sql<number>`${usageEvents.ts} / ${SLOT_MS}`;

/**
 * One point per local calendar day. Days with no traffic are filled in with zeroes so the chart
 * shows a real gap instead of joining across it.
 */
export function dailySeries(f: UsageFilters, now = Date.now()): DayPoint[] {
  const base = db()
    .select({
      slot: slotExpr,
      requests: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(${quotaTokens}), 0)`,
      cost: sql<number>`coalesce(sum(${costUsd}), 0)`,
    })
    .from(usageEvents);
  const q = needsDeviceJoin(f) ? base.innerJoin(devices, eq(devices.id, usageEvents.deviceId)) : base;
  const slots = q.where(where(f)).groupBy(slotExpr).orderBy(asc(slotExpr)).all();
  if (slots.length === 0 && f.from === null) return [];

  const found = new Map<string, DayPoint>();
  for (const s of slots) {
    const day = dayKey(s.slot * SLOT_MS);
    const p = found.get(day);
    if (p) {
      p.requests += s.requests;
      p.tokens += s.tokens;
      p.cost += s.cost;
    } else {
      found.set(day, { day, requests: s.requests, tokens: s.tokens, cost: s.cost });
    }
  }

  // An open-ended range still needs bounds to iterate; fall back to what the data covers.
  const todayKey = dayKey(now);
  const firstKey = f.from !== null ? dayKey(f.from) : slots.length ? dayKey(slots[0].slot * SLOT_MS) : todayKey;
  const toKey = f.to === null ? todayKey : dayKey(f.to - 1);
  const lastKey = toKey < todayKey ? toKey : todayKey;
  const out: DayPoint[] = [];
  for (let day = firstKey; day <= lastKey; day = addDays(day, 1)) {
    out.push(found.get(day) ?? { day, requests: 0, tokens: 0, cost: 0 });
  }
  return out;
}

export const REQUEST_SORTS = ["time", "cost", "tokens", "latency"] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];

export type RequestRow = {
  id: number;
  ts: Date;
  deviceId: string;
  deviceName: string | null;
  model: string | null;
  statusCode: number;
  errorType: string | null;
  aborted: boolean;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  costUsd: number | null;
  latencyMs: number;
  clientIp: string | null;
};

export const PAGE_SIZE = 50;

/**
 * A page of matching requests, newest first by default. Sorting happens in SQL so it orders the
 * whole result set rather than just the rows on screen.
 */
export function listRequests(
  f: UsageFilters,
  sort: RequestSort = "time",
  dir: SortDir = "desc",
  page = 1,
): { rows: RequestRow[]; total: number; page: number; pages: number } {
  const wrap = dir === "asc" ? asc : desc;
  const orderBy =
    sort === "cost"
      ? wrap(costUsd)
      : sort === "tokens"
        ? wrap(quotaTokens)
        : sort === "latency"
          ? wrap(usageEvents.latencyMs)
          : wrap(usageEvents.ts);

  const predicate = where(f);
  const total = db()
    .select({ n: sql<number>`count(*)` })
    .from(usageEvents)
    .innerJoin(devices, eq(devices.id, usageEvents.deviceId))
    .where(predicate)
    .get()!.n;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = db()
    .select({
      id: usageEvents.id,
      ts: usageEvents.ts,
      deviceId: usageEvents.deviceId,
      deviceName: devices.name,
      model: usageEvents.model,
      statusCode: usageEvents.statusCode,
      errorType: usageEvents.errorType,
      aborted: usageEvents.aborted,
      input: usageEvents.inputTokens,
      output: usageEvents.outputTokens,
      cacheWrite: usageEvents.cacheCreationTokens,
      cacheRead: usageEvents.cacheReadTokens,
      tokens: sql<number>`${quotaTokens}`,
      costUsd: usageEvents.costUsd,
      latencyMs: usageEvents.latencyMs,
      clientIp: usageEvents.clientIp,
    })
    .from(usageEvents)
    .innerJoin(devices, eq(devices.id, usageEvents.deviceId))
    .where(predicate)
    // id breaks ties so paging can't show the same row twice or skip one.
    .orderBy(orderBy, desc(usageEvents.id))
    .limit(PAGE_SIZE)
    .offset((current - 1) * PAGE_SIZE)
    .all();

  return { rows, total, page: current, pages };
}

/** Devices that appear in the filter dropdown: everything not soft-deleted. */
export function deviceOptions(): { id: string; name: string }[] {
  return db().select({ id: devices.id, name: devices.name }).from(devices).where(isNull(devices.deletedAt)).orderBy(devices.name).all();
}

/** Distinct model ids actually seen in usage, newest-used first. */
export function modelOptions(): string[] {
  return db()
    .select({ model: usageEvents.model })
    .from(usageEvents)
    .where(isNotNull(usageEvents.model))
    .groupBy(usageEvents.model)
    .orderBy(desc(sql`max(${usageEvents.ts})`))
    .all()
    .map((r) => r.model!)
    .filter(Boolean);
}
