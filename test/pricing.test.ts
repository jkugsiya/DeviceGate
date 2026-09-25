import { describe, expect, it } from "vitest";
import { breakdownOf, costOf, ratesFor } from "../lib/pricing";

const usage = (u: Partial<Parameters<typeof costOf>[1]>) => ({
  input: 0,
  output: 0,
  cacheCreation: 0,
  cacheCreation1h: 0,
  cacheRead: 0,
  ...u,
});

describe("ratesFor", () => {
  it("derives cache rates from input: 1.25x for 5-minute writes, 2x for 1-hour, 0.1x for reads", () => {
    expect(ratesFor("claude-opus-5")).toEqual({ input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 });
  });

  it("matches the longest prefix, so a dated Opus 4.1 id does not price as Opus 4", () => {
    expect(ratesFor("claude-opus-4-1-20250805")?.input).toBe(15);
    expect(ratesFor("claude-opus-4-5-20251101")?.input).toBe(5);
  });

  it("prices Fable 5.1 cache reads at 0.025x input", () => {
    expect(ratesFor("claude-fable-5-1")?.cacheRead).toBe(0.25);
    expect(ratesFor("claude-fable-5")?.cacheRead).toBe(1);
  });

  it("moves Sonnet 4.5 to long-context rates above a 200K prompt, and leaves flat-priced models alone", () => {
    expect(ratesFor("claude-sonnet-4-5", 199_000)?.input).toBe(3);
    expect(ratesFor("claude-sonnet-4-5", 250_000)).toMatchObject({ input: 6, output: 22.5 });
    expect(ratesFor("claude-sonnet-4-5", 250_000)!.cacheRead).toBeCloseTo(0.6, 10);
    expect(ratesFor("claude-sonnet-5", 900_000)?.input).toBe(2);
  });

  it("returns null for a model with no published price", () => {
    expect(ratesFor("gpt-5")).toBeNull();
    expect(ratesFor(null)).toBeNull();
  });
});

describe("costOf", () => {
  it("prices each token kind at its own rate", () => {
    // 1M input ($5) + 1M output ($25) + 1M 5-minute cache writes ($6.25) + 1M cache reads ($0.50).
    const cost = costOf("claude-opus-5", usage({ input: 1e6, output: 1e6, cacheCreation: 1e6, cacheRead: 1e6 }));
    expect(cost).toBeCloseTo(36.75, 10);
  });

  it("charges the 1-hour part of a cache write at 2x input instead of 1.25x", () => {
    const all5m = costOf("claude-opus-5", usage({ cacheCreation: 1e6 }));
    const all1h = costOf("claude-opus-5", usage({ cacheCreation: 1e6, cacheCreation1h: 1e6 }));
    expect(all5m).toBeCloseTo(6.25, 10);
    expect(all1h).toBeCloseTo(10, 10);
  });

  it("never counts a 1-hour figure larger than the cache-write total", () => {
    expect(costOf("claude-opus-5", usage({ cacheCreation: 1e6, cacheCreation1h: 5e6 }))).toBeCloseTo(10, 10);
  });

  it("returns null for an unpriced model so it can be flagged rather than counted as free", () => {
    expect(costOf("gpt-5", usage({ input: 1e6 }))).toBeNull();
  });

  it("splits the total by token kind", () => {
    const b = breakdownOf("claude-haiku-4-5", usage({ input: 1e6, output: 1e6, cacheCreation: 1e6, cacheRead: 1e6 }));
    expect(b).toMatchObject({ input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 });
    expect(b!.total).toBeCloseTo(7.35, 10);
  });
});
