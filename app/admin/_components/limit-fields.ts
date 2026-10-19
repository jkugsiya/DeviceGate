import type { Limits } from "@/lib/policy/decide";
import type { LimitField } from "./forms";

const FIELDS: { name: keyof Limits; label: string; hint?: string; usd?: boolean }[] = [
  { name: "dailyTokens", label: "Tokens per day", hint: "A fresh Claude Code session uses ~40–60K tokens on its first request." },
  { name: "weeklyTokens", label: "Tokens per week" },
  { name: "dailyCostUsd", label: "Spend per day (USD)", usd: true, hint: "API-equivalent cost at Anthropic's public rates, as shown in usage." },
  { name: "weeklyCostUsd", label: "Spend per week (USD)", usd: true },
  { name: "dailyRequests", label: "Requests per day" },
  { name: "weeklyRequests", label: "Requests per week" },
  { name: "requestsPerMinute", label: "Requests per minute" },
  { name: "maxConcurrent", label: "Concurrent requests", hint: "Subagents run in parallel; keep this ≥ 3 for normal use." },
];

/**
 * The limit inputs for a form, filled from `values`. Pass `defaults` on a device's form so each
 * empty field shows the default it falls back to.
 */
export function limitFields(values: Partial<Limits> | null | undefined, defaults?: Limits): LimitField[] {
  return FIELDS.map((f) => ({ ...f, value: values?.[f.name] ?? null, fallback: defaults?.[f.name] }));
}
