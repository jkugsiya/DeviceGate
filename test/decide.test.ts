import { describe, expect, it } from "vitest";
import type { DeviceCounters } from "../lib/policy/counters";
import { decide, type Limits, type PolicyInput } from "../lib/policy/decide";
import { windowsAt } from "../lib/policy/windows";

const now = Date.parse("2026-09-22T12:00:00+05:30");
const noLimits: Limits = {
  dailyRequests: null,
  weeklyRequests: null,
  dailyTokens: null,
  weeklyTokens: null,
  requestsPerMinute: null,
  maxConcurrent: null,
};
const idle: DeviceCounters = {
  dayStart: windowsAt(now).dayStart,
  dayRequests: 0,
  dayTokens: 0,
  weekRequests: 0,
  weekTokens: 0,
  recent: [],
  inflight: 0,
};

type Overrides = { limits?: Partial<Limits>; counters?: Partial<DeviceCounters> } & Partial<Omit<PolicyInput, "limits" | "counters">>;

function input(over: Overrides = {}): PolicyInput {
  const { limits, counters, ...rest } = over;
  return {
    requestedModel: "claude-sonnet-5",
    resolved: { id: "sonnet", displayName: "Sonnet", enabled: true },
    allowedModelIds: new Set(["sonnet", "haiku"]),
    limits: { ...noLimits, ...limits },
    counters: { ...idle, ...counters },
    windows: windowsAt(now),
    now,
    checkQuota: true,
    ...rest,
  };
}

const code = (p: PolicyInput) => {
  const d = decide(p);
  return d.ok ? "OK" : d.code;
};

describe("decide", () => {
  it("allows a permitted model with no limits", () => {
    expect(code(input())).toBe("OK");
  });

  it("denies unknown, disabled and non-allow-listed models without downgrading", () => {
    expect(code(input({ resolved: null, requestedModel: "gpt-5" }))).toBe("MODEL_NOT_ALLOWED");
    expect(code(input({ resolved: { id: "sonnet", displayName: "Sonnet", enabled: false } }))).toBe("MODEL_NOT_ALLOWED");
    const opus = decide(input({ requestedModel: "claude-opus-5", resolved: { id: "opus", displayName: "Opus", enabled: true } }));
    expect(opus).toMatchObject({ ok: false, status: 403, code: "MODEL_NOT_ALLOWED" });
  });

  it("count_tokens only checks the model gate", () => {
    expect(code(input({ checkQuota: false, limits: { dailyRequests: 0 } }))).toBe("OK");
  });

  it("denies at the limit, with Retry-After pointing at the window reset", () => {
    const d = decide(input({ limits: { dailyTokens: 1000 }, counters: { dayTokens: 1000 } }));
    expect(d).toMatchObject({ ok: false, status: 429, code: "QUOTA_EXCEEDED" });
    expect(!d.ok && d.retryAfterSec).toBe(12 * 3600); // noon → midnight IST
    expect(code(input({ limits: { weeklyRequests: 5 }, counters: { weekRequests: 5 } }))).toBe("QUOTA_EXCEEDED");
    expect(code(input({ limits: { dailyTokens: 1000 }, counters: { dayTokens: 999 } }))).toBe("OK");
  });

  it("rate limits on requests in the last minute", () => {
    const d = decide(input({ limits: { requestsPerMinute: 2 }, counters: { recent: [now - 50_000, now - 10_000] } }));
    expect(d).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterSec: 10 });
  });

  it("limits concurrent requests", () => {
    expect(code(input({ limits: { maxConcurrent: 2 }, counters: { inflight: 2 } }))).toBe("CONCURRENCY_LIMIT");
    expect(code(input({ limits: { maxConcurrent: 2 }, counters: { inflight: 1 } }))).toBe("OK");
  });

  it("applies checks in a fixed order: model, quota, rate, concurrency", () => {
    const everythingOver = input({
      resolved: null,
      limits: { dailyRequests: 1, requestsPerMinute: 1, maxConcurrent: 1 },
      counters: { dayRequests: 1, recent: [now], inflight: 1 },
    });
    expect(code(everythingOver)).toBe("MODEL_NOT_ALLOWED");
    expect(code({ ...everythingOver, resolved: { id: "sonnet", displayName: "Sonnet", enabled: true } })).toBe("QUOTA_EXCEEDED");
  });
});
