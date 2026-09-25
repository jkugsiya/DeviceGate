/** `cacheCreation` is every cache write; `cacheCreation1h` is the 1-hour-TTL part of it, priced higher. */
export type Usage = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheCreation1h: number;
  cacheRead: number;
};

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheCreation: 0, cacheCreation1h: 0, cacheRead: 0 });

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Merges an Anthropic `usage` object; later values win (message_delta output is cumulative). */
export function applyUsage(u: Usage, raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const r = raw as Record<string, unknown>;
  u.input = num(r.input_tokens) ?? u.input;
  u.output = num(r.output_tokens) ?? u.output;
  u.cacheCreation = num(r.cache_creation_input_tokens) ?? u.cacheCreation;
  u.cacheRead = num(r.cache_read_input_tokens) ?? u.cacheRead;
  // Optional TTL breakdown. Without it every write is 5-minute, which is what Claude Code
  // sends unless a request opts into the 1-hour cache.
  if (r.cache_creation && typeof r.cache_creation === "object") {
    const c = r.cache_creation as Record<string, unknown>;
    const m5 = num(c.ephemeral_5m_input_tokens);
    const h1 = num(c.ephemeral_1h_input_tokens);
    u.cacheCreation1h = h1 ?? u.cacheCreation1h;
    if (m5 !== undefined || h1 !== undefined) u.cacheCreation = (m5 ?? 0) + (h1 ?? 0);
  }
}

/** Tokens that count against quota. Cache reads are excluded; see docs/architecture.md, "Token accounting". */
export function quotaTokens(u: Usage): number {
  return u.input + u.cacheCreation + u.output;
}

// Non-stream bodies above this are passed through without usage parsing.
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export type MeterResult = { usage: Usage; aborted: boolean; error?: unknown };

/**
 * Wraps an upstream response body so bytes pass through untouched while usage is extracted:
 * SSE via message_start/message_delta frames, JSON via the top-level `usage`.
 * `onDone` fires exactly once — on completion, upstream error, or client cancel.
 */
export function meterBody(
  body: ReadableStream<Uint8Array>,
  kind: "sse" | "json" | "other",
  onDone: (r: MeterResult) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const usage = emptyUsage();
  let buf = "";
  let jsonBytes = 0;
  let finished = false;

  const finish = (aborted: boolean, error?: unknown) => {
    if (finished) return;
    finished = true;
    if (kind === "json" && !aborted && jsonBytes <= MAX_JSON_BYTES) {
      try {
        applyUsage(usage, JSON.parse(buf).usage);
      } catch {}
    }
    onDone({ usage, aborted, error });
  };

  const scanSse = (final: boolean) => {
    const frames = buf.split("\n\n");
    buf = final ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "message_start") applyUsage(usage, ev.message?.usage);
          else if (ev.type === "message_delta") applyUsage(usage, ev.usage);
        } catch {}
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (kind === "sse") {
            buf += decoder.decode();
            scanSse(true);
          }
          finish(false);
          controller.close();
          return;
        }
        if (kind === "sse") {
          buf += decoder.decode(value, { stream: true });
          scanSse(false);
        } else if (kind === "json") {
          jsonBytes += value.byteLength;
          if (jsonBytes <= MAX_JSON_BYTES) buf += decoder.decode(value, { stream: true });
        }
        controller.enqueue(value);
      } catch (err) {
        finish(true, err);
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish(true, reason);
      await reader.cancel(reason).catch(() => {});
    },
  });
}
