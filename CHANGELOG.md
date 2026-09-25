# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First public release.

### Added

- Streaming proxy for Claude Code in front of TeamClaude, with per-device tokens and the
  subscription beta headers restored.
- One-time setup codes and setup scripts for macOS, Linux and Windows.
- Per-device model allow-lists, daily and weekly request and token quotas, requests-per-minute and
  concurrency limits.
- Usage explorer with per-device, per-model and per-day breakdowns, and API-equivalent cost tracking.
- Subscription 5-hour and weekly capacity read from upstream response headers.
- Admin UI with an audit log of every change and sign-in attempt.
- Public status page with remaining capacity, all-time and today totals, a usage-over-time chart
  (1D / 7D / 30D / 90D / All) and device rankings.
- Configurable `TIMEZONE` for quota windows, with DST handled.
