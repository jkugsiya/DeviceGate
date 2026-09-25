// Phase 0 spike: Claude Code (gateway-token mode) → this passthrough → TeamClaude → Anthropic.
// Proves the full chain: device-token swap, beta-header restore, SSE streaming and usage capture.
// Usage: TEAMCLAUDE_KEY=tc-... bun spike/passthrough.ts
const PORT = Number(process.env.PORT ?? 8788);
const UPSTREAM = process.env.UPSTREAM ?? "http://127.0.0.1:3456";
const TEAMCLAUDE_KEY = process.env.TEAMCLAUDE_KEY ?? "";

// Claude Code only sends these betas in subscription mode; the OAuth upstream needs them.
const SUBSCRIPTION_BETAS = ["oauth-2025-04-20", "extended-cache-ttl-2025-04-11"];
const HOP_BY_HOP = ["host", "connection", "content-length", "authorization", "x-api-key", "accept-encoding"];

type Usage = { input: number; output: number; cacheCreation: number; cacheRead: number };

function mergeBetas(value: string | null): string {
  const set = new Set((value ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const b of SUBSCRIPTION_BETAS) set.add(b);
  return [...set].join(",");
}

function applyUsage(u: Usage, raw: any) {
  if (!raw) return;
  // message_start carries input/cache counts; message_delta carries cumulative output.
  if (raw.input_tokens != null) u.input = raw.input_tokens;
  if (raw.cache_creation_input_tokens != null) u.cacheCreation = raw.cache_creation_input_tokens;
  if (raw.cache_read_input_tokens != null) u.cacheRead = raw.cache_read_input_tokens;
  if (raw.output_tokens != null) u.output = raw.output_tokens;
}

// Parses SSE frames as they pass through without buffering the whole response.
function usageTap(onDone: (u: Usage) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const usage: Usage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  let buf = "";
  const scan = (final: boolean) => {
    const frames = buf.split("\n\n");
    buf = final ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const data = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!data) continue;
      try {
        const ev = JSON.parse(data.slice(5));
        if (ev.type === "message_start") applyUsage(usage, ev.message?.usage);
        else if (ev.type === "message_delta") applyUsage(usage, ev.usage);
      } catch {}
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buf += decoder.decode(chunk, { stream: true });
      scan(false);
    },
    flush() {
      scan(true);
      onDone(usage);
    },
  });
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0, // long-lived streams
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "HEAD" && url.pathname === "/api/hello") return new Response(null, { status: 200 });

    const headers = new Headers(req.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    headers.set("x-api-key", TEAMCLAUDE_KEY);
    if (url.pathname.startsWith("/v1/messages")) headers.set("anthropic-beta", mergeBetas(req.headers.get("anthropic-beta")));

    const started = performance.now();
    const res = await fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      signal: req.signal,
    });
    const quota = [...res.headers].filter(([k]) => k.startsWith("anthropic-ratelimit-unified")).map(([k, v]) => `${k.replace("anthropic-ratelimit-unified-", "")}=${v}`);
    console.log(`${req.method} ${url.pathname} → ${res.status} (${Math.round(performance.now() - started)}ms to headers) ${quota.join(" ")}`);

    const outHeaders = new Headers(res.headers);
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    const isSse = res.headers.get("content-type")?.includes("text/event-stream");
    const body = isSse && res.body ? res.body.pipeThrough(usageTap((u) => console.log(`  usage ${JSON.stringify(u)}`))) : res.body;
    return new Response(body, { status: res.status, headers: outHeaders });
  },
});
console.log(`passthrough on http://127.0.0.1:${PORT} → ${UPSTREAM}`);
