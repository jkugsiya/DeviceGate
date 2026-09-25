// Setup scripts served at /setup.sh and /setup.ps1. Each trades a one-time code for a device token
// and stores it, with the gateway URL, under "env" in ~/.claude/settings.json — which Claude Code
// reads on every start — so plain `claude` goes through the gateway from then on.

const shQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`;

export function setupShellScript(baseUrl: string): string {
  return `#!/bin/sh
# DeviceGate setup (macOS / Linux). Usage: curl -fsSL <gateway>/setup.sh | sh -s -- <SETUP-CODE>
set -eu
GATEWAY=${shQuote(baseUrl)}

CODE="\${1:-}"
if [ -z "$CODE" ]; then
  printf 'Setup code: ' >&2
  read -r CODE < /dev/tty
fi
CODE=$(printf '%s' "$CODE" | tr -cd 'A-Za-z0-9-')
HOST=$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9._-' || true)

RESP=$(curl -fsS -X POST "$GATEWAY/enroll" -H 'content-type: application/json' \\
  --data "{\\"code\\":\\"$CODE\\",\\"hostname\\":\\"$HOST\\"}") || {
  echo "Setup failed: the code is wrong, already used or expired. Generate a new one in the gateway admin." >&2
  exit 1
}
TOKEN=$(printf '%s' "$RESP" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')
NAME=$(printf '%s' "$RESP" | sed -n 's/.*"deviceName":"\\([^"]*\\)".*/\\1/p')
[ -n "$TOKEN" ] || { echo "Setup failed: unexpected response from the gateway." >&2; exit 1; }

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
[ -s "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak"
export GW_FILE="$SETTINGS" GW_URL="$GATEWAY" GW_TOKEN="$TOKEN"

# Merge into existing settings instead of overwriting them.
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs"), f = process.env.GW_FILE;
    let s = {};
    try { const t = fs.readFileSync(f, "utf8"); if (t.trim()) s = JSON.parse(t); } catch (e) { if (e.code !== "ENOENT") throw e; }
    s.env = Object.assign({}, s.env, { ANTHROPIC_BASE_URL: process.env.GW_URL, ANTHROPIC_AUTH_TOKEN: process.env.GW_TOKEN });
    fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\\n");'
elif [ "$(uname)" = "Darwin" ] && command -v plutil >/dev/null 2>&1; then
  [ -s "$SETTINGS" ] || printf '{}\\n' > "$SETTINGS"
  plutil -insert env -dictionary "$SETTINGS" 2>/dev/null || true
  plutil -replace env.ANTHROPIC_BASE_URL -string "$GW_URL" "$SETTINGS"
  plutil -replace env.ANTHROPIC_AUTH_TOKEN -string "$GW_TOKEN" "$SETTINGS"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c '
import json, os
f = os.environ["GW_FILE"]
try:
    with open(f) as h: t = h.read()
    s = json.loads(t) if t.strip() else {}
except FileNotFoundError:
    s = {}
s.setdefault("env", {}).update(ANTHROPIC_BASE_URL=os.environ["GW_URL"], ANTHROPIC_AUTH_TOKEN=os.environ["GW_TOKEN"])
with open(f, "w") as h: h.write(json.dumps(s, indent=2) + "\\n")'
elif [ ! -s "$SETTINGS" ]; then
  printf '{\\n  "env": {\\n    "ANTHROPIC_BASE_URL": "%s",\\n    "ANTHROPIC_AUTH_TOKEN": "%s"\\n  }\\n}\\n' "$GW_URL" "$GW_TOKEN" > "$SETTINGS"
else
  echo "Could not update $SETTINGS automatically (needs node, plutil or python3)." >&2
  echo "Add these under \\"env\\" in that file:" >&2
  echo "  \\"ANTHROPIC_BASE_URL\\": \\"$GW_URL\\"" >&2
  echo "  \\"ANTHROPIC_AUTH_TOKEN\\": \\"$GW_TOKEN\\"" >&2
  exit 1
fi
chmod 600 "$SETTINGS"

echo "Done: this PC is connected to the gateway as \\"$NAME\\"."
echo "Open a new terminal and run: claude"
`;
}

export function setupPowerShellScript(baseUrl: string): string {
  return `# DeviceGate setup (Windows).
# Usage: & ([scriptblock]::Create((irm <gateway>/setup.ps1))) <SETUP-CODE>
param([string]$Code)
$ErrorActionPreference = 'Stop'
$Gateway = ${psQuote(baseUrl)}

if (-not $Code) { $Code = Read-Host 'Setup code' }
$body = @{ code = $Code; hostname = $env:COMPUTERNAME } | ConvertTo-Json
try {
  $resp = Invoke-RestMethod -Method Post -Uri "$Gateway/enroll" -ContentType 'application/json' -Body $body
} catch {
  Write-Host 'Setup failed: the code is wrong, already used or expired. Generate a new one in the gateway admin.' -ForegroundColor Red
  return
}

$dir = Join-Path $HOME '.claude'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir 'settings.json'
$settings = $null
if (Test-Path $file) {
  Copy-Item $file "$file.bak" -Force
  $raw = Get-Content $file -Raw
  if ($raw -and $raw.Trim()) { $settings = $raw | ConvertFrom-Json }
}
if (-not $settings) { $settings = [pscustomobject]@{} }
if (-not $settings.PSObject.Properties['env']) {
  $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{})
}
$settings.env | Add-Member -NotePropertyName ANTHROPIC_BASE_URL -NotePropertyValue $resp.baseUrl -Force
$settings.env | Add-Member -NotePropertyName ANTHROPIC_AUTH_TOKEN -NotePropertyValue $resp.token -Force
# UTF-8 without BOM: a BOM would break JSON parsing in Claude Code.
[IO.File]::WriteAllText($file, ($settings | ConvertTo-Json -Depth 32), (New-Object Text.UTF8Encoding $false))

Write-Host "Done: this PC is connected to the gateway as ""$($resp.deviceName)""." -ForegroundColor Green
Write-Host 'Open a new terminal and run: claude'
`;
}
