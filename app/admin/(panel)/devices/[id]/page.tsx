import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deviceDetail } from "@/lib/admin-queries";
import { publicBaseUrl } from "@/lib/config";
import { fmtAgo, fmtDateTime, fmtNumber, fmtTokens, fmtUsd, modelLabel } from "@/lib/format";
import { TIME_ZONE, zoneLabel } from "@/lib/timezone";
import { dailySeries, usageByModel } from "@/lib/usage-queries";
import { ConnectDevice, DetailsForm, DeviceControls, PolicyForm } from "../../../_components/forms";
import { one } from "../../../_components/query";
import { StatCard } from "../../../_components/stats";
import { UsageChart } from "../../../_components/usage-chart";
import { BreakdownTable } from "../../../_components/usage-tables";

/** Usage against its limit, with a bar once a limit exists to measure against. */
function UsageStat({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null | undefined;
  unit: "tokens" | "requests";
}) {
  const show = unit === "tokens" ? fmtTokens : fmtNumber;
  const pct = limit == null || limit === 0 ? null : Math.min(100, (used / limit) * 100);
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-sm tabular-nums">
        {show(used)}
        <span className="text-muted-foreground"> / {limit == null ? "∞" : show(limit)}</span>
      </p>
      {pct !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={pct >= 90 ? "h-full bg-destructive" : "h-full bg-foreground/70"}
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default async function DevicePage({ params, searchParams }: PageProps<"/admin/devices/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = deviceDetail(id);
  if (!detail) notFound();
  const { device, policy, allowedModelIds, registry, activeToken, recent, usage, weekStart } = detail;
  const scope = { from: weekStart, to: null, deviceId: id };
  const msort = one(sp, "msort");
  const byModel = usageByModel(
    scope,
    msort === "requests" || msort === "tokens" || msort === "name" ? msort : "cost",
    one(sp, "mdir") === "asc" ? "asc" : "desc",
  );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{device.name}</h1>
          <Badge variant={device.status === "enabled" ? "secondary" : "destructive"}>
            {device.status === "enabled" ? "Active" : "Disabled"}
          </Badge>
          {!activeToken && <Badge variant="outline">Waiting for setup</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Last seen {fmtAgo(device.lastSeenAt)}
          {device.lastIp && ` from ${device.lastIp}`} · added {fmtDateTime(device.createdAt)}
          {activeToken ? ` · connected with token ${activeToken.prefix}…` : " · not connected to a PC yet"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Spend today" value={fmtUsd(usage.dayCost)} sub={`${usage.dayRequests} requests`} />
        <StatCard label="Spend this week" value={fmtUsd(usage.weekCost)} sub={`${usage.weekRequests} requests`} />
        <StatCard label="Tokens today" value={fmtTokens(usage.dayTokens)} sub={`${fmtTokens(usage.weekTokens)} this week`} />
        <StatCard
          label="Blocked today"
          value={fmtNumber(usage.dayBlocked)}
          sub={usage.dayBlocked > 0 ? "Hit a policy limit" : "Nothing refused"}
          muted={usage.dayBlocked === 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{activeToken ? "Reconnect or move to another PC" : "Connect a PC"}</CardTitle>
              <CardDescription>
                A one-time setup code saves the connection on the PC, so afterwards you just run <code>claude</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConnectDevice deviceId={device.id} connected={!!activeToken} baseUrl={publicBaseUrl()} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Access & limits</CardTitle>
              <CardDescription>Days start at midnight {TIME_ZONE} time; weeks start on Monday.</CardDescription>
            </CardHeader>
            <CardContent>
              <PolicyForm
                deviceId={device.id}
                models={registry.map((m) => ({ id: m.id, displayName: m.displayName, enabled: m.enabled, allowed: allowedModelIds.has(m.id) }))}
                limits={[
                  { name: "dailyTokens", label: "Tokens per day", value: policy?.dailyTokens ?? null, hint: "A fresh Claude Code session uses ~40–60K tokens on its first request." },
                  { name: "weeklyTokens", label: "Tokens per week", value: policy?.weeklyTokens ?? null },
                  { name: "dailyRequests", label: "Requests per day", value: policy?.dailyRequests ?? null },
                  { name: "weeklyRequests", label: "Requests per week", value: policy?.weeklyRequests ?? null },
                  { name: "requestsPerMinute", label: "Requests per minute", value: policy?.requestsPerMinute ?? null },
                  { name: "maxConcurrent", label: "Concurrent requests", value: policy?.maxConcurrent ?? null, hint: "Subagents run in parallel; keep this ≥ 3 for normal use." },
                ]}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Against its limits</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <UsageStat label="Tokens today" used={usage.dayTokens} limit={policy?.dailyTokens} unit="tokens" />
              <UsageStat label="Requests today" used={usage.dayRequests} limit={policy?.dailyRequests} unit="requests" />
              <UsageStat label="Tokens this week" used={usage.weekTokens} limit={policy?.weeklyTokens} unit="tokens" />
              <UsageStat label="Requests this week" used={usage.weekRequests} limit={policy?.weeklyRequests} unit="requests" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailsForm deviceId={device.id} name={device.name} notes={device.notes} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <DeviceControls deviceId={device.id} name={device.name} status={device.status} />
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Models this week</h2>
          <p className="text-sm text-muted-foreground">What this device spent its tokens on.</p>
        </div>
        <BreakdownTable
          rows={byModel}
          caption="Model"
          sort={msort || "cost"}
          dir={one(sp, "mdir") === "asc" ? "asc" : "desc"}
          sortParam="msort"
          dirParam="mdir"
          pathname={`/admin/devices/${id}`}
          params={sp}
          hrefFor={(r) => `/admin/usage/models/${encodeURIComponent(r.key)}`}
          linkLabel="Open"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Spend per day</CardTitle>
          <CardDescription>This device, over the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <UsageChart data={dailySeries({ from: weekStart - 23 * 86_400_000, to: null, deviceId: id })} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold">Recent requests</h2>
          <Link
            href={`/admin/usage?device=${encodeURIComponent(id)}&range=30d`}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Search and filter all requests →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time ({zoneLabel()})</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Cache write / read</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(r.ts)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.model ? modelLabel(r.model) : "—"}</TableCell>
                    <TableCell>
                      {r.errorType ? (
                        <Badge variant="destructive">{r.errorType}</Badge>
                      ) : (
                        <span className={r.statusCode >= 400 ? "text-destructive" : undefined}>
                          {r.statusCode}
                          {r.aborted && " (cancelled)"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmtNumber(r.inputTokens)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmtNumber(r.outputTokens)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {fmtTokens(r.cacheCreationTokens)}
                      {r.cacheCreation1hTokens > 0 && <span title="1-hour TTL, billed at 2x input"> ⏱</span>} /{" "}
                      {fmtTokens(r.cacheReadTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.errorType ? <span className="text-muted-foreground">—</span> : fmtUsd(r.costUsd)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{(r.latencyMs / 1000).toFixed(1)}s</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
