import { z } from "zod";

const schema = z.object({
  // TeamClaude listener; must stay on loopback.
  UPSTREAM_URL: z.url().default("http://127.0.0.1:3456"),
  // TeamClaude proxy.apiKey — the only credential the gateway holds.
  UPSTREAM_API_KEY: z.string().min(1),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

/** URL devices use as ANTHROPIC_BASE_URL, shown in setup instructions. */
export function publicBaseUrl(): string {
  return process.env.GATEWAY_PUBLIC_URL ?? process.env.BETTER_AUTH_URL ?? "http://<gateway-host>:3000";
}

/** Validated env, parsed lazily so `next build` doesn't need runtime secrets. */
export function config(): Config {
  cached ??= schema.parse(process.env);
  return cached;
}
