import Link from "next/link";
import { Suspense } from "react";
import { usageByModel } from "@/lib/usage-queries";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dashboardData } from "@/lib/admin-queries";
import { fmtAgo, fmtIn, fmtNumber, fmtTokens, fmtUsd } from "@/lib/format";
import { TIME_ZONE } from "@/lib/timezone";
import { Flash } from "../_components/flash";
import { one } from "../_components/query";
import { ModelShare } from "../_components/model-share";
import { SortableHead } from "../_components/sortable";
import { StatCard } from "../_components/stats";
import { BreakdownTable } from "../_components/usage-tables";

function QuotaBar({ label, util, reset }: { label: string; util: number | null; reset: Date | null }) {
  const pct = util === null ? null : Math.round(util * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <Progress value={pct ?? 0} />
      <p className="text-xs text-muted-foreground">Resets {fmtIn(reset)}</p>
    </div>
  );
}

function DeviceStatus({ status, connected }: { status: string; connected: boolean }) {
  if (status !== "enabled") return <Badge variant="destructive">Disabled</Badge>;
  if (!connected) return <Badge variant="outline">Waiting for setup</Badge>;
  return (
    <Badge variant="secondary">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
      Active
    </Badge>
  );
}

type DeviceRow = ReturnType<typeof dashboardData>["devices"][number];

/** Sorts the assembled device rows in JS — there are a handful of them, so SQL would be overkill. */
function sortDevices(rows: DeviceRow[], sort: string, dir: "asc" | "desc"): DeviceRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (d: DeviceRow) =>
    sort === "dayCost"
      ? d.usage.dayCost
      : sort === "weekCost"
        ? d.usage.weekCost
        : sort === "dayTokens"
          ? d.usage.dayTokens
          : sort === "lastSeen"
            ? (d.lastSeenAt?.getTime() ?? 0)
            : null;
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    if (x === null || y === null) return sign * a.name.localeCompare(b.name);
    return sign * (x - y);
  });
}

export default async function OverviewPage({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams;
  const { devices: allDevices, totals, upstream, windows } = dashboardData();
  const dir = one(params, "ddir") === "asc" ? "asc" : "desc";
  const sort = one(params, "dsort") || "name";
  const devices = sortDevices(allDevices, sort, sort === "name" ? (dir === "asc" ? "asc" : "desc") : dir);
  const byModel = usageByModel(
    { from: windows.weekStart, to: null },
    one(params, "msort") === "requests" || one(params, "msort") === "tokens" || one(params, "msort") === "name"
      ? (one(params, "msort") as "requests" | "tokens" | "name")
      : "cost",
    one(params, "mdir") === "asc" ? "asc" : "desc",
  );
  const active = devices.filter((d) => d.status === "enabled").length;
  const connected = devices.filter((d) => d.connected).length;
  const head = { sort, dir, pathname: "/admin", params, sortParam: "dsort", dirParam: "ddir" } as const;

  return (
    <div className="space-y-10">
      <Suspense>
        <Flash />
      </Suspense>

      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Overview</h1>
            <p className="text-sm text-muted-foreground">
              Days start at midnight {TIME_ZONE} time, weeks on Monday. Costs are what this traffic would have cost at Anthropic&apos;s
              API rates — your subscription already covers it.
            </p>
          </div>
          <Link href="/admin/devices/new" className={buttonVariants({ size: "lg" })}>
            Add device
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Spend today"
            value={fmtUsd(totals.dayCost)}
            sub={`${fmtUsd(totals.weekCost)} this week`}
          />
          <StatCard
            label="Tokens today"
            value={fmtTokens(totals.dayTokens)}
            sub={`${fmtTokens(totals.weekTokens)} this week`}
          />
          <StatCard
            label="Requests today"
            value={fmtNumber(totals.dayRequests)}
            sub={totals.dayBlocked > 0 ? `${fmtNumber(totals.dayBlocked)} blocked by policy` : "None blocked"}
          />
          <StatCard
            label="Devices"
            value={active}
            sub={`${devices.length - active > 0 ? `${devices.length - active} disabled · ` : ""}${connected} connected to a PC`}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Claude subscription</CardTitle>
            <CardDescription>
              {upstream
                ? `Status ${upstream.status ?? "unknown"} · updated ${fmtAgo(upstream.updatedAt)}`
                : "No requests seen yet"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <QuotaBar label="5-hour window" util={upstream?.fiveHourUtil ?? null} reset={upstream?.fiveHourReset ?? null} />
            <QuotaBar label="Weekly" util={upstream?.weeklyUtil ?? null} reset={upstream?.weeklyReset ?? null} />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Devices</h2>
        {devices.length === 0 ? (
          <Card className="items-center gap-2 py-10 text-center">
            <p className="font-medium">No devices yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add one to get a setup command for a PC. Each device gets its own token, limits and usage history.
            </p>
            <Link href="/admin/devices/new" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Add your first device
            </Link>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead column="name" {...head}>
                    Device
                  </SortableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Models</TableHead>
                  <SortableHead column="dayCost" align="right" {...head}>
                    Today
                  </SortableHead>
                  <SortableHead column="weekCost" align="right" {...head}>
                    This week
                  </SortableHead>
                  <SortableHead column="lastSeen" {...head}>
                    Last seen
                  </SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/admin/devices/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      {d.notes && <p className="max-w-48 truncate text-xs text-muted-foreground">{d.notes}</p>}
                    </TableCell>
                    <TableCell>
                      <DeviceStatus status={d.status} connected={d.connected} />
                    </TableCell>
                    <TableCell className="text-sm capitalize">{d.models.join(", ") || "none"}</TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono tabular-nums">{fmtUsd(d.usage.dayCost)}</div>
                      <p className="text-xs text-muted-foreground">
                        {fmtTokens(d.usage.dayTokens)} · {d.usage.dayRequests} req
                        {d.usage.dayBlocked > 0 && ` · ${d.usage.dayBlocked} blocked`}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono tabular-nums">{fmtUsd(d.usage.weekCost)}</div>
                      <p className="text-xs text-muted-foreground">
                        {fmtTokens(d.usage.weekTokens)} · {d.usage.weekRequests} req
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {fmtAgo(d.lastSeenAt)}
                      {d.lastIp && <p className="font-mono text-xs text-muted-foreground">{d.lastIp}</p>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Tokens are what quotas count: input + cache writes + output. Cache reads are billed too, so they show up in
          cost but not here.
        </p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Models this week</h2>
          <p className="text-sm text-muted-foreground">
            Across every device. Open one to see which devices used it.{" "}
            <Link href="/admin/usage" className="underline underline-offset-2 hover:text-foreground">
              Explore all usage →
            </Link>
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Share of spend</CardTitle>
            <CardDescription>How this week&apos;s cost splits across models</CardDescription>
          </CardHeader>
          <CardContent>
            <ModelShare rows={byModel} metric="cost" />
          </CardContent>
        </Card>
        <BreakdownTable
          rows={byModel}
          caption="Model"
          sort={one(params, "msort") || "cost"}
          dir={one(params, "mdir") === "asc" ? "asc" : "desc"}
          sortParam="msort"
          dirParam="mdir"
          pathname="/admin"
          params={params}
          hrefFor={(r) => `/admin/usage/models/${encodeURIComponent(r.key)}`}
          linkLabel="Open"
        />
      </section>
    </div>
  );
}
