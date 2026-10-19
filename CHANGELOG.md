# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Subscription capacity for every Claude account TeamClaude holds, read from its
  `GET /teamclaude/quota` endpoint: plan, status, and 5-hour, weekly and Fable weekly use per
  account on the admin overview.
- Pool totals weighted by plan size on the admin overview and the status page.
- Per-account capacity on the status page: plan, status, and 5-hour, weekly and Fable weekly
  remaining for each account, so a PC hitting 429s can see whether the whole pool is out.
  Accounts are numbered ("Account 1", "Account 2"…), never named.
- Pause and Resume buttons for each account on the admin overview, through TeamClaude's
  `POST /teamclaude/disable`. Each change is recorded in the audit log.
- Delete button for each account on the admin overview, through the `remove_account` tool of
  TeamClaude's management endpoint. You type the account's name to confirm. TeamClaude only
  allows it with `"mcp": "full"` in the `proxy` section of `teamclaude.json`; the error says so.
- Default limits on a new **Limits** admin page. A device uses the default for every limit it
  leaves empty, and its own value replaces the default, higher or lower.
- README section on running several of your own Claude accounts through TeamClaude, and on
  `teamclaude probe` for keeping idle accounts' figures fresh.

### Changed

- The overview's device table sorts by this week's spend, highest first, instead of by name.
- Capacity figures no longer depend on recent traffic through DeviceGate. The response-header
  reading is kept only as a fallback when TeamClaude's quota endpoint is unavailable.

### Fixed

- Claude Haiku 5.5 is priced: $0.10 / $0.50 per million input / output tokens, or $0.50 / $2.50
  once the prompt passes 100K tokens. Its requests used to record no cost. The gateway prices
  them on its next start.
- The admin's enable/disable toasts for devices and models named the opposite of what had just
  happened.
- Sorting a table in the admin no longer scrolls the page back to the top.

## [0.1.0] - 2026-09-28

First public release.

### Added

- Streaming proxy for Claude Code in front of TeamClaude, with per-device tokens and the
  subscription beta headers restored.
- One-time setup codes and setup scripts for macOS, Linux and Windows.
- Per-device model allow-lists, daily and weekly request, token and spend (USD) quotas,
  requests-per-minute and concurrency limits.
- Usage explorer with per-device, per-model and per-day breakdowns, and API-equivalent cost tracking.
- Subscription 5-hour and weekly capacity read from upstream response headers.
- Admin UI with an audit log of every change and sign-in attempt.
- Public status page with remaining capacity, all-time and today totals, a usage-over-time chart
  (1D / 7D / 30D / 90D / All) and device rankings.
- Configurable `TIMEZONE` for quota windows, with DST handled.
- `Dockerfile` and `docker-compose.yml` for running the gateway in a container.
