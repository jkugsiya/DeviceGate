import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "./config";
import { db } from "./db/client";
import { upstreamQuota } from "./db/schema";

/** One rolling window: the fraction used (clamped to 0–1) and when it next resets. */
export type QuotaWindow = { used: number; resetAt: Date | null };

export type AccountState = "available" | "throttled" | "exhausted" | "disabled" | "error";

export type PoolAccount = {
  name: string;
  /** "Max 20x", "Max 5x", "Pro" or "API key"; null when TeamClaude doesn't know the tier. */
  plan: string | null;
  state: AccountState;
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  /** Set only when the account reports its own Fable weekly bucket. */
  fable: QuotaWindow | null;
};

export type PoolQuota = {
  /** Where the figures came from. "headers" is the fallback: the last response's rate-limit headers. */
  source: "teamclaude" | "headers" | "none";
  /** Pool-wide, weighted by plan size, over the accounts that can take traffic. */
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  /** Empty unless the source is TeamClaude: headers only describe whichever account answered. */
  accounts: PoolAccount[];
  updatedAt: Date | null;
  /** Why TeamClaude's endpoint couldn't be used, for the admin. Null when it was. */
  error: string | null;
};

// The subset of `GET /teamclaude/quota` used here. Unknown fields are ignored so TeamClaude can
// grow the payload freely.
const bucket = z
  .object({ utilization: z.number(), resetAt: z.number().nullish(), source: z.string().nullish() })
  .nullish();
const quotaPayload = z.object({
  accounts: z.array(
    z.object({
      name: z.string(),
      type: z.string().nullish(),
      disabled: z.boolean().nullish(),
      status: z.string().nullish(),
      tier: z.object({ weight: z.number().nullish() }).nullish(),
      buckets: z.object({ fiveHour: bucket, weeklyShared: bucket, weeklyFable: bucket }),
    }),
  ),
});
type Bucket = z.infer<typeof bucket>;

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Third-party backend readings use their own units, so they never count as Claude capacity. */
function windowOf(b: Bucket): QuotaWindow | null {
  if (!b || b.source?.startsWith("backend")) return null;
  return { used: clamp(b.utilization), resetAt: b.resetAt == null ? null : new Date(b.resetAt) };
}

function planOf(type: string | null | undefined, weight: number | null | undefined): string | null {
  if (type === "apikey") return "API key";
  return weight === 20 ? "Max 20x" : weight === 5 ? "Max 5x" : weight === 1 ? "Pro" : null;
}

/** Tier-weighted average use across accounts, resetting when the soonest of them does. */
function combine(parts: { weight: number; window: QuotaWindow | null }[]): QuotaWindow | null {
  let capacity = 0;
  let used = 0;
  let resetAt: Date | null = null;
  for (const { weight, window } of parts) {
    if (!window) continue;
    capacity += weight;
    used += weight * window.used;
    if (window.resetAt && (!resetAt || window.resetAt < resetAt)) resetAt = window.resetAt;
  }
  return capacity === 0 ? null : { used: used / capacity, resetAt };
}

/**
 * Turns a `/teamclaude/quota` payload into per-account rows and pool totals.
 *
 * The totals are computed here rather than taken from TeamClaude's `aggregate`, which also counts
 * disabled accounts: capacity on an account that won't be routed to isn't capacity. Like
 * TeamClaude, accounts of unknown tier are left out of the totals, unless no account's tier is
 * known, in which case every account counts equally.
 */
export function parsePool(json: unknown, now = new Date()): PoolQuota {
  const { accounts: raw } = quotaPayload.parse(json);
  const accounts = raw.map((a) => {
    const fiveHour = windowOf(a.buckets.fiveHour);
    const weekly = windowOf(a.buckets.weeklyShared);
    const fable = a.buckets.weeklyFable?.source === "unified7dFable" ? windowOf(a.buckets.weeklyFable) : null;
    const spent = (fiveHour?.used ?? 0) >= 1 || (weekly?.used ?? 0) >= 1;
    const state: AccountState = a.disabled
      ? "disabled"
      : a.status === "error"
        ? "error"
        : a.status === "exhausted" || spent
          ? "exhausted"
          : a.status === "throttled"
            ? "throttled"
            : "available";
    const account: PoolAccount = { name: a.name, plan: planOf(a.type, a.tier?.weight), state, fiveHour, weekly, fable };
    return { account, weight: a.tier?.weight ?? null };
  });

  const serving = accounts.filter(({ account }) => account.state !== "disabled" && account.state !== "error");
  const anyKnown = serving.some((a) => a.weight !== null);
  const weighted = serving.flatMap(({ account, weight }) =>
    weight !== null ? [{ account, weight }] : anyKnown ? [] : [{ account, weight: 1 }],
  );

  return {
    source: "teamclaude",
    fiveHour: combine(weighted.map(({ account, weight }) => ({ weight, window: account.fiveHour }))),
    weekly: combine(weighted.map(({ account, weight }) => ({ weight, window: account.weekly }))),
    accounts: accounts.map((a) => a.account),
    updatedAt: now,
    error: null,
  };
}

/** The fallback: what the last proxied response's `anthropic-ratelimit-unified-*` headers said. */
function fromHeaders(error: string): PoolQuota {
  const row = db().select().from(upstreamQuota).where(eq(upstreamQuota.id, 1)).get();
  const window = (used: number | null, resetAt: Date | null) => (used === null ? null : { used: clamp(used), resetAt });
  return {
    source: row ? "headers" : "none",
    fiveHour: row ? window(row.fiveHourUtil, row.fiveHourReset) : null,
    weekly: row ? window(row.weeklyUtil, row.weeklyReset) : null,
    accounts: [],
    updatedAt: row?.updatedAt ?? null,
    error,
  };
}

async function readPool(): Promise<PoolQuota> {
  let res: Response;
  try {
    const { UPSTREAM_URL, UPSTREAM_API_KEY } = config();
    res = await fetch(`${UPSTREAM_URL}/teamclaude/quota`, {
      headers: { "x-api-key": UPSTREAM_API_KEY },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
  } catch {
    return fromHeaders("TeamClaude isn't reachable.");
  }
  if (res.status === 404) return fromHeaders("This TeamClaude has no quota endpoint. Update it to 1.1.25 or newer.");
  if (res.status === 401 || res.status === 403) return fromHeaders("TeamClaude rejected UPSTREAM_API_KEY.");
  if (!res.ok) return fromHeaders(`TeamClaude answered ${res.status}.`);
  try {
    return parsePool(await res.json());
  } catch {
    return fromHeaders("TeamClaude's quota response wasn't in the expected shape.");
  }
}

/**
 * Takes a TeamClaude account out of rotation, or puts it back, through its control endpoint
 * (`POST /teamclaude/disable`, TeamClaude 1.1.25+). TeamClaude writes its config file and reloads,
 * so the change outlives a restart. Throws with a message fit for the admin when it refuses.
 */
export async function setAccountPaused(name: string, paused: boolean): Promise<void> {
  const { UPSTREAM_URL, UPSTREAM_API_KEY } = config();
  let res: Response;
  try {
    res = await fetch(`${UPSTREAM_URL}/teamclaude/disable`, {
      method: "POST",
      headers: { "x-api-key": UPSTREAM_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ account: name, disabled: paused }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch {
    throw new Error("TeamClaude isn't reachable.");
  }
  if (res.ok) {
    // The next page view should show the change, not a 30-second-old reading.
    delete cache.__poolQuota;
    return;
  }
  if (res.status === 404) throw new Error("This TeamClaude can't pause accounts. Update it to 1.1.25 or newer.");
  if (res.status === 401) throw new Error("TeamClaude rejected UPSTREAM_API_KEY.");
  // TeamClaude's refusals (unknown account, a client key instead of proxy.apiKey) explain themselves.
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === "string" ? `TeamClaude: ${body.error}` : `TeamClaude answered ${res.status}.`);
}

const MCP_OFF =
  `TeamClaude doesn't allow deleting accounts yet. Add "mcp": "full" to the "proxy" section of ~/.config/teamclaude.json, then restart TeamClaude.`;

// The parts of a JSON-RPC reply to `tools/call` that matter here.
const toolReply = z.object({
  result: z.object({ isError: z.boolean().nullish(), content: z.array(z.object({ text: z.string().nullish() })).nullish() }).nullish(),
  error: z.object({ message: z.string() }).nullish(),
});

/**
 * Deletes a TeamClaude account, saved login included, through the `remove_account` tool of
 * TeamClaude's management endpoint. That endpoint is the only way TeamClaude offers, and it
 * answers only when `proxy.mcp` is "full". Throws with a message fit for the admin when it refuses.
 */
export async function removeAccount(name: string): Promise<void> {
  const { UPSTREAM_URL, UPSTREAM_API_KEY } = config();
  let res: Response;
  try {
    res = await fetch(`${UPSTREAM_URL}/teamclaude/mcp`, {
      method: "POST",
      headers: { "x-api-key": UPSTREAM_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "remove_account", arguments: { account: name } },
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("TeamClaude isn't reachable.");
  }
  // 404: the endpoint is off, or this TeamClaude predates it.
  if (res.status === 404) throw new Error(MCP_OFF);
  if (res.status === 401 || res.status === 403) throw new Error("TeamClaude rejected UPSTREAM_API_KEY.");
  const reply = toolReply.safeParse(await res.json().catch(() => null));
  if (!res.ok || !reply.success) throw new Error(`TeamClaude answered ${res.status}.`);
  const { result, error } = reply.data;
  // In "read" mode the write tools aren't listed, so the call fails as an unknown tool.
  if (error) throw new Error(error.message.startsWith("Unknown tool") ? MCP_OFF : `TeamClaude: ${error.message}`);
  if (result?.isError) throw new Error(`TeamClaude: ${result.content?.[0]?.text ?? "the account wasn't deleted."}`);
  delete cache.__poolQuota;
}

const CACHE_MS = 30_000;
// Shared by the admin and the public page, so page views never fan out into TeamClaude calls.
const cache = globalThis as unknown as { __poolQuota?: { at: number; value: Promise<PoolQuota> } };

/**
 * Subscription capacity for the admin and status pages: TeamClaude's per-account view, or the
 * last response headers when that endpoint is unavailable. Cached for 30 seconds.
 */
export function poolQuota(now = Date.now()): Promise<PoolQuota> {
  const hit = cache.__poolQuota;
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = readPool();
  cache.__poolQuota = { at: now, value };
  return value;
}
