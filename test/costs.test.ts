import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../lib/audit";
import { priceRequests } from "../lib/costs";
import { type DB, migrateDb, openDb } from "../lib/db/client";
import { usageEvents } from "../lib/db/schema";
import { createDevice } from "../lib/devices";

const actor: Actor = { adminUserId: "admin-1", ip: "10.0.0.5", userAgent: "test" };
let db: DB;
let deviceId: string;

beforeEach(() => {
  db = openDb(":memory:");
  migrateDb(db);
  deviceId = createDevice(db, actor, { name: "desktop" }).id;
});

const noTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation1hTokens: 0,
  cacheReadTokens: 0,
};

/** Inserts a request the way a pre-cost-tracking gateway would have: tokens, but no cost. */
function record(model: string | null, tokens: Partial<typeof noTokens>, costUsd: number | null = null) {
  db.insert(usageEvents)
    .values({
      requestId: crypto.randomUUID(),
      deviceId,
      ts: new Date(),
      endpoint: "messages",
      model,
      ...noTokens,
      ...tokens,
      costUsd,
      statusCode: 200,
      latencyMs: 10,
    })
    .run();
}

const costs = () => db.select({ model: usageEvents.model, cost: usageEvents.costUsd }).from(usageEvents).all();

describe("priceRequests", () => {
  it("backfills requests recorded before costs existed", () => {
    record("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const run = priceRequests(db, "missing");
    expect(run.priced).toBe(1);
    expect(costs()[0].cost).toBeCloseTo(30, 10); // $5 input + $25 output
  });

  it("does nothing on a second run, so booting repeatedly is free", () => {
    record("claude-opus-5", { inputTokens: 1_000_000 });
    expect(priceRequests(db, "missing").priced).toBe(1);
    const second = priceRequests(db, "missing");
    expect(second.scanned).toBe(0);
    expect(second.priced).toBe(0);
  });

  it("leaves rows that already have a cost alone", () => {
    record("claude-opus-5", { inputTokens: 1_000_000 }, 999);
    expect(priceRequests(db, "missing").scanned).toBe(0);
    expect(costs()[0].cost).toBe(999);
  });

  it("prices a request that carried no tokens at zero rather than leaving it unpriced", () => {
    // An upstream 429 records no tokens; NULL has to keep meaning "this model has no rate".
    record("claude-opus-5", {});
    priceRequests(db, "missing");
    expect(costs()[0].cost).toBe(0);
  });

  it("reports an unpriced model instead of counting it as free, and retries it next time", () => {
    record("gpt-5", { inputTokens: 5000 });
    const run = priceRequests(db, "missing");
    expect(run.priced).toBe(0);
    expect(run.unpriced.get("gpt-5")).toBe(1);
    expect(costs()[0].cost).toBeNull();
    // Still NULL, so the next boot picks it up once a rate is added.
    expect(priceRequests(db, "missing").scanned).toBe(1);
  });

  it("re-prices everything under the 'all' scope, which a rate change needs", () => {
    record("claude-opus-5", { inputTokens: 1_000_000 }, 999);
    const run = priceRequests(db, "all");
    expect(run.priced).toBe(1);
    expect(costs()[0].cost).toBeCloseTo(5, 10);
  });
});
