import type { DeviceCounters } from "./counters";
import type { Windows } from "./windows";

export type Limits = {
  dailyRequests: number | null;
  weeklyRequests: number | null;
  dailyTokens: number | null;
  weeklyTokens: number | null;
  requestsPerMinute: number | null;
  maxConcurrent: number | null;
};

export type ModelInfo = { id: string; displayName: string; enabled: boolean };

export type PolicyInput = {
  requestedModel: string;
  // null when no registry prefix matches the requested model id.
  resolved: ModelInfo | null;
  allowedModelIds: ReadonlySet<string>;
  limits: Limits;
  counters: DeviceCounters;
  windows: Windows;
  now: number;
  // count_tokens only goes through the model gate.
  checkQuota: boolean;
};

export type DenyCode = "MODEL_NOT_ALLOWED" | "QUOTA_EXCEEDED" | "RATE_LIMITED" | "CONCURRENCY_LIMIT";

export type Decision =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 429;
      errorType: "permission_error" | "rate_limit_error";
      code: DenyCode;
      message: string;
      retryAfterSec?: number;
    };

const secondsUntil = (t: number, now: number) => Math.max(1, Math.ceil((t - now) / 1000));
const over = (used: number, limit: number | null) => limit !== null && used >= limit;

/** Pure admission decision. Checks run in a fixed order and the first failure wins. */
export function decide(p: PolicyInput): Decision {
  const { limits: l, counters: c, windows: w, now } = p;

  if (!p.resolved || !p.resolved.enabled || !p.allowedModelIds.has(p.resolved.id)) {
    const reason = !p.resolved
      ? "is not in the gateway's model registry"
      : !p.resolved.enabled
        ? "is disabled on this gateway"
        : "is not allowed for this device";
    return {
      ok: false,
      status: 403,
      errorType: "permission_error",
      code: "MODEL_NOT_ALLOWED",
      message: `MODEL_NOT_ALLOWED: ${p.requestedModel} ${reason}. Switch models with /model.`,
    };
  }
  if (!p.checkQuota) return { ok: true };

  const quota = (what: string, resetAt: number): Decision => ({
    ok: false,
    status: 429,
    errorType: "rate_limit_error",
    code: "QUOTA_EXCEEDED",
    message: `QUOTA_EXCEEDED: this device reached its ${what} limit. It resets at ${new Date(resetAt).toISOString()}.`,
    retryAfterSec: secondsUntil(resetAt, now),
  });
  if (over(c.dayRequests, l.dailyRequests)) return quota("daily request", w.nextDay);
  if (over(c.weekRequests, l.weeklyRequests)) return quota("weekly request", w.nextWeek);
  if (over(c.dayTokens, l.dailyTokens)) return quota("daily token", w.nextDay);
  if (over(c.weekTokens, l.weeklyTokens)) return quota("weekly token", w.nextWeek);

  if (over(c.recent.length, l.requestsPerMinute)) {
    return {
      ok: false,
      status: 429,
      errorType: "rate_limit_error",
      code: "RATE_LIMITED",
      message: `RATE_LIMITED: this device is limited to ${l.requestsPerMinute} requests per minute.`,
      retryAfterSec: secondsUntil(c.recent[0] + 60_000, now),
    };
  }
  if (over(c.inflight, l.maxConcurrent)) {
    return {
      ok: false,
      status: 429,
      errorType: "rate_limit_error",
      code: "CONCURRENCY_LIMIT",
      message: `CONCURRENCY_LIMIT: this device may run at most ${l.maxConcurrent} requests at once.`,
      retryAfterSec: 2,
    };
  }
  return { ok: true };
}
