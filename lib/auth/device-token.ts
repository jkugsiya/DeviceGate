import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DbOrTx } from "../db/client";
import { devices, deviceTokens } from "../db/schema";

const TOKEN_PREFIX = "oc_dev_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a new token for a device and returns the raw value, which is shown exactly once.
 * Tokens are 256-bit random, so an unsalted sha256 is enough to store them safely.
 */
export function issueDeviceToken(db: DbOrTx, deviceId: string): string {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  db.insert(deviceTokens)
    .values({ id: randomUUID(), deviceId, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12) })
    .run();
  return token;
}

export function revokeDeviceTokens(db: DbOrTx, deviceId: string) {
  db.update(deviceTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(deviceTokens.deviceId, deviceId), isNull(deviceTokens.revokedAt)))
    .run();
}

export type AuthenticatedDevice = { deviceId: string; tokenId: string; name: string };

export type AuthResult =
  | { ok: true; device: AuthenticatedDevice }
  | { ok: false; reason: "missing" | "invalid" | "disabled" };

/**
 * Resolves `Authorization: Bearer oc_dev_…` (what Claude Code sends for ANTHROPIC_AUTH_TOKEN)
 * or `x-api-key` to an enabled device. Lookup is by hash, so there is no string comparison to time.
 */
export function authenticateDevice(db: DbOrTx, headers: Headers): AuthResult {
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? headers.get("x-api-key");
  if (!token) return { ok: false, reason: "missing" };
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, reason: "invalid" };

  const row = db
    .select({
      tokenId: deviceTokens.id,
      revokedAt: deviceTokens.revokedAt,
      deviceId: devices.id,
      name: devices.name,
      status: devices.status,
      deletedAt: devices.deletedAt,
    })
    .from(deviceTokens)
    .innerJoin(devices, eq(devices.id, deviceTokens.deviceId))
    .where(eq(deviceTokens.tokenHash, hashToken(token)))
    .get();

  if (!row || row.revokedAt || row.deletedAt) return { ok: false, reason: "invalid" };
  if (row.status !== "enabled") return { ok: false, reason: "disabled" };
  return { ok: true, device: { deviceId: row.deviceId, tokenId: row.tokenId, name: row.name } };
}
