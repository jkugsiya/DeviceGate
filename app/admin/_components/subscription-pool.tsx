import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAgo, fmtIn } from "@/lib/format";
import type { AccountState, PoolQuota, QuotaWindow } from "@/lib/pool-quota";
import { AccountPauseToggle } from "./forms";

function QuotaBar({ label, window }: { label: string; window: QuotaWindow | null }) {
  const pct = window === null ? null : Math.round(window.used * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <Progress value={pct ?? 0} />
      <p className="text-xs text-muted-foreground">Resets {fmtIn(window?.resetAt)}</p>
    </div>
  );
}

/** A compact used-% cell for the account table. */
function WindowCell({ window }: { window: QuotaWindow | null }) {
  if (!window) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(window.used * 100);
  return (
    <div className="min-w-28 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono tabular-nums">{pct}%</span>
        <span className="text-xs text-muted-foreground">{fmtIn(window.resetAt)}</span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

const STATE_LABEL: Record<AccountState, string> = {
  available: "Available",
  throttled: "Rate limited",
  exhausted: "Limit reached",
  disabled: "Paused",
  error: "Error",
};

function StateBadge({ state }: { state: AccountState }) {
  if (state === "available") {
    return (
      <Badge variant="secondary">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        {STATE_LABEL[state]}
      </Badge>
    );
  }
  return <Badge variant={state === "exhausted" || state === "error" ? "destructive" : "outline"}>{STATE_LABEL[state]}</Badge>;
}

function describe(pool: PoolQuota): string {
  if (pool.source === "teamclaude") {
    const enabled = pool.accounts.filter((a) => a.state !== "disabled");
    const ready = enabled.filter((a) => a.state === "available" || a.state === "throttled").length;
    const paused = pool.accounts.length - enabled.length;
    return [
      `${enabled.length} ${enabled.length === 1 ? "account" : "accounts"} in rotation`,
      `${ready} with capacity left`,
      paused > 0 && `${paused} paused`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (pool.source === "headers") return `From the last response · updated ${fmtAgo(pool.updatedAt)}`;
  return "No requests seen yet";
}

/**
 * The overview's subscription card: pool totals, then one row per TeamClaude account. When the
 * quota endpoint is unavailable it falls back to the last response headers and says why.
 */
export function SubscriptionPool({ pool }: { pool: PoolQuota }) {
  const many = pool.accounts.length > 1;
  const showFable = pool.accounts.some((a) => a.fable);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{many ? "Claude accounts" : "Claude subscription"}</CardTitle>
        <CardDescription>
          {describe(pool)}
          {pool.error && <span className="block text-destructive">{pool.error}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <QuotaBar label={many ? "5-hour window, all accounts" : "5-hour window"} window={pool.fiveHour} />
          <QuotaBar label={many ? "Weekly, all accounts" : "Weekly"} window={pool.weekly} />
        </div>
        {pool.accounts.length > 0 && (
          <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>5-hour</TableHead>
                  <TableHead>Weekly</TableHead>
                  {showFable && <TableHead>Fable weekly</TableHead>}
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pool.accounts.map((a, i) => (
                  // Names are unique within TeamClaude, but the index keeps React safe if not.
                  <TableRow key={`${a.name}-${i}`}>
                    <TableCell>
                      <div className="max-w-56 truncate font-medium">{a.name}</div>
                      {a.plan && <p className="text-xs text-muted-foreground">{a.plan}</p>}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={a.state} />
                    </TableCell>
                    <TableCell>
                      <WindowCell window={a.fiveHour} />
                    </TableCell>
                    <TableCell>
                      <WindowCell window={a.weekly} />
                    </TableCell>
                    {showFable && (
                      <TableCell>
                        <WindowCell window={a.fable} />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <AccountPauseToggle name={a.name} paused={a.state === "disabled"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
