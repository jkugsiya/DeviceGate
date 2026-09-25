import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../lib/audit";
import { authenticateDevice } from "../lib/auth/device-token";
import { type DB, migrateDb, openDb } from "../lib/db/client";
import { auditEvents } from "../lib/db/schema";
import { createDevice, rotateDeviceToken, setDeviceStatus } from "../lib/devices";
import { createEnrollmentCode, ENROLLMENT_TTL_MS, redeemEnrollmentCode } from "../lib/enrollment";

const actor: Actor = { adminUserId: "admin-1", ip: "10.0.0.5", userAgent: "test" };
const meta = { ip: "10.0.0.9", hostname: "macbook" };
const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });
let db: DB;
let deviceId: string;

beforeEach(() => {
  vi.useRealTimers();
  db = openDb(":memory:");
  migrateDb(db);
  deviceId = createDevice(db, actor, { name: "MacBook" }).id;
});

describe("enrollment", () => {
  it("trades a code for a working token, once, regardless of formatting", () => {
    const { code } = createEnrollmentCode(db, actor, deviceId);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const result = redeemEnrollmentCode(db, code.toLowerCase().replace("-", " "), meta);
    expect(result).toMatchObject({ ok: true, deviceId, deviceName: "MacBook" });
    expect(result.ok && authenticateDevice(db, bearer(result.token)).ok).toBe(true);

    expect(redeemEnrollmentCode(db, code, meta)).toEqual({ ok: false });
  });

  it("rejects expired codes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { code } = createEnrollmentCode(db, actor, deviceId);
    vi.setSystemTime(Date.now() + ENROLLMENT_TTL_MS + 1);
    expect(redeemEnrollmentCode(db, code, meta)).toEqual({ ok: false });
  });

  it("a new code replaces the previous unused one", () => {
    const first = createEnrollmentCode(db, actor, deviceId).code;
    const second = createEnrollmentCode(db, actor, deviceId).code;
    expect(redeemEnrollmentCode(db, first, meta)).toEqual({ ok: false });
    expect(redeemEnrollmentCode(db, second, meta).ok).toBe(true);
  });

  it("revokes the device's previous token when a PC reconnects", () => {
    const oldToken = rotateDeviceToken(db, actor, deviceId);
    const result = redeemEnrollmentCode(db, createEnrollmentCode(db, actor, deviceId).code, meta);
    expect(authenticateDevice(db, bearer(oldToken)).ok).toBe(false);
    expect(result.ok && authenticateDevice(db, bearer(result.token)).ok).toBe(true);
  });

  it("refuses disabled devices and audits both outcomes", () => {
    const { code } = createEnrollmentCode(db, actor, deviceId);
    setDeviceStatus(db, actor, deviceId, "disabled");
    expect(redeemEnrollmentCode(db, code, meta)).toEqual({ ok: false });
    setDeviceStatus(db, actor, deviceId, "enabled");
    expect(redeemEnrollmentCode(db, code, meta).ok).toBe(true);

    const actions = db.select().from(auditEvents).all().map((r) => r.action);
    expect(actions).toContain("enrollment.failed");
    expect(actions.at(-1)).toBe("enrollment.used");
  });
});
