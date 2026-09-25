# Contributing to DeviceGate

Thanks for helping out! Bug reports, docs fixes and pull requests are all welcome. For anything
bigger than a small fix, please open an issue first so we can agree on the approach before you
spend time on it.

## Development setup

You need Node.js ≥ 20.9 and [Bun](https://bun.sh).

```sh
git clone https://github.com/jkugsiya/DeviceGate.git
cd DeviceGate
bun install
cp .env.example .env.local
```

For admin UI work you don't need a real upstream. Fill `.env.local` with:

```sh
UPSTREAM_API_KEY=dev                          # any non-empty value
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
ADMIN_TRUSTED_ORIGINS=http://localhost:3000
```

To test the proxy end to end, run [TeamClaude](https://github.com/KarpelesLab/teamclaude) and use
`bun run init-env` instead (see the README).

```sh
bun run admin create you@example.com "Dev"    # admin login
bun run dev                                   # http://localhost:3000/admin
```

Point a Claude Code session at your dev gateway with a device from the admin, or set
`ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` by hand for one shell.

## Checks

CI runs these on every pull request, so please run them first:

```sh
bun run lint
bun run typecheck
bun run test
```

## Project layout

```text
app/v1/**              proxy routes Claude Code talks to (the hot path)
app/admin/**           admin UI: server components for reads, server actions for writes
app/enroll, setup.*    device enrollment endpoint and setup scripts
lib/proxy/             forwarding, SSE usage capture, beta headers, error shape
lib/policy/            decide() (pure), in-memory counters, quota windows
lib/db/                Drizzle schema and client; migrations live in drizzle/
lib/timezone.ts        DST-aware day/week maths for the configured TIMEZONE
scripts/               CLI: admin, device, init-env, recompute-costs
spike/                 standalone scripts for checking what Claude Code sends
test/                  Vitest
```

[docs/architecture.md](docs/architecture.md) explains the design and the reasoning behind it.

## Conventions

- **Keep it small.** DeviceGate is a single-owner tool: one process, one SQLite file. Features that
  imply several users sharing a subscription (roles, per-user billing, org quotas) are out of scope.
  See [Terms of use](README.md#terms-of-use).
- **Every admin mutation is audited in the same transaction.** Follow the existing pattern in
  `app/admin/(panel)/actions.ts` and `lib/devices.ts`: `requireAdmin()`, then Zod parse, then one
  transaction with the change and its `audit()` row.
- **Never log or store secrets or bodies.** No prompts, responses, tokens, setup codes or OAuth
  material in logs, the database or audit diffs.
- **The proxy path is hot.** Don't put I/O or work in `app/v1/**` that doesn't need to be there, and
  never let Next.js middleware (`proxy.ts`) match `/v1`.
- **Schema changes need a migration.** Edit `lib/db/schema.ts`, then run `bun run db:generate` and
  commit the generated files in `drizzle/`. Migrations run automatically on startup.
- **Tests should be focused.** Cover behaviour that can break (policy decisions, windows, parsing,
  queries), not snapshots of markup.
- This project uses a recent Next.js with breaking changes from older versions. Check
  `node_modules/next/dist/docs/` before relying on memory of older APIs.

## When Claude Code updates

DeviceGate depends on what Claude Code sends in token mode. If a release breaks requests, the
[Protocol notes](docs/architecture.md#protocol-notes) explain how to capture and compare the
headers with `spike/capture.ts`. An issue with the Claude Code version and what changed is very
helpful even without a fix.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
