# Security policy

DeviceGate sits in front of a Claude subscription credential, so security reports are taken
seriously.

## Reporting a vulnerability

Please **don't open a public issue.** Report privately through
[GitHub security advisories](https://github.com/jkugsiya/DeviceGate/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. You should get
a reply within a week. Fixes are released as soon as practical, with credit to you unless you'd
rather stay anonymous.

## Supported versions

Only the latest release on `main` gets security fixes.

## Scope

In scope, for example:

- Using the proxy without a valid device token, or with a revoked token or disabled device
- Getting around a device's model allow-list or limits
- Reaching the admin UI or server actions without a valid admin session
- Leaking device tokens, setup codes, the TeamClaude key or OAuth material through logs, the database,
  audit diffs, error messages or the public page
- Brute-forcing setup codes despite the attempt limits

Out of scope:

- Deployments that expose the gateway to the internet against the README's guidance
- Anyone on the LAN being able to see the public status page at `/` (documented behaviour)
- Vulnerabilities in TeamClaude, Claude Code or Anthropic's services. Please report those to their
  maintainers.

## Hardening checklist

- Keep port 3000 on your LAN only, and TeamClaude on `127.0.0.1`.
- Keep `.env.local` and `~/.config/teamclaude.json` at mode 600 and out of backups that aren't
  encrypted.
- Revoke a device (Disable, or Generate setup code to rotate its token) as soon as a machine is lost
  or retired.
