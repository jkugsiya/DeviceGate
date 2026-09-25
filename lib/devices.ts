import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { type Actor, audit } from "./audit";
import { issueDeviceToken, revokeDeviceTokens } from "./auth/device-token";
import type { DB } from "./db/client";
import { deviceModels, devicePolicies, devices, models } from "./db/schema";
import type { Limits } from "./policy/decide";

// Device mutations shared by the admin UI and scripts/device.ts. Each runs in one transaction
// together with its audit row.

export class NotFoundError extends Error {}

function getDevice(db: DB, id: string) {
  const device = db.select().from(devices).where(eq(devices.id, id)).get();
  if (!device || device.deletedAt) throw new NotFoundError(`Device ${id} not found`);
  return device;
}

/**
 * Creates a device with access to every enabled model and no limits. It has no token until a PC
 * redeems a setup code (lib/enrollment.ts) or an admin issues one with rotateDeviceToken.
 */
export function createDevice(db: DB, actor: Actor, input: { name: string; notes?: string | null }) {
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(devices).values({ id, name: input.name, notes: input.notes ?? null }).run();
    tx.insert(devicePolicies).values({ deviceId: id }).run();
    const enabled = tx.select({ id: models.id }).from(models).where(eq(models.enabled, true)).all();
    if (enabled.length) tx.insert(deviceModels).values(enabled.map((m) => ({ deviceId: id, modelId: m.id }))).run();
    audit(tx, actor, { action: "device.create", targetType: "device", targetId: id, after: input });
  });
  return { id };
}

export function updateDeviceDetails(db: DB, actor: Actor, id: string, input: { name: string; notes: string | null }) {
  const before = getDevice(db, id);
  db.transaction((tx) => {
    tx.update(devices).set(input).where(eq(devices.id, id)).run();
    audit(tx, actor, {
      action: "device.update",
      targetType: "device",
      targetId: id,
      before: { name: before.name, notes: before.notes },
      after: input,
    });
  });
}

export function setDeviceStatus(db: DB, actor: Actor, id: string, status: "enabled" | "disabled") {
  const before = getDevice(db, id);
  if (before.status === status) return;
  db.transaction((tx) => {
    tx.update(devices).set({ status }).where(eq(devices.id, id)).run();
    audit(tx, actor, {
      action: status === "enabled" ? "device.enable" : "device.disable",
      targetType: "device",
      targetId: id,
      before: { status: before.status },
      after: { status },
    });
  });
}

/** Revokes every live token and issues a new one, shown once. */
export function rotateDeviceToken(db: DB, actor: Actor, id: string) {
  getDevice(db, id);
  return db.transaction((tx) => {
    revokeDeviceTokens(tx, id);
    audit(tx, actor, { action: "device.rotate_token", targetType: "device", targetId: id });
    return issueDeviceToken(tx, id);
  });
}

/** Soft delete: revokes tokens but keeps usage and audit history. */
export function deleteDevice(db: DB, actor: Actor, id: string) {
  const before = getDevice(db, id);
  db.transaction((tx) => {
    revokeDeviceTokens(tx, id);
    tx.update(devices).set({ deletedAt: new Date(), status: "disabled" }).where(eq(devices.id, id)).run();
    audit(tx, actor, { action: "device.delete", targetType: "device", targetId: id, before: { name: before.name } });
  });
  return before.name;
}

export function getDevicePolicy(db: DB, id: string) {
  const limits = db.select().from(devicePolicies).where(eq(devicePolicies.deviceId, id)).get();
  const allowed = db
    .select({ id: deviceModels.modelId })
    .from(deviceModels)
    .where(eq(deviceModels.deviceId, id))
    .all()
    .map((r) => r.id)
    .sort();
  return { limits, allowedModelIds: allowed };
}

export function updateDevicePolicy(
  db: DB,
  actor: Actor,
  id: string,
  input: { limits: Limits; allowedModelIds: string[] },
) {
  getDevice(db, id);
  const known = db.select({ id: models.id }).from(models).where(inArray(models.id, input.allowedModelIds)).all();
  const allowed = known.map((m) => m.id).sort();
  const before = getDevicePolicy(db, id);
  db.transaction((tx) => {
    tx.insert(devicePolicies)
      .values({ deviceId: id, ...input.limits })
      .onConflictDoUpdate({ target: devicePolicies.deviceId, set: input.limits })
      .run();
    tx.delete(deviceModels).where(eq(deviceModels.deviceId, id)).run();
    if (allowed.length) tx.insert(deviceModels).values(allowed.map((modelId) => ({ deviceId: id, modelId }))).run();
    audit(tx, actor, {
      action: "policy.update",
      targetType: "device",
      targetId: id,
      before: { limits: stripDeviceId(before.limits), allowedModelIds: before.allowedModelIds },
      after: { limits: input.limits, allowedModelIds: allowed },
    });
  });
}

export function setModelEnabled(db: DB, actor: Actor, modelId: string, enabled: boolean) {
  const before = db.select().from(models).where(eq(models.id, modelId)).get();
  if (!before) throw new NotFoundError(`Model ${modelId} not found`);
  if (before.enabled === enabled) return;
  db.transaction((tx) => {
    tx.update(models).set({ enabled }).where(eq(models.id, modelId)).run();
    audit(tx, actor, {
      action: "model.update",
      targetType: "model",
      targetId: modelId,
      before: { enabled: before.enabled },
      after: { enabled },
    });
  });
}

function stripDeviceId<T extends { deviceId: string }>(row: T | undefined) {
  if (!row) return null;
  const { deviceId: _, ...rest } = row;
  return rest;
}
