// Claude Code omits these betas when it authenticates with ANTHROPIC_AUTH_TOKEN
// (observed on 2.1.278, docs/architecture.md, "Protocol notes"); the OAuth upstream expects them.
// Re-check this list when Claude Code updates.
const SUBSCRIPTION_BETAS = ["oauth-2025-04-20", "extended-cache-ttl-2025-04-11"];

export function withSubscriptionBetas(value: string | null): string {
  const betas = new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const b of SUBSCRIPTION_BETAS) betas.add(b);
  return [...betas].join(",");
}
