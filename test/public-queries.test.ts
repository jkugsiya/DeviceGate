import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../lib/audit";
import { type DB, migrateDb, openDb } from "../lib/db/client";
import { upstreamQuota, usageEvents } from "../lib/db/schema";
import { createDevice, setDeviceStatus } from "../lib/devices";
import { publicSnapshot } from "../lib/public-queries";

const actor: Actor = { adminUserId: "admin-1", ip: "10.0.0.5", userAgent: "test" };
const globalForDb = globalThis as unknown as { __gatewayDb?: DB };
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  migrateDb(db);
  globalForDb.__gatewayDb = db;
});

/** Creates a device and gives it one request's worth of usage this week. */
function device(name: string, tokens: number, cost = 1) {
  const { id } = createDevice(db, actor, { name });
  if (tokens > 0) {
    db.insert(usageEvents)
      .values({
        requestId: crypto.randomUUID(),
        deviceId: id,
        ts: new Date(),
        endpoint: "messages",
        model: "claude-sonnet-5",
        inputTokens: tokens,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation1hTokens: 0,
        cacheReadTokens: 0,
        costUsd: cost,
        statusCode: 200,
        latencyMs: 10,
      })
      .run();
  }
  return id;
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("publicSnapshot leaderboard", () => {
  it("ranks highest usage first and keeps the bottom in the same direction", () => {
    for (const [name, tokens] of [["a", 100], ["b", 90], ["c", 80], ["d", 70], ["e", 60], ["f", 50], ["g", 0]] as const) {
      device(name, tokens);
    }
    const s = publicSnapshot();
    expect(names(s.byTokens.top)).toEqual(["a", "b", "c"]);
    // Descending like the top list, so printed ranks 5, 6, 7 read downward.
    expect(names(s.byTokens.bottom)).toEqual(["e", "f", "g"]);
    expect(s.byTokens.bottomStartRank).toBe(5);
    expect(s.deviceCount).toBe(7);
  });

  it("never lists the same device in both halves when there are few devices", () => {
    device("a", 30);
    device("b", 20);
    device("c", 10);
    const s = publicSnapshot();
    expect(names(s.byTokens.top)).toEqual(["a", "b", "c"]);
    expect(s.byTokens.bottom).toEqual([]);
    expect(new Set([...names(s.byTokens.top), ...names(s.byTokens.bottom)]).size).toBe(3);
  });

  it("splits four devices into three and one without overlap", () => {
    for (const [n, t] of [["a", 40], ["b", 30], ["c", 20], ["d", 10]] as const) device(n, t);
    const s = publicSnapshot();
    expect(names(s.byTokens.top)).toEqual(["a", "b", "c"]);
    expect(names(s.byTokens.bottom)).toEqual(["d"]);
    expect(s.byTokens.bottomStartRank).toBe(4);
  });

  it("includes a device that used nothing, at the bottom", () => {
    for (const [n, t] of [["a", 40], ["b", 30], ["c", 20], ["idle", 0]] as const) device(n, t);
    const s = publicSnapshot();
    expect(names(s.byTokens.bottom)).toEqual(["idle"]);
    expect(s.byTokens.bottom[0].tokens).toBe(0);
  });

  it("leaves out disabled devices", () => {
    device("a", 40);
    const off = device("off", 100);
    setDeviceStatus(db, actor, off, "disabled");
    const s = publicSnapshot();
    expect(names(s.byTokens.top)).toEqual(["a"]);
    expect(s.deviceCount).toBe(1);
  });

  it("ranks tokens and cost independently", () => {
    // "cheap" burns the most tokens on a cheap model; "pricey" uses fewer on an expensive one.
    device("cheap", 1_000_000, 2);
    device("pricey", 10_000, 90);
    device("middling", 500_000, 40);
    const s = publicSnapshot();
    expect(names(s.byTokens.top)).toEqual(["cheap", "middling", "pricey"]);
    expect(names(s.byCost.top)).toEqual(["pricey", "middling", "cheap"]);
    expect(s.byTokens.max).toBe(1_000_000);
    expect(s.byCost.max).toBe(90);
  });

  it("reports capacity as what is left, not what was used", () => {
    db.insert(upstreamQuota)
      .values({ id: 1, fiveHourUtil: 0.17, weeklyUtil: 0.54, raw: {}, updatedAt: new Date() })
      .run();
    const s = publicSnapshot();
    expect(s.quota.fiveHourRemaining).toBeCloseTo(0.83, 10);
    expect(s.quota.weeklyRemaining).toBeCloseTo(0.46, 10);
  });

  it("reports null capacity before any request has been seen", () => {
    expect(publicSnapshot().quota.fiveHourRemaining).toBeNull();
  });

  it("clamps a utilisation above 100% to zero remaining rather than a negative", () => {
    db.insert(upstreamQuota).values({ id: 1, fiveHourUtil: 1.4, raw: {}, updatedAt: new Date() }).run();
    expect(publicSnapshot().quota.fiveHourRemaining).toBe(0);
  });
});
