import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { auditEvents, deviceModels, devicePolicies, devices, deviceTokens, models, upstreamQuota, usageEvents, user } from "./db/schema";
import { windowsAt } from "./policy/windows";

// Read models for the admin pages. Token figures are quota tokens (input + cache writes + output);
// costs are the API-equivalent dollars recorded per request (lib/pricing.ts).

const quotaTokens = sql`(${usageEvents.inputTokens} + ${usageEvents.cacheCreationTokens} + ${usageEvents.outputTokens})`;
const cost = sql`coalesce(${usageEvents.costUsd}, 0)`;

function usageByDevice(now: number) {
  const w = windowsAt(now);
  const counted = sql`${usageEvents.errorType} is null`;
  const today = sql`${usageEvents.ts} >= ${w.dayStart}`;
  const rows = db()
    .select({
      deviceId: usageEvents.deviceId,
      dayRequests: sql<number>`coalesce(sum(case when ${today} and ${counted} then 1 else 0 end), 0)`,
      dayTokens: sql<number>`coalesce(sum(case when ${today} then ${quotaTokens} else 0 end), 0)`,
      dayCost: sql<number>`coalesce(sum(case when ${today} then ${cost} else 0 end), 0)`,
      dayBlocked: sql<number>`coalesce(sum(case when ${today} and not ${counted} then 1 else 0 end), 0)`,
      weekRequests: sql<number>`coalesce(sum(case when ${counted} then 1 else 0 end), 0)`,
      weekTokens: sql<number>`coalesce(sum(${quotaTokens}), 0)`,
      weekCost: sql<number>`coalesce(sum(${cost}), 0)`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.endpoint, "messages"), gte(usageEvents.ts, new Date(w.weekStart))))
    .groupBy(usageEvents.deviceId)
    .all();
  return new Map(rows.map((r) => [r.deviceId, r]));
}

export type DeviceUsage = {
  dayRequests: number;
  dayTokens: number;
  dayCost: number;
  dayBlocked: number;
  weekRequests: number;
  weekTokens: number;
  weekCost: number;
};
const noUsage: DeviceUsage = { dayRequests: 0, dayTokens: 0, dayCost: 0, dayBlocked: 0, weekRequests: 0, weekTokens: 0, weekCost: 0 };

export function dashboardData() {
  const now = Date.now();
  const usage = usageByDevice(now);
  const list = db().select().from(devices).where(isNull(devices.deletedAt)).orderBy(devices.name).all();
  const allowed = db().select().from(deviceModels).all();
  const connected = new Set(
    db().select({ id: deviceTokens.deviceId }).from(deviceTokens).where(isNull(deviceTokens.revokedAt)).all().map((r) => r.id),
  );
  const rows = list.map((d) => ({
    ...d,
    connected: connected.has(d.id),
    usage: usage.get(d.id) ?? noUsage,
    models: allowed.filter((a) => a.deviceId === d.id).map((a) => a.modelId).sort(),
  }));
  const totals = rows.reduce(
    (t, r) => ({
      dayRequests: t.dayRequests + r.usage.dayRequests,
      dayTokens: t.dayTokens + r.usage.dayTokens,
      dayCost: t.dayCost + r.usage.dayCost,
      dayBlocked: t.dayBlocked + r.usage.dayBlocked,
      weekRequests: t.weekRequests + r.usage.weekRequests,
      weekTokens: t.weekTokens + r.usage.weekTokens,
      weekCost: t.weekCost + r.usage.weekCost,
    }),
    { dayRequests: 0, dayTokens: 0, dayCost: 0, dayBlocked: 0, weekRequests: 0, weekTokens: 0, weekCost: 0 },
  );
  const upstream = db().select().from(upstreamQuota).where(eq(upstreamQuota.id, 1)).get() ?? null;
  const w = windowsAt(now);
  return { devices: rows, totals, upstream, windows: w };
}

export function deviceDetail(id: string) {
  const device = db().select().from(devices).where(eq(devices.id, id)).get();
  if (!device || device.deletedAt) return null;
  const policy = db().select().from(devicePolicies).where(eq(devicePolicies.deviceId, id)).get() ?? null;
  const allowedModelIds = new Set(
    db().select({ id: deviceModels.modelId }).from(deviceModels).where(eq(deviceModels.deviceId, id)).all().map((r) => r.id),
  );
  const registry = db().select().from(models).orderBy(models.id).all();
  const activeToken = db()
    .select({ prefix: deviceTokens.tokenPrefix, createdAt: deviceTokens.createdAt, lastUsedAt: deviceTokens.lastUsedAt })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.deviceId, id), isNull(deviceTokens.revokedAt)))
    .orderBy(desc(deviceTokens.createdAt))
    .get();
  const recent = db()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.deviceId, id))
    .orderBy(desc(usageEvents.id))
    .limit(50)
    .all();
  const now = Date.now();
  const usage = usageByDevice(now).get(id) ?? noUsage;
  return { device, policy, allowedModelIds, registry, activeToken, recent, usage, weekStart: windowsAt(now).weekStart };
}

export function modelList() {
  const registry = db().select().from(models).orderBy(models.id).all();
  const counts = db()
    .select({ modelId: deviceModels.modelId, n: sql<number>`count(*)` })
    .from(deviceModels)
    .innerJoin(devices, eq(devices.id, deviceModels.deviceId))
    .where(isNull(devices.deletedAt))
    .groupBy(deviceModels.modelId)
    .all();
  return registry.map((m) => ({ ...m, devices: counts.find((c) => c.modelId === m.id)?.n ?? 0 }));
}

export function auditLog(limit = 200) {
  const rows = db().select().from(auditEvents).orderBy(desc(auditEvents.id)).limit(limit).all();
  const deviceIds = rows.filter((r) => r.targetType === "device" && r.targetId).map((r) => r.targetId!);
  const adminIds = rows
    .flatMap((r) => [r.adminUserId, r.targetType === "admin" ? r.targetId : null])
    .filter((x): x is string => !!x);
  const deviceNames = new Map(
    deviceIds.length
      ? db().select({ id: devices.id, name: devices.name }).from(devices).where(inArray(devices.id, deviceIds)).all().map((d) => [d.id, d.name])
      : [],
  );
  const adminEmails = new Map(
    adminIds.length
      ? db().select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, adminIds)).all().map((u) => [u.id, u.email])
      : [],
  );
  return rows.map((r) => ({
    ...r,
    targetName: !r.targetId
      ? null
      : r.targetType === "device"
        ? (deviceNames.get(r.targetId) ?? r.targetId)
        : r.targetType === "admin"
          ? (adminEmails.get(r.targetId) ?? r.targetId)
          : r.targetId,
    actorName: r.adminUserId ? (adminEmails.get(r.adminUserId) ?? r.adminUserId) : r.ip === "cli" ? "CLI" : "—",
  }));
}
