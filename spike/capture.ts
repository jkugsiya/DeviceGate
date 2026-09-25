// Phase 0 spike: log exactly what Claude Code sends to a gateway, then fail fast.
// Credentials are never printed — only their kind and length.
// Usage: bun spike/capture.ts [port]
const port = Number(process.argv[2] ?? 8787);
const SECRET_HEADERS = new Set(["authorization", "x-api-key", "cookie", "proxy-authorization"]);

function describeSecret(value: string): string {
  const v = value.replace(/^Bearer\s+/i, "");
  const kind = v.startsWith("sk-ant-oat") ? "oauth-access" : v.startsWith("sk-ant-api") ? "api-key" : v.startsWith("oc_dev_") ? "gateway-device" : "other";
  return `<redacted ${kind}, len=${v.length}>`;
}

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = SECRET_HEADERS.has(k) ? describeSecret(v) : v));
    let body: unknown = null;
    const text = await req.text();
    if (text) {
      try {
        const j = JSON.parse(text);
        const system = Array.isArray(j.system) ? j.system.map((b: any) => String(b.text ?? "").slice(0, 70)) : String(j.system ?? "").slice(0, 70);
        body = { keys: Object.keys(j), model: j.model, max_tokens: j.max_tokens, stream: j.stream, metadata: j.metadata ? Object.keys(j.metadata) : undefined, system, bytes: text.length };
      } catch {
        body = { bytes: text.length };
      }
    }
    console.log(JSON.stringify({ method: req.method, path: url.pathname + url.search, headers, body }, null, 2));
    return Response.json(
      { type: "error", error: { type: "invalid_request_error", message: "capture spike: request logged" } },
      { status: 400 },
    );
  },
});
console.log(`capture listening on http://127.0.0.1:${port}`);
