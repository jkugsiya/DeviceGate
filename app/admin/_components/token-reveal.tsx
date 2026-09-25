"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={async () => {
            await navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs select-all">{text}</pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** How to connect a PC: install Claude Code, run the one-time setup command, then just use `claude`. */
export function SetupInstructions({ code, expiresAt, baseUrl }: { code: string; expiresAt: number; baseUrl: string }) {
  const expires = new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <ol className="space-y-6 text-sm">
      <Step n={1} title="Install Claude Code on that PC (skip if it's already installed)">
        <CopyBlock label="macOS / Linux" text="curl -fsSL https://claude.ai/install.sh | bash" />
        <CopyBlock label="Windows (PowerShell)" text="irm https://claude.ai/install.ps1 | iex" />
      </Step>
      <Step n={2} title="Connect it to the gateway — run once">
        <p className="text-muted-foreground">
          Setup code <span className="font-mono font-medium text-foreground">{code}</span> works once and expires at{" "}
          {expires}. The command saves the connection in <code>~/.claude/settings.json</code> (a backup of the old file is
          kept as <code>settings.json.bak</code>).
        </p>
        <CopyBlock label="macOS / Linux (Terminal)" text={`curl -fsSL ${baseUrl}/setup.sh | sh -s -- ${code}`} />
        <CopyBlock
          label="Windows (PowerShell)"
          text={`& ([scriptblock]::Create((irm ${baseUrl}/setup.ps1))) ${code}`}
        />
      </Step>
      <Step n={3} title="Use Claude Code as usual">
        <p className="text-muted-foreground">
          Open a new terminal and run <code className="text-foreground">claude</code>. No token or environment variables
          needed — it works the same in VS Code and JetBrains. Once it&apos;s used, this device shows a &quot;Last
          seen&quot; time here.
        </p>
      </Step>
    </ol>
  );
}

/** Manual alternative: a raw token to put in settings.json by hand. */
export function TokenReveal({ token, baseUrl }: { token: string; baseUrl: string }) {
  const settings = JSON.stringify({ env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: token } }, null, 2);
  return (
    <Alert>
      <AlertTitle>Copy this now — the token won&apos;t be shown again</AlertTitle>
      <AlertDescription className="mt-3 space-y-3">
        <p>
          Add the <code>env</code> entries below to <code>~/.claude/settings.json</code> on the PC (Windows:{" "}
          <code>%USERPROFILE%\.claude\settings.json</code>), keeping any other settings in that file. The previous token
          for this device has stopped working.
        </p>
        <CopyBlock label="~/.claude/settings.json" text={settings} />
      </AlertDescription>
    </Alert>
  );
}
