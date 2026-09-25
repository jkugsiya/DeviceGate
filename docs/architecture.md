# Architecture

How DeviceGate works inside, and why it's built this way. For setup and day-to-day use, see the
[README](../README.md).

## Overview

```text
 PC (desktop) ─┐   plain HTTP on the LAN, device token
 PC (laptop)  ─┼──────────────────────────────────────┐
 PC (...)     ─┘                                      ▼
                                   ┌──────────────────────────┐
                                   │  DeviceGate (Next.js)    │  0.0.0.0:3000
                                   │  device auth             │
                                   │  model gate              │
                                   │  quota / rate / conc.    │
                                   │  usage capture (SSE tee) │
                                   │  admin UI + audit        │
                                   └────────────┬─────────────┘
                                                │ x-api-key: <TeamClaude key>
                                                ▼
                                   ┌──────────────────────────┐
                                   │  TeamClaude              │  127.0.0.1:3456
                                   │  OAuth token + refresh   │
                                   │  upstream quota tracking │
                                   │  429 classification      │
                                   └────────────┬─────────────┘
                                                ▼
                                         api.anthropic.com
```

**DeviceGate sits in front of [TeamClaude](https://github.com/KarpelesLab/teamclaude) as a sidecar
rather than forking it.** TeamClaude already handles the fragile upstream work: OAuth login and
token refresh, parsing `anthropic-ratelimit-unified-*`, telling the two kinds of 429 apart, and
HTTP/1.1 connection pooling. DeviceGate owns only what TeamClaude doesn't have: per-device identity,
policy and audit. The upstream is a URL plus a key, so it could be swapped out without touching the
policy code.

TeamClaude binds to `127.0.0.1` only, with an `apiKey`, so DeviceGate is the only way in. The
subscription credential never leaves the gateway machine. Each PC only ever holds its own revocable
device token.

## Stack

| Concern | Choice | Why |
|---|---|---|
| App | **Next.js (App Router), one app, Node runtime** | Proxy route handlers (`app/v1/**/route.ts`) and admin UI in one process, so they share policy caches and counters |
| DB | **SQLite** (`better-sqlite3`) + Drizzle | One owner and a handful of PCs doesn't need a DB server. Drizzle makes a later move to Postgres cheap |
| Fast state | **In-process**, `globalThis` singletons (no Redis) | One gateway instance. Rebuilt from the DB on boot. Singletons survive dev HMR |
| Validation | Zod | Env, server action inputs, and the few `/v1/messages` body fields the gateway reads |
| Admin auth | Better Auth (email + password, sign-up disabled) | Sessions plus CSRF/origin checks. Admins are created from the CLI |
| Admin UI | Server components for reads, **server actions** for mutations, shadcn/ui | No separate admin REST API |

Next.js settings the proxy depends on:

- `compress: false`. Otherwise gzip would buffer the SSE stream.
- Proxy routes use the Node runtime and are always dynamic.
- `req.signal` is forwarded upstream, so pressing Esc in Claude Code cancels the upstream request
  and releases the concurrency slot.
- Route handlers have no request-body limit. Claude Code bodies run from about 100 KB to 1 MB.
- **Run a single `next start` process.** Counters live in memory: no cluster mode, no replicas.

## Data model

```text
devices              id, name, status(enabled|disabled), notes, created_at,
                     last_seen_at, last_ip, deleted_at
device_tokens        id, device_id, token_hash(sha256), token_prefix,
                     created_at, last_used_at, revoked_at
enrollment_codes     id, device_id, code_hash, expires_at, used_at, attempts
models               id ('opus'|'sonnet'|'haiku'|…), display_name,
                     match_prefix ('claude-opus-'), enabled
device_models        device_id, model_id                      -- allow-list
device_policies      device_id, default_model_id,
                     daily_requests, weekly_requests,
                     daily_tokens, weekly_tokens,
                     requests_per_minute,
                     max_concurrent                           -- NULL = unlimited
usage_events         id, request_id, device_id, ts, model, endpoint,
                     input_tokens, output_tokens,
                     cache_creation_tokens, cache_creation_1h_tokens,
                     cache_read_tokens, cost_usd,
                     status_code, error_type, aborted,
                     latency_ms, client_ip                    -- append-only, no prompts
upstream_quota       singleton: 5h / 7d utilization + reset, status, raw headers
audit_events         id, ts, admin_user_id, action, target_type, target_id,
                     before(json), after(json), ip, user_agent
(+ Better Auth tables: user, session, account, verification)
```

- `usage_events` doubles as the request log. Prompt and response bodies are **never** stored.
- `cost_usd` is the API-equivalent cost, priced at write time from `lib/pricing.ts`, so historical
  rows keep the rate that applied then. NULL means the model has no published price, and the admin
  UI flags it instead of counting it as free. `cache_creation_1h_tokens` is the part of a cache write
  that used a 1-hour TTL. Anthropic charges 2x input for it against 1.25x for the 5-minute default,
  so the two are tracked separately.
- Models match by prefix (`claude-opus-` → `opus`, longest prefix wins), so new model versions are
  gated with no code change. A model ID that matches no prefix is **denied**.
- Every audit row is written in the **same transaction** as the change it records.

## Device enrollment

1. In the admin, **Add device** creates the device, a default policy and a one-time **setup code**
   (e.g. `K7QM-2XPA`). The code is stored hashed, is single-use, expires after 15 minutes and allows
   at most 5 attempts.
2. On the PC:
   - macOS/Linux: `curl -fsSL <gateway>/setup.sh | sh -s -- <CODE>`
   - Windows: `& ([scriptblock]::Create((irm <gateway>/setup.ps1))) <CODE>`

   The script calls `POST /enroll { code, hostname }`. Failed attempts are rate limited per IP.
3. The server checks the code, marks it used, and returns a **device token** (`oc_dev_` + 32 random
   bytes, base64url) exactly once. Only its sha256 is stored.
4. The script merges into `~/.claude/settings.json` → `env` and sets the file to mode 600:
   - `ANTHROPIC_BASE_URL=<gateway URL>`
   - `ANTHROPIC_AUTH_TOKEN=oc_dev_…` (Claude Code sends it as `Authorization: Bearer`)
5. **Generate setup code** on an existing device revokes its token once the new code is used.
   **Disable** blocks the device immediately.

## Request pipeline (`POST /v1/messages`)

```text
[1] Auth         Bearer → sha256 → token lookup → device enabled, token not revoked   401/403
[2] Parse        read body; Zod-pick { model, stream }                               400
[3] Model gate   resolve model → registry → enabled && in device allow-list          403
[4] Quota        today/week requests & tokens (local-time windows) vs policy         429
[5] Rate         sliding-window requests/minute                                      429 + Retry-After
[6] Concurrency  per-device in-flight count                                          429 + Retry-After
[7] Forward      strip Authorization/x-api-key, add the TeamClaude key,
                 anthropic-beta += oauth-2025-04-20, extended-cache-ttl-2025-04-11
[8] Capture      tee the response: JSON usage, or SSE message_start + message_delta
[9] Persist      usage_event, bump counters, last_seen; upstream quota from headers
[10] Return      stream unchanged to the client
```

- Nothing is forwarded unless steps 1–6 pass.
- **Beta merge.** In `ANTHROPIC_AUTH_TOKEN` mode, Claude Code sends the same body and betas as in
  subscription mode, **except** `oauth-2025-04-20` and `extended-cache-ttl-2025-04-11`, and the OAuth
  upstream needs both. The list lives in `lib/proxy/betas.ts`. Re-check it when Claude Code
  updates (see [Protocol notes](#protocol-notes)).
- **No per-request `max_tokens` cap.** Claude Code sends `max_tokens: 128000` on every main-loop
  request, so a cap would break normal use. A single request can overshoot a quota, which is
  acceptable.
- Errors use Anthropic's error shape, `{ "type": "error", "error": { "type": …, "message": … } }`, so
  Claude Code shows a readable message. Codes: `MODEL_NOT_ALLOWED`, `QUOTA_EXCEEDED`,
  `RATE_LIMITED`, `CONCURRENCY_LIMIT`, `DEVICE_DISABLED`.
- A requested model is **never silently changed**.
- The decision is a pure function, `decide(device, policy, counters, request) → Allow | Deny`, in
  `lib/policy/decide.ts`. It does no I/O, which makes it easy to test.

Other routes:

- `POST /v1/messages/count_tokens`: steps 1–3 only. Doesn't count against quota.
- `GET /v1/models`: the upstream list, narrowed to the families this device may use.
- `HEAD /api/hello` and `/`: Claude Code's connectivity probes, answered locally with 200.
- Everything else under `/v1` returns 404. Only what Claude Code actually uses is proxied.

### Token accounting

- All four counters are stored: `input`, `output`, `cache_creation`, `cache_read`.
- **Quota tokens** = `input + cache_creation + output` (`lib/proxy/usage.ts`). Cache reads show in
  the UI but don't count toward quota. Otherwise long Claude Code sessions would burn quota almost
  entirely on cache reads.
- Quota is checked before the request, against usage so far, so one request can overshoot.
- Local token counts ≠ subscription consumption. The admin shows upstream 5-hour and weekly
  utilization (read from response headers) **separately** from local per-device usage.

### Counters and time windows

- On boot and at each day rollover, per-device day and week totals are summed from `usage_events`.
  After that they update in memory as each request completes, alongside the insert.
- Days start at local midnight and weeks on Monday, in the zone set by `TIMEZONE` (default: the
  server's). `lib/timezone.ts` handles DST: days are named by calendar keys and converted per zone,
  never by adding 24 hours.

## Admin

Every mutation is a **server action** with the same shape: `requireAdmin()` → Zod parse → one
transaction holding the change **and** its audit row → `revalidatePath`. Reads are server
components that query Drizzle directly.

Audit actions: `device.create`, `device.update`, `device.disable`, `device.enable`,
`device.rotate_token`, `device.delete`, `policy.update`, `model.update`, `enrollment.create`,
`enrollment.used`, `enrollment.failed`, `admin.create`, `admin.password_reset`, `admin.login` and
`admin.login_failed`. Each stores a before/after JSON
diff. Secrets are never included: no tokens, no codes, no OAuth material.

## Security model

- **LAN only, plain HTTP.** Port 3000 must not be reachable from the internet. For TLS or remote
  access, put a reverse proxy (Caddy, nginx) or a VPN such as Tailscale in front.
- TeamClaude binds to `127.0.0.1`. DeviceGate is its only client.
- Device tokens and setup codes are stored only as SHA-256 hashes.
- The OAuth credential never leaves the gateway machine. PCs hold only their own revocable token.
- No request or response bodies are logged, and `Authorization` is never logged.
- The public page at `/` selects only device names, token counts and costs
  (`lib/public-queries.ts`), so ids, IPs, notes and request logs can't leak onto it.

## Protocol notes

Findings from the spike scripts in `spike/`, verified against Claude Code 2.1.278:

- With `ANTHROPIC_AUTH_TOKEN` set, Claude Code sends the device token as `Authorization: Bearer`.
  The body, system prompt and model are identical to subscription mode. The only difference is the
  two missing betas above (`spike/capture.ts` shows this without printing credentials).
- `spike/passthrough.ts` swaps the token, restores the betas, streams SSE back and parses usage
  across chunk boundaries. It has been verified end to end against a real subscription through
  TeamClaude.
- The upstream `anthropic-ratelimit-unified-*` headers come back through TeamClaude, so the gateway
  reads subscription utilization from its own responses without polling.
- A fresh `claude -p` session writes about 41K `cache_creation` tokens on its first request. Keep
  that in mind when picking token quotas.

**When Claude Code updates**, run `bun spike/capture.ts` and point a Claude Code session at it
(`ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_AUTH_TOKEN=oc_dev_x claude -p hi`). Compare the
`anthropic-beta` header with subscription mode, and update `lib/proxy/betas.ts` if it changed.

## Out of scope

Roles, multiple organizations, org-wide quotas, temporary overrides, Redis, Postgres, account
rotation, prompt logging and SSO. DeviceGate is built for one owner and their own machines. See
[Terms of use](../README.md#terms-of-use).
