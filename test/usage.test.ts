import { describe, expect, it } from "vitest";
import { meterBody, type MeterResult } from "../lib/proxy/usage";

const enc = new TextEncoder();
const sse = (ev: object) => `event: ${(ev as { type: string }).type}\ndata: ${JSON.stringify(ev)}\n\n`;

const STREAM = [
  sse({ type: "message_start", message: { usage: { input_tokens: 12, cache_creation_input_tokens: 3000, cache_read_input_tokens: 45000, output_tokens: 1 } } }),
  sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
  sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
  sse({ type: "message_stop" }),
].join("");

/** Emits `text` in fixed-size chunks so frames straddle chunk boundaries. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, (i += size)));
    },
  });
}

async function drain(kind: "sse" | "json", body: ReadableStream<Uint8Array>) {
  const results: MeterResult[] = [];
  const out = await new Response(meterBody(body, kind, (r) => results.push(r))).text();
  return { out, results };
}

describe("meterBody", () => {
  it("passes SSE through byte-for-byte and extracts usage across chunk boundaries", async () => {
    const { out, results } = await drain("sse", chunked(STREAM, 7));
    expect(out).toBe(STREAM);
    expect(results).toEqual([
      { usage: { input: 12, output: 5, cacheCreation: 3000, cacheCreation1h: 0, cacheRead: 45000 }, aborted: false, error: undefined },
    ]);
  });

  it("keeps message_start usage when the stream has no message_delta", async () => {
    const { results } = await drain("sse", chunked(STREAM.split("event: message_delta")[0], 64));
    expect(results[0].usage).toMatchObject({ input: 12, output: 1 });
  });

  it("reads usage from a non-streaming JSON response", async () => {
    const json = JSON.stringify({ id: "m", usage: { input_tokens: 4, output_tokens: 9 } });
    const { out, results } = await drain("json", chunked(json, 5));
    expect(out).toBe(json);
    expect(results[0].usage).toMatchObject({ input: 4, output: 9 });
  });

  it("reports once, as aborted, when the client cancels mid-stream", async () => {
    const results: MeterResult[] = [];
    let upstreamCancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(STREAM.split("event: content_block_delta")[0]));
      },
      cancel() {
        upstreamCancelled = true;
      },
    });
    const reader = meterBody(upstream, "sse", (r) => results.push(r)).getReader();
    await reader.read();
    await reader.cancel("client went away");
    await reader.cancel("again").catch(() => {});

    expect(upstreamCancelled).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ aborted: true, usage: { input: 12, cacheCreation: 3000 } });
  });
});

describe("cache TTL breakdown", () => {
  it("splits 5-minute and 1-hour cache writes when the API reports them", async () => {
    const stream = sse({
      type: "message_start",
      message: {
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 5000,
          cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 2000 },
          output_tokens: 1,
        },
      },
    });
    const { results } = await drain("sse", chunked(stream, 11));
    expect(results[0].usage).toMatchObject({ cacheCreation: 5000, cacheCreation1h: 2000 });
  });

  it("treats every cache write as 5-minute when no breakdown is sent", async () => {
    const { results } = await drain("sse", chunked(STREAM, 64));
    expect(results[0].usage).toMatchObject({ cacheCreation: 3000, cacheCreation1h: 0 });
  });
});
