/**
 * API-equivalent pricing for Claude models.
 *
 * Traffic through this gateway runs on a Claude subscription, so its marginal cost is zero. These
 * figures are what the same tokens would have cost at Anthropic's public API rates — a way to
 * compare devices and spot runaway usage, not a bill.
 *
 * Rates are US$ per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing.
 * Only input and output are listed because Anthropic derives the cache rates from input: a
 * 5-minute cache write costs 1.25x input, a 1-hour write 2x, and a cache read 0.1x (Fable 5.1
 * reads are the one exception, at 0.025x). ccusage and tokscale pull the same numbers from
 * LiteLLM's price feed at runtime; a table of this size is not worth a network dependency.
 */

type Tier = { input: number; output: number };

type PriceEntry = {
  base: Tier;
  /** Rates for a prompt over 200K tokens. Absent when the model prices its whole window flat. */
  long?: Tier;
  /** Cache-read cost as a multiple of input. */
  cacheRead?: number;
};

// Keyed by model-id prefix; the longest match wins, so `claude-opus-4-1-20250805` prices as
// Opus 4.1 rather than Opus 4, and undated aliases like `claude-opus-5` work unchanged.
const PRICES: Record<string, PriceEntry> = {
  "claude-opus-5": { base: { input: 5, output: 25 } },
  "claude-opus-4-8": { base: { input: 5, output: 25 } },
  "claude-opus-4-7": { base: { input: 5, output: 25 } },
  "claude-opus-4-6": { base: { input: 5, output: 25 } },
  "claude-opus-4-5": { base: { input: 5, output: 25 } },
  "claude-opus-4-1": { base: { input: 15, output: 75 } },
  "claude-opus-4": { base: { input: 15, output: 75 } },
  "claude-sonnet-5": { base: { input: 2, output: 10 } },
  "claude-sonnet-4-6": { base: { input: 3, output: 15 } },
  "claude-sonnet-4-5": { base: { input: 3, output: 15 }, long: { input: 6, output: 22.5 } },
  "claude-sonnet-4": { base: { input: 3, output: 15 }, long: { input: 6, output: 22.5 } },
  "claude-haiku-4-5": { base: { input: 1, output: 5 } },
  "claude-haiku-3-5": { base: { input: 0.8, output: 4 } },
  "claude-fable-5-1": { base: { input: 10, output: 50 }, cacheRead: 0.025 },
  "claude-fable-5": { base: { input: 10, output: 50 } },
  "claude-mythos-5-1": { base: { input: 10, output: 50 }, cacheRead: 0.025 },
  "claude-mythos-5": { base: { input: 10, output: 50 } },
};

const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const CACHE_READ = 0.1;
const LONG_CONTEXT_TOKENS = 200_000;
const PER_MILLION = 1_000_000;

/** What one million tokens of each kind costs, in US$. */
export type Rates = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

/** Token counts for one request. `cacheCreation` is the total; `cacheCreation1h` is its 1-hour part. */
export type PricedUsage = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheCreation1h: number;
  cacheRead: number;
};

function entryFor(model: string): PriceEntry | null {
  let best: PriceEntry | null = null;
  let bestLen = 0;
  for (const [prefix, entry] of Object.entries(PRICES)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = entry;
      bestLen = prefix.length;
    }
  }
  return best;
}

function ratesFrom(tier: Tier, cacheRead: number): Rates {
  return {
    input: tier.input,
    output: tier.output,
    cacheWrite5m: tier.input * CACHE_WRITE_5M,
    cacheWrite1h: tier.input * CACHE_WRITE_1H,
    cacheRead: tier.input * cacheRead,
  };
}

/**
 * Rates that apply to a request, or null when the model isn't priced here. `promptTokens` picks
 * the long-context tier: Anthropic bills the whole request at the higher rate once the prompt
 * (input + cache reads + cache writes) passes 200K.
 */
export function ratesFor(model: string | null | undefined, promptTokens = 0): Rates | null {
  if (!model) return null;
  const entry = entryFor(model);
  if (!entry) return null;
  const tier = entry.long && promptTokens > LONG_CONTEXT_TOKENS ? entry.long : entry.base;
  return ratesFrom(tier, entry.cacheRead ?? CACHE_READ);
}

/** Per-token-kind cost in US$, so the UI can show where a device's spend actually goes. */
export type CostBreakdown = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
};

/** Cost of one request in US$, or null when the model has no published price here. */
export function costOf(model: string | null | undefined, u: PricedUsage): number | null {
  return breakdownOf(model, u)?.total ?? null;
}

export function breakdownOf(model: string | null | undefined, u: PricedUsage): CostBreakdown | null {
  const rates = ratesFor(model, u.input + u.cacheRead + u.cacheCreation);
  if (!rates) return null;
  // `input_tokens` from the API is already the uncached remainder, so the buckets never overlap.
  const write1h = Math.min(u.cacheCreation1h, u.cacheCreation);
  const write5m = u.cacheCreation - write1h;
  const cost = {
    input: (u.input * rates.input) / PER_MILLION,
    output: (u.output * rates.output) / PER_MILLION,
    cacheWrite: (write5m * rates.cacheWrite5m + write1h * rates.cacheWrite1h) / PER_MILLION,
    cacheRead: (u.cacheRead * rates.cacheRead) / PER_MILLION,
  };
  return { ...cost, total: cost.input + cost.output + cost.cacheWrite + cost.cacheRead };
}

/**
 * Rates for the newest priced version of a model family, given the registry's match prefix
 * (`claude-opus-`). Entries above are listed newest first, so the first match is the current one.
 */
export function familyRates(matchPrefix: string): Rates | null {
  const key = Object.keys(PRICES).find((k) => k.startsWith(matchPrefix));
  const entry = key ? PRICES[key] : null;
  return entry ? ratesFrom(entry.base, entry.cacheRead ?? CACHE_READ) : null;
}
