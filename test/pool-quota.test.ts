import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DB, migrateDb, openDb } from "../lib/db/client";
import { upstreamQuota } from "../lib/db/schema";
import { parsePool, poolQuota, removeAccount, setAccountPaused } from "../lib/pool-quota";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-14T12:00:00Z");

/** A bucket as `GET /teamclaude/quota` reports it. */
const b = (utilization: number, resetAt: number, source = "unified5h") => ({
  utilization,
  remaining: 1 - utilization,
  resetAt,
  source,
});

/** One account row; Max 20x, active, with nothing used unless overridden. */
function account(name: string, over: Record<string, unknown> = {}, buckets: Record<string, unknown> = {}) {
  return {
    name,
    type: "oauth",
    disabled: false,
    status: "active",
    tier: { rateLimitTier: "default_claude_max_20x", seatTier: null, weight: 20 },
    buckets: {
      fiveHour: b(0, T0 + HOUR),
      weeklyShared: b(0, T0 + 48 * HOUR, "unified7d"),
      weeklySonnet: b(0, T0 + 48 * HOUR, "unified7d"),
      weeklyFable: b(0, T0 + 48 * HOUR, "unified7d"),
      ...buckets,
    },
    ...over,
  };
}

describe("parsePool", () => {
  it("weights pool totals by plan size and resets with the soonest account", () => {
    const pool = parsePool({
      accounts: [
        account("big", {}, { fiveHour: b(0.5, T0 + 3 * HOUR) }),
        account("small", { tier: { weight: 5 } }, { fiveHour: b(1, T0 + HOUR) }),
        account("seat", { tier: { rateLimitTier: "default_raven", seatTier: "team_standard", weight: 1 } }),
      ],
      aggregate: {},
    });
    // (20 × 0.5 + 5 × 1 + 1 × 0) / 26
    expect(pool.fiveHour?.used).toBeCloseTo(15 / 26, 10);
    expect(pool.fiveHour?.resetAt).toEqual(new Date(T0 + HOUR));
    expect(pool.accounts.map((a) => [a.name, a.plan, a.state])).toEqual([
      ["big", "Max 20x", "available"],
      ["small", "Max 5x", "exhausted"],
      ["seat", "Team Standard", "available"],
    ]);
  });

  it("leaves paused and broken accounts out of the totals", () => {
    const pool = parsePool({
      accounts: [
        account("live", {}, { weeklyShared: b(0.2, T0, "unified7d") }),
        account("paused", { disabled: true }, { weeklyShared: b(0, T0, "unified7d") }),
        account("broken", { status: "error" }, { weeklyShared: b(0, T0, "unified7d") }),
      ],
    });
    expect(pool.weekly?.used).toBeCloseTo(0.2, 10);
    expect(pool.accounts.map((a) => a.state)).toEqual(["available", "disabled", "error"]);
  });

  it("skips unknown tiers beside known ones, and weighs them equally when none are known", () => {
    const unknown = { tier: { weight: null } };
    const mixed = parsePool({
      accounts: [account("known", {}, { fiveHour: b(0.1, T0) }), account("odd", unknown, { fiveHour: b(0.9, T0) })],
    });
    expect(mixed.fiveHour?.used).toBeCloseTo(0.1, 10);

    const none = parsePool({
      accounts: [account("a", unknown, { fiveHour: b(0.2, T0) }), account("b", unknown, { fiveHour: b(0.6, T0) })],
    });
    expect(none.fiveHour?.used).toBeCloseTo(0.4, 10);
  });

  it("shows a Fable bucket only where the account reports its own", () => {
    const pool = parsePool({
      accounts: [account("own", {}, { weeklyFable: b(0.7, T0, "unified7dFable") }), account("shared")],
    });
    expect(pool.accounts.map((a) => a.fable?.used ?? null)).toEqual([0.7, null]);
  });
});

describe("poolQuota", () => {
  const globals = globalThis as unknown as { __gatewayDb?: DB; __poolQuota?: unknown };

  beforeEach(() => {
    vi.stubEnv("UPSTREAM_API_KEY", "tc-key");
    globals.__gatewayDb = openDb(":memory:");
    migrateDb(globals.__gatewayDb);
    globals.__poolQuota = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks TeamClaude with the gateway's key", async () => {
    const fetchMock = vi.fn(async () => Response.json({ accounts: [account("me")] }));
    vi.stubGlobal("fetch", fetchMock);
    const pool = await poolQuota();
    expect(pool.source).toBe("teamclaude");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3456/teamclaude/quota",
      expect.objectContaining({ headers: { "x-api-key": "tc-key" } }),
    );
  });

  it("falls back to the last response headers, saying why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    globals.__gatewayDb!.insert(upstreamQuota)
      .values({ id: 1, fiveHourUtil: 0.3, weeklyUtil: 1.2, raw: {}, updatedAt: new Date() })
      .run();
    const pool = await poolQuota();
    expect(pool.source).toBe("headers");
    expect(pool.fiveHour?.used).toBe(0.3);
    expect(pool.weekly?.used).toBe(1);
    expect(pool.accounts).toEqual([]);
    expect(pool.error).toMatch(/Update it/);
  });
});

describe("setAccountPaused", () => {
  const globals = globalThis as unknown as { __poolQuota?: unknown };

  beforeEach(() => vi.stubEnv("UPSTREAM_API_KEY", "tc-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks TeamClaude to disable the account by name, and drops the cached reading", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, name: "me@example.com", disabled: true }));
    vi.stubGlobal("fetch", fetchMock);
    globals.__poolQuota = { at: Date.now(), value: Promise.resolve(null) };
    await setAccountPaused("me@example.com", true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3456/teamclaude/disable",
      expect.objectContaining({
        method: "POST",
        headers: { "x-api-key": "tc-key", "content-type": "application/json" },
        body: JSON.stringify({ account: "me@example.com", disabled: true }),
      }),
    );
    expect(globals.__poolQuota).toBeUndefined();
  });

  it("passes TeamClaude's own refusal through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: 'no account matches "x"' }, { status: 400 })));
    await expect(setAccountPaused("x", true)).rejects.toThrow('TeamClaude: no account matches "x"');
  });

  it("says to update a TeamClaude without the endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(setAccountPaused("me", false)).rejects.toThrow(/1\.1\.25/);
  });
});

describe("removeAccount", () => {
  const globals = globalThis as unknown as { __poolQuota?: unknown };
  const toolResult = (result: object) => Response.json({ jsonrpc: "2.0", id: 1, result });

  beforeEach(() => vi.stubEnv("UPSTREAM_API_KEY", "tc-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("calls TeamClaude's remove_account tool by name, and drops the cached reading", async () => {
    const fetchMock = vi.fn(async () => toolResult({ content: [{ type: "text", text: "{}" }] }));
    vi.stubGlobal("fetch", fetchMock);
    globals.__poolQuota = { at: Date.now(), value: Promise.resolve(null) };
    await removeAccount("me@example.com");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3456/teamclaude/mcp");
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: "tools/call",
      params: { name: "remove_account", arguments: { account: "me@example.com" } },
    });
    expect(globals.__poolQuota).toBeUndefined();
  });

  it("explains how to turn the endpoint on when it is off or read-only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "the MCP endpoint is off" }, { status: 404 })));
    await expect(removeAccount("me")).rejects.toThrow(/"mcp": "full"/);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool: remove_account" } })));
    await expect(removeAccount("me")).rejects.toThrow(/"mcp": "full"/);
  });

  it("passes the tool's own refusal through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => toolResult({ isError: true, content: [{ type: "text", text: 'no account "x"' }] })));
    await expect(removeAccount("x")).rejects.toThrow('TeamClaude: no account "x"');
  });
});
