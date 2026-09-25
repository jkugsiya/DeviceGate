import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateDevice, type AuthenticatedDevice } from "../auth/device-token";
import { config } from "../config";
import { db } from "../db/client";
import { devices, deviceTokens, usageEvents } from "../db/schema";
import { admit, countersFor, type Release } from "../policy/counters";
import { decide } from "../policy/decide";
import { loadDevicePolicy, resolveModel } from "../policy/load";
import { windowsAt } from "../policy/windows";
import { costOf } from "../pricing";
import { withSubscriptionBetas } from "./betas";
import { anthropicError } from "./errors";
import { recordUpstreamQuota } from "./upstream-quota";
import { emptyUsage, meterBody, quotaTokens, type Usage } from "./usage";

// Never forwarded upstream: device credentials, hop-by-hop, and client network identity.
const DROP_REQUEST_HEADERS = [
  "authorization",
  "x-api-key",
  "cookie",
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "transfer-encoding",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "via",
];
// fetch() already decoded the body, so upstream framing headers no longer apply.
const DROP_RESPONSE_HEADERS = ["content-encoding", "content-length", "transfer-encoding", "connection"];

const messageBody = z.looseObject({ model: z.string().min(1) });

export type Endpoint = "messages" | "count_tokens" | "models";

export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

/**
 * The gateway pipeline: authenticate the device, apply its policy, forward to TeamClaude with the
 * gateway's credential, stream the response back unchanged, and record usage when it ends.
 * Only /v1/messages consumes quota; count_tokens passes the model gate only.
 */
export async function proxyToUpstream(req: Request, endpoint: Endpoint): Promise<Response> {
  const started = Date.now();
  const auth = authenticateDevice(db(), req.headers);
  if (!auth.ok) {
    return auth.reason === "disabled"
      ? anthropicError(403, "permission_error", "DEVICE_DISABLED: this device has been disabled by the gateway admin.")
      : anthropicError(401, "authentication_error", "Invalid or missing gateway device token.");
  }
  const device = auth.device;
  const ip = clientIp(req.headers);
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.arrayBuffer() : undefined;

  let model: string | undefined;
  let release: Release | undefined;
  if (endpoint !== "models") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return anthropicError(400, "invalid_request_error", "Request body must be JSON.");
    }
    const result = messageBody.safeParse(parsed);
    if (!result.success) return anthropicError(400, "invalid_request_error", "Request body must include a model.");
    model = result.data.model;

    const now = Date.now();
    const policy = loadDevicePolicy(db(), device.deviceId);
    const counters = countersFor(db(), device.deviceId, now);
    const decision = decide({
      requestedModel: model,
      resolved: resolveModel(policy.registry, model),
      allowedModelIds: policy.allowedModelIds,
      limits: policy.limits,
      counters,
      windows: windowsAt(now),
      now,
      checkQuota: endpoint === "messages",
    });
    if (!decision.ok) {
      if (endpoint === "messages") {
        recordUsage(device, emptyUsage(), {
          endpoint,
          model,
          statusCode: decision.status,
          errorType: decision.code,
          started,
          ip,
        });
      }
      const headers = decision.retryAfterSec ? { "retry-after": String(decision.retryAfterSec) } : undefined;
      return anthropicError(decision.status, decision.errorType, decision.message, headers);
    }
    if (endpoint === "messages") release = admit(counters, now);
  }

  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST_HEADERS) headers.delete(h);
  headers.set("x-api-key", config().UPSTREAM_API_KEY);
  if (endpoint !== "models") headers.set("anthropic-beta", withSubscriptionBetas(req.headers.get("anthropic-beta")));

  let upstream: Response;
  try {
    upstream = await fetch(config().UPSTREAM_URL + url.pathname + url.search, {
      method: req.method,
      headers,
      body,
      signal: req.signal,
    });
  } catch (err) {
    release?.(0, Date.now(), { refund: true });
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[gateway] upstream unreachable:", err instanceof Error ? err.message : err);
    return anthropicError(502, "api_error", "Gateway could not reach the upstream proxy.");
  }

  recordUpstreamQuota(db(), upstream.headers);

  const outHeaders = new Headers(upstream.headers);
  for (const h of DROP_RESPONSE_HEADERS) outHeaders.delete(h);

  if (endpoint === "models") return filterModels(upstream, outHeaders, device.deviceId);
  if (endpoint !== "messages" || !upstream.body) {
    release?.(0, Date.now());
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const kind = contentType.includes("text/event-stream") ? "sse" : contentType.includes("json") ? "json" : "other";
  const requestId = upstream.headers.get("request-id") ?? undefined;

  const metered = meterBody(upstream.body, kind, (result) => {
    recordUsage(device, result.usage, {
      requestId,
      endpoint,
      model,
      statusCode: upstream.status,
      aborted: result.aborted,
      started,
      ip,
    });
    release?.(quotaTokens(result.usage), Date.now());
  });
  return new Response(metered, { status: upstream.status, headers: outHeaders });
}

/** Narrows the upstream model list to the families this device may use. */
async function filterModels(upstream: Response, headers: Headers, deviceId: string): Promise<Response> {
  const text = await upstream.text();
  if (!upstream.ok) return new Response(text, { status: upstream.status, headers });
  try {
    const json = JSON.parse(text) as { data?: { id: string }[] };
    const policy = loadDevicePolicy(db(), deviceId);
    json.data = (json.data ?? []).filter((m) => {
      const resolved = resolveModel(policy.registry, m.id);
      return resolved?.enabled && policy.allowedModelIds.has(resolved.id);
    });
    return Response.json(json, { status: upstream.status, headers });
  } catch {
    return new Response(text, { status: upstream.status, headers });
  }
}

type RecordMeta = {
  requestId?: string;
  endpoint: Endpoint;
  model: string | undefined;
  statusCode: number;
  errorType?: string;
  aborted?: boolean;
  started: number;
  ip: string | null;
};

function recordUsage(device: AuthenticatedDevice, usage: Usage, meta: RecordMeta) {
  const now = new Date();
  try {
    db().transaction((tx) => {
      tx.insert(usageEvents)
        .values({
          requestId: meta.requestId ?? randomUUID(),
          deviceId: device.deviceId,
          ts: now,
          endpoint: meta.endpoint,
          model: meta.model ?? null,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheCreationTokens: usage.cacheCreation,
          cacheCreation1hTokens: usage.cacheCreation1h,
          cacheReadTokens: usage.cacheRead,
          // Priced now rather than at read time so historical rows keep the rate that applied.
          // `bun run recompute-costs` re-prices everything after a price-table change.
          costUsd: costOf(meta.model, usage),
          statusCode: meta.statusCode,
          errorType: meta.errorType ?? null,
          aborted: meta.aborted ?? false,
          latencyMs: now.getTime() - meta.started,
          clientIp: meta.ip,
        })
        .run();
      tx.update(devices).set({ lastSeenAt: now, lastIp: meta.ip }).where(eq(devices.id, device.deviceId)).run();
      tx.update(deviceTokens).set({ lastUsedAt: now }).where(eq(deviceTokens.id, device.tokenId)).run();
    });
  } catch (err) {
    // Never let bookkeeping break a response that has already streamed.
    console.error("[gateway] failed to record usage:", err);
  }
}
