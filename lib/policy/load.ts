import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { defaultLimits, deviceModels, devicePolicies, models } from "../db/schema";
import type { Limits, ModelInfo } from "./decide";

export type ModelRow = typeof models.$inferSelect;

const UNLIMITED: Limits = {
  dailyRequests: null,
  weeklyRequests: null,
  dailyTokens: null,
  weeklyTokens: null,
  dailyCostUsd: null,
  weeklyCostUsd: null,
  requestsPerMinute: null,
  maxConcurrent: null,
};

/** Maps a provider model id (e.g. claude-opus-5) to its registry family; longest prefix wins. */
export function resolveModel(registry: ModelRow[], requested: string): ModelInfo | null {
  let best: ModelRow | null = null;
  for (const m of registry) {
    if (requested.startsWith(m.matchPrefix) && (!best || m.matchPrefix.length > best.matchPrefix.length)) best = m;
  }
  return best && { id: best.id, displayName: best.displayName, enabled: best.enabled };
}

const LIMIT_KEYS = Object.keys(UNLIMITED) as (keyof Limits)[];

/** The gateway-wide limits a device inherits for every field it leaves empty. */
export function loadDefaultLimits(db: DbOrTx): Limits {
  const row = db.select().from(defaultLimits).where(eq(defaultLimits.id, 1)).get();
  return effectiveLimits(row, UNLIMITED);
}

/** A device's own limit wins; an empty (NULL) field falls back to the default. */
export function effectiveLimits(own: Partial<Limits> | undefined, defaults: Limits): Limits {
  return Object.fromEntries(LIMIT_KEYS.map((k) => [k, own?.[k] ?? defaults[k]])) as Limits;
}

// A few indexed SQLite reads per request (well under a millisecond), so there is no cache to invalidate.
export function loadDevicePolicy(db: DbOrTx, deviceId: string) {
  const registry = db.select().from(models).all();
  const allowedModelIds = new Set(
    db
      .select({ id: deviceModels.modelId })
      .from(deviceModels)
      .where(eq(deviceModels.deviceId, deviceId))
      .all()
      .map((r) => r.id),
  );
  const row = db.select().from(devicePolicies).where(eq(devicePolicies.deviceId, deviceId)).get();
  const limits = effectiveLimits(row, loadDefaultLimits(db));
  return { registry, allowedModelIds, limits };
}
