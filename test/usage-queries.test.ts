import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../lib/audit";
import { type DB, migrateDb, openDb } from "../lib/db/client";
import { usageEvents } from "../lib/db/schema";
import { createDevice } from "../lib/devices";
import {
  dailySeries,
  listRequests,
  resolveRange,
  usageByDevice,
  usageByModel,
  usageSummary,
} from "../lib/usage-queries";
import { dayKey, dayStartAt, dayStartOf } from "../lib/timezone";

const actor: Actor = { adminUserId: "admin-1", ip: "10.0.0.5", userAgent: "test" };
const DAY = 86_400_000;
// 2026-09-22T12:00:00Z is 17:30 IST, comfortably inside the IST day that starts 18:30Z the day before.
const NOW = Date.parse("2026-09-22T12:00:00Z");

// The query module reads the shared singleton, so swap in a fresh in-memory database per test.
const globalForDb = globalThis as unknown as { __gatewayDb?: DB };
let db: DB;
let laptop: string;
let desktop: string;

beforeEach(() => {
  db = openDb(":memory:");
  migrateDb(db);
  globalForDb.__gatewayDb = db;
  laptop = createDevice(db, actor, { name: "Laptop" }).id;
  desktop = createDevice(db, actor, { name: "Office desktop" }).id;
});

type RecordOpts = {
  device?: string;
  model?: string | null;
  at?: number;
  input?: number;
  output?: number;
  cacheWrite?: number;
  cacheRead?: number;
  cost?: number | null;
  status?: number;
  errorType?: string | null;
  latency?: number;
  ip?: string;
  requestId?: string;
  endpoint?: string;
};

function record(o: RecordOpts = {}) {
  db.insert(usageEvents)
    .values({
      requestId: o.requestId ?? crypto.randomUUID(),
      deviceId: o.device ?? laptop,
      ts: new Date(o.at ?? NOW),
      endpoint: o.endpoint ?? "messages",
      model: o.model === undefined ? "claude-opus-5" : o.model,
      inputTokens: o.input ?? 0,
      outputTokens: o.output ?? 0,
      cacheCreationTokens: o.cacheWrite ?? 0,
      cacheCreation1hTokens: 0,
      cacheReadTokens: o.cacheRead ?? 0,
      costUsd: o.cost === undefined ? 1 : o.cost,
      statusCode: o.status ?? 200,
      errorType: o.errorType ?? null,
      aborted: false,
      latencyMs: o.latency ?? 100,
      clientIp: o.ip ?? "192.168.1.5",
    })
    .run();
}

const all = { from: null, to: null };

describe("resolveRange", () => {
  it("aligns presets to IST midnight and counts today as one day", () => {
    const r = resolveRange({ range: "today" }, NOW);
    expect(r.from).toBe(dayStartAt(NOW));
    expect(r.fromKey).toBe("2026-09-22");
  });

  it("includes both endpoints of an explicit date range", () => {
    const r = resolveRange({ from: "2026-09-01", to: "2026-09-05" }, NOW);
    expect(r.range).toBe("custom");
    expect(dayKey(r.from!)).toBe("2026-09-01");
    // `to` is exclusive internally, so it must land at the start of the day after the 5th.
    expect(dayKey(r.to! - 1)).toBe("2026-09-05");
  });

  it("lets an explicit range beat a preset, so a shared link keeps its dates", () => {
    const r = resolveRange({ range: "7d", from: "2026-09-01", to: "2026-09-02" }, NOW);
    expect(r.range).toBe("custom");
    expect(dayKey(r.from!)).toBe("2026-09-01");
  });

  it("accepts a half-open range", () => {
    const r = resolveRange({ from: "2026-09-01" }, NOW);
    expect(r.to).toBeNull();
    expect(dayKey(r.from!)).toBe("2026-09-01");
  });

  it("ignores dates that aren't real calendar days", () => {
    expect(resolveRange({ from: "nonsense" }, NOW).range).toBe("7d");
    expect(resolveRange({ from: "2026-02-30" }, NOW).range).toBe("7d");
  });

  it("falls back to 7 days for a missing or bogus preset", () => {
    expect(resolveRange({}, NOW).range).toBe("7d");
    expect(resolveRange({ range: "wat" }, NOW).range).toBe("7d");
    expect(resolveRange({ range: "all" }, NOW).from).toBeNull();
  });
});

describe("usageSummary", () => {
  it("totals tokens and cost, and counts refusals separately", () => {
    record({ input: 100, output: 50, cacheWrite: 10, cacheRead: 999, cost: 2 });
    record({ errorType: "MODEL_NOT_ALLOWED", status: 403, cost: 0 });
    const s = usageSummary(all);
    expect(s.requests).toBe(2);
    expect(s.blocked).toBe(1);
    // Quota tokens are input + cache writes + output; cache reads are reported apart from them.
    expect(s.tokens).toBe(160);
    expect(s.cacheRead).toBe(999);
    expect(s.cost).toBe(2);
  });

  it("counts requests whose model has no rate, so missing spend is visible", () => {
    record({ model: "gpt-5", input: 500, cost: null });
    record({ input: 10, cost: 1 });
    expect(usageSummary(all).unpriced).toBe(1);
  });

  it("ignores endpoints other than messages", () => {
    record({ endpoint: "count_tokens", cost: 5 });
    expect(usageSummary(all).requests).toBe(0);
  });
});

describe("outcome filter", () => {
  beforeEach(() => {
    record({ status: 200 });
    record({ status: 403, errorType: "MODEL_NOT_ALLOWED" });
    record({ status: 429, errorType: null }); // upstream rate limit, not a gateway refusal
  });

  it("separates gateway refusals from upstream errors", () => {
    expect(usageSummary({ ...all, outcome: "ok" }).requests).toBe(1);
    expect(usageSummary({ ...all, outcome: "blocked" }).requests).toBe(1);
    expect(usageSummary({ ...all, outcome: "error" }).requests).toBe(1);
  });
});

describe("search", () => {
  it("matches model, device name, IP and request id", () => {
    record({ model: "claude-opus-5", ip: "10.1.1.1", requestId: "req-aaa" });
    record({ device: desktop, model: "claude-haiku-4-5", ip: "10.2.2.2", requestId: "req-bbb" });
    expect(usageSummary({ ...all, q: "opus" }).requests).toBe(1);
    expect(usageSummary({ ...all, q: "desktop" }).requests).toBe(1);
    expect(usageSummary({ ...all, q: "10.2" }).requests).toBe(1);
    expect(usageSummary({ ...all, q: "req-aaa" }).requests).toBe(1);
  });

  it("treats % and _ as literal characters rather than wildcards", () => {
    record({ model: "claude-opus-5" });
    record({ model: "100%-custom" });
    // A bare "%" would match everything if it leaked into the LIKE pattern.
    expect(usageSummary({ ...all, q: "%" }).requests).toBe(1);
    expect(usageSummary({ ...all, q: "_" }).requests).toBe(0);
  });
});

describe("breakdowns", () => {
  it("groups spend by model, biggest first", () => {
    record({ model: "claude-opus-5", cost: 5, input: 100 });
    record({ model: "claude-haiku-4-5", cost: 1, input: 10 });
    const rows = usageByModel(all);
    expect(rows.map((r) => r.key)).toEqual(["claude-opus-5", "claude-haiku-4-5"]);
    expect(rows[0].cost).toBe(5);
  });

  it("answers who used a model and how much", () => {
    record({ device: laptop, model: "claude-opus-5", cost: 4 });
    record({ device: desktop, model: "claude-opus-5", cost: 6 });
    record({ device: desktop, model: "claude-haiku-4-5", cost: 9 });
    const rows = usageByDevice({ ...all, model: "claude-opus-5" });
    expect(rows.map((r) => [r.label, r.cost])).toEqual([
      ["Office desktop", 6],
      ["Laptop", 4],
    ]);
  });

  it("sorts by the requested column and direction", () => {
    record({ model: "a", cost: 1, input: 900 });
    record({ model: "b", cost: 5, input: 10 });
    expect(usageByModel(all, "tokens", "desc").map((r) => r.key)).toEqual(["a", "b"]);
    expect(usageByModel(all, "cost", "asc").map((r) => r.key)).toEqual(["a", "b"]);
    expect(usageByModel(all, "name", "asc").map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("dailySeries", () => {
  it("emits a zero point for days with no traffic instead of skipping them", () => {
    record({ at: NOW - 4 * DAY, cost: 1 });
    record({ at: NOW, cost: 3 });
    const series = dailySeries({ from: dayStartAt(NOW - 4 * DAY), to: null }, NOW);
    expect(series).toHaveLength(5);
    expect(series.map((p) => p.cost)).toEqual([1, 0, 0, 0, 3]);
    expect(series[0].day).toBe("2026-09-18");
    expect(series.at(-1)!.day).toBe("2026-09-22");
  });

  it("splits exactly at IST midnight (18:30 UTC), to the millisecond", () => {
    record({ at: Date.parse("2026-09-21T18:29:59.999Z"), cost: 1 }); // still the 21st in IST
    record({ at: Date.parse("2026-09-21T18:30:00.000Z"), cost: 7 }); // first instant of the 22nd
    const series = dailySeries({ from: dayStartOf("2026-09-21"), to: null }, NOW);
    expect(series).toEqual([
      { day: "2026-09-21", requests: 1, tokens: 0, cost: 1 },
      { day: "2026-09-22", requests: 1, tokens: 0, cost: 7 },
    ]);
  });

  it("buckets by IST day, so late-evening UTC traffic lands on the next IST day", () => {
    // 19:00 UTC on the 21st is 00:30 IST on the 22nd.
    record({ at: Date.parse("2026-09-21T19:00:00Z"), cost: 2 });
    const series = dailySeries({ from: dayStartAt(NOW), to: null }, NOW);
    expect(series).toEqual([{ day: "2026-09-22", requests: 1, tokens: 0, cost: 2 }]);
  });
});

describe("listRequests", () => {
  beforeEach(() => {
    for (let i = 0; i < 120; i++) record({ at: NOW - i * 60_000, cost: i, latency: 1000 - i });
  });

  it("pages without dropping or repeating rows", () => {
    const p1 = listRequests(all, "time", "desc", 1);
    const p3 = listRequests(all, "time", "desc", 3);
    expect(p1.total).toBe(120);
    expect(p1.pages).toBe(3);
    expect(p1.rows).toHaveLength(50);
    expect(p3.rows).toHaveLength(20);
    const ids = new Set([...p1.rows, ...listRequests(all, "time", "desc", 2).rows, ...p3.rows].map((r) => r.id));
    expect(ids.size).toBe(120);
  });

  it("sorts the whole result set in SQL, not just the current page", () => {
    // The most expensive request must appear on page 1 even though it is the oldest.
    const top = listRequests(all, "cost", "desc", 1).rows[0];
    expect(top.costUsd).toBe(119);
    const cheapest = listRequests(all, "cost", "asc", 1).rows[0];
    expect(cheapest.costUsd).toBe(0);
  });

  it("clamps a page beyond the end rather than returning nothing", () => {
    expect(listRequests(all, "time", "desc", 99).page).toBe(3);
  });

  it("carries the device name for display", () => {
    expect(listRequests(all).rows[0].deviceName).toBe("Laptop");
  });
});
