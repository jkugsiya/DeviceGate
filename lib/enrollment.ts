import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { type Actor, audit } from "./audit";
import { issueDeviceToken, revokeDeviceTokens } from "./auth/device-token";
import type { DB } from "./db/client";
import { devices, enrollmentCodes } from "./db/schema";
import { NotFoundError } from "./devices";

// One-time setup codes: the admin generates one for a device, the PC's setup script trades it for
// a device token. Codes are short enough to type, single-use, and expire quickly.
export const ENROLLMENT_TTL_MS = 15 * 60_000;
// No I/O/0/1, so codes read back unambiguously.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const hashCode = (code: string) => createHash("sha256").update(normalizeCode(code)).digest("hex");

/** Issues a fresh code for a device, replacing any unused one. Returns it formatted as XXXX-XXXX. */
export function createEnrollmentCode(db: DB, actor: Actor, deviceId: string) {
  const device = db.select({ deletedAt: devices.deletedAt }).from(devices).where(eq(devices.id, deviceId)).get();
  if (!device || device.deletedAt) throw new NotFoundError(`Device ${deviceId} not found`);
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS);
  db.transaction((tx) => {
    tx.update(enrollmentCodes)
      .set({ expiresAt: now })
      .where(and(eq(enrollmentCodes.deviceId, deviceId), isNull(enrollmentCodes.usedAt), gt(enrollmentCodes.expiresAt, now)))
      .run();
    tx.insert(enrollmentCodes).values({ id: randomUUID(), deviceId, codeHash: hashCode(raw), expiresAt }).run();
    audit(tx, actor, { action: "enrollment.create", targetType: "device", targetId: deviceId, after: { expiresAt } });
  });
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
}

export type RedeemResult = { ok: true; token: string; deviceId: string; deviceName: string } | { ok: false };

/**
 * Trades a valid code for a new device token. The device's previous tokens are revoked, so
 * re-running setup on a PC (or moving the device to a new PC) leaves exactly one live token.
 */
export function redeemEnrollmentCode(db: DB, code: string, meta: { ip: string | null; hostname: string | null }): RedeemResult {
  const now = new Date();
  return db.transaction((tx): RedeemResult => {
    const row = tx
      .select({ id: enrollmentCodes.id, deviceId: devices.id, name: devices.name, status: devices.status, deletedAt: devices.deletedAt })
      .from(enrollmentCodes)
      .innerJoin(devices, eq(devices.id, enrollmentCodes.deviceId))
      .where(and(eq(enrollmentCodes.codeHash, hashCode(code)), isNull(enrollmentCodes.usedAt), gt(enrollmentCodes.expiresAt, now)))
      .get();
    const actor: Actor = { adminUserId: null, ip: meta.ip, userAgent: meta.hostname ? `setup script on ${meta.hostname}` : "setup script" };
    if (!row || row.deletedAt || row.status !== "enabled") {
      audit(tx, actor, { action: "enrollment.failed", targetType: "device", targetId: row?.deviceId ?? null });
      return { ok: false };
    }
    tx.update(enrollmentCodes).set({ usedAt: now }).where(eq(enrollmentCodes.id, row.id)).run();
    revokeDeviceTokens(tx, row.deviceId);
    const token = issueDeviceToken(tx, row.deviceId);
    audit(tx, actor, { action: "enrollment.used", targetType: "device", targetId: row.deviceId, after: { hostname: meta.hostname } });
    return { ok: true, token, deviceId: row.deviceId, deviceName: row.name };
  });
}
