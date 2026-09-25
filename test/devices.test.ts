import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../lib/audit";
import { authenticateDevice } from "../lib/auth/device-token";
import { type DB, migrateDb, openDb } from "../lib/db/client";
import { auditEvents, usageEvents } from "../lib/db/schema";
import {
  createDevice,
  NotFoundError,
  rotateDeviceToken,
  setDeviceStatus,
  updateDevicePolicy,
} from "../lib/devices";
import { admit, countersFor, resetCounters } from "../lib/policy/counters";
import { loadDevicePolicy } from "../lib/policy/load";

const actor: Actor = { adminUserId: "admin-1", ip: "10.0.0.5", userAgent: "test" };
const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  migrateDb(db);
  resetCounters();
});

describe("device auth", () => {
  it("accepts a live token and rejects unknown, rotated and disabled ones", () => {
    const { id } = createDevice(db, actor, { name: "desktop" });
    const token = rotateDeviceToken(db, actor, id);
    expect(authenticateDevice(db, bearer(token))).toMatchObject({ ok: true, device: { deviceId: id, name: "desktop" } });
    expect(authenticateDevice(db, new Headers())).toEqual({ ok: false, reason: "missing" });
    expect(authenticateDevice(db, bearer("oc_dev_nope"))).toEqual({ ok: false, reason: "invalid" });

    const rotated = rotateDeviceToken(db, actor, id);
    expect(authenticateDevice(db, bearer(token))).toEqual({ ok: false, reason: "invalid" });
    expect(authenticateDevice(db, bearer(rotated)).ok).toBe(true);

    setDeviceStatus(db, actor, id, "disabled");
    expect(authenticateDevice(db, bearer(rotated))).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("device mutations", () => {
  it("new devices get every seeded model and no limits", () => {
    const { id } = createDevice(db, actor, { name: "laptop" });
    const policy = loadDevicePolicy(db, id);
    expect([...policy.allowedModelIds].sort()).toEqual(["fable", "haiku", "opus", "sonnet"]);
    expect(Object.values(policy.limits).every((v) => v === null)).toBe(true);
  });

  it("writes exactly one audit row per change, without secrets", () => {
    const { id } = createDevice(db, actor, { name: "laptop" });
    const token = rotateDeviceToken(db, actor, id);
    updateDevicePolicy(db, actor, id, {
      allowedModelIds: ["sonnet", "not-a-model"],
      limits: { dailyRequests: 100, weeklyRequests: null, dailyTokens: null, weeklyTokens: null, requestsPerMinute: 10, maxConcurrent: 2 },
    });
    const rows = db.select().from(auditEvents).all();
    expect(rows.map((r) => r.action)).toEqual(["device.create", "device.rotate_token", "policy.update"]);
    expect(rows[2]).toMatchObject({ adminUserId: "admin-1", ip: "10.0.0.5", targetId: id });
    expect(rows[2].after).toMatchObject({ allowedModelIds: ["sonnet"], limits: { dailyRequests: 100 } });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("writes no audit row when the change fails", () => {
    expect(() => setDeviceStatus(db, actor, "missing", "disabled")).toThrow(NotFoundError);
    expect(db.select().from(auditEvents).all()).toHaveLength(0);
  });
});

describe("counters", () => {
  it("loads today's usage from the DB, ignoring gateway denials", () => {
    const { id } = createDevice(db, actor, { name: "desktop" });
    const now = Date.now();
    const row = { requestId: "r", deviceId: id, endpoint: "messages", statusCode: 200, latencyMs: 1, ts: new Date(now - 1000) };
    db.insert(usageEvents).values([
      { ...row, inputTokens: 10, outputTokens: 20, cacheCreationTokens: 300, cacheReadTokens: 9999 },
      { ...row, statusCode: 429, errorType: "RATE_LIMITED" },
    ]).run();

    const c = countersFor(db, id, now);
    expect(c).toMatchObject({ dayRequests: 1, dayTokens: 330, weekRequests: 1 });

    const release = admit(c, now);
    expect(c).toMatchObject({ dayRequests: 2, inflight: 1 });
    release(70, now);
    release(70, now); // idempotent
    expect(c).toMatchObject({ dayTokens: 400, inflight: 0 });

    admit(c, now)(0, now, { refund: true });
    expect(c.dayRequests).toBe(2);
  });

  it("device row lookups stay scoped to the device", () => {
    const a = createDevice(db, actor, { name: "a" });
    const b = createDevice(db, actor, { name: "b" });
    db.insert(usageEvents).values({ requestId: "r", deviceId: a.id, endpoint: "messages", statusCode: 200, latencyMs: 1, ts: new Date(), inputTokens: 5 }).run();
    expect(countersFor(db, b.id, Date.now()).dayTokens).toBe(0);
    expect(db.select().from(usageEvents).where(eq(usageEvents.deviceId, a.id)).all()).toHaveLength(1);
  });
});
