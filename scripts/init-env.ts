// Writes .env.local for this machine: TeamClaude key, a fresh auth secret, the LAN URL and timezone.
// Usage: bun run init-env [lan-ip] [--force]
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const ipArg = args.find((a) => !a.startsWith("--"));
const envPath = join(process.cwd(), ".env.local");
const teamclaudeConfig = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "teamclaude.json");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** First private IPv4 on a physical-looking interface (skips Docker/VM bridges). */
function detectLanIp(): string | undefined {
  const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|utun|lo)/;
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (virtual.test(name)) continue;
    const ip = addrs?.find((a) => a.family === "IPv4" && !a.internal)?.address;
    if (ip && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return ip;
  }
}

if (existsSync(envPath) && !force) fail(".env.local already exists. Re-run with --force to replace it.");
if (!existsSync(teamclaudeConfig)) fail(`No TeamClaude config at ${teamclaudeConfig}. Run \`teamclaude login\` first.`);

const apiKey: unknown = JSON.parse(readFileSync(teamclaudeConfig, "utf8")).proxy?.apiKey;
if (typeof apiKey !== "string" || !apiKey) fail("TeamClaude has no proxy.apiKey yet. Start it once with `teamclaude server --headless`.");

const ip = ipArg ?? detectLanIp();
if (!ip) fail("Could not detect this machine's LAN IP. Pass it explicitly: bun run init-env 192.168.x.x");
const url = `http://${ip}:3000`;

writeFileSync(
  envPath,
  [
    "UPSTREAM_URL=http://127.0.0.1:3456",
    `UPSTREAM_API_KEY=${apiKey}`,
    "DATABASE_PATH=./data/gateway.db",
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
    `BETTER_AUTH_URL=${url}`,
    `ADMIN_TRUSTED_ORIGINS=${url},http://localhost:3000`,
    `TIMEZONE=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
chmodSync(envPath, 0o600);
console.log(`Wrote .env.local — gateway URL ${url}`);
