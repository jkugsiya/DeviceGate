import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber, fmtRate, fmtTokens, fmtUsd, modelLabel } from "@/lib/format";
import { ratesFor } from "@/lib/pricing";
import {
  dailySeries,
  deviceOptions,
  listRequests,
  modelOptions,
  type RequestSort,
  REQUEST_SORTS,
  usageByDevice,
  usageSummary,
} from "@/lib/usage-queries";
import { FilterBar } from "../../../../_components/filter-bar";
import { Pager } from "../../../../_components/pager";
import { one } from "../../../../_components/query";
import { StatCard } from "../../../../_components/stats";
import { UsageChart } from "../../../../_components/usage-chart";
import { BreakdownTable, RequestsTable } from "../../../../_components/usage-tables";
import { groupSortOf, readFilters, readSort } from "../../page";

export default async function ModelUsagePage({ params: routeParams, searchParams }: PageProps<"/admin/usage/models/[model]">) {
  const { model } = await routeParams;
  const params = await searchParams;
  const { filters: base, range } = readFilters(params);
  const { sort, dir } = readSort(params);
  const devices = readSort(params, "dsort", "ddir");
  // The route owns the model dimension; a stray ?model= must not be able to widen the page.
  const filters = { ...base, model };

  const summary = usageSummary(filters);
  const byDevice = usageByDevice(filters, groupSortOf(devices.sort), devices.dir);
  const requestSort = (REQUEST_SORTS as readonly string[]).includes(sort) ? (sort as RequestSort) : "time";
  const page = Number(one(params, "page")) || 1;
  const log = listRequests(filters, requestSort, dir, page);
  const rates = ratesFor(model);
  const pathname = `/admin/usage/models/${encodeURIComponent(model)}`;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/usage" className="text-sm text-muted-foreground hover:text-foreground">
            ← Usage
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{modelLabel(model)}</h1>
          <Badge variant="outline" className="font-mono">
            {model}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {rates ? (
            <>
              {fmtRate(rates.input)} in · {fmtRate(rates.output)} out · {fmtRate(rates.cacheWrite5m)} cache write ·{" "}
              {fmtRate(rates.cacheRead)} cache read, per million tokens.
            </>
          ) : (
            <>
              No published rate for this model, so its spend is missing from every total. Add it to{" "}
              <code>lib/pricing.ts</code>.
            </>
          )}
        </p>
      </div>

      <Suspense>
        <FilterBar
          range={range.range}
          fromKey={range.fromKey}
          devices={deviceOptions()}
          models={modelOptions()}
          lockedModel={model}
        />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Spend" value={fmtUsd(summary.cost)} sub={`across ${fmtNumber(byDevice.length)} device(s)`} />
        <StatCard
          label="Requests"
          value={fmtNumber(summary.requests)}
          sub={summary.blocked > 0 ? `${fmtNumber(summary.blocked)} blocked by policy` : "None blocked"}
        />
        <StatCard label="Tokens" value={fmtTokens(summary.tokens)} sub={`plus ${fmtTokens(summary.cacheRead)} cache reads`} />
        <StatCard
          label="Avg latency"
          value={summary.avgLatencyMs === null ? "—" : `${(summary.avgLatencyMs / 1000).toFixed(1)}s`}
          sub="Excludes blocked requests"
          muted={summary.avgLatencyMs === null}
        />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Who used it</h2>
          <p className="text-sm text-muted-foreground">Every device that sent this model a request, biggest spender first.</p>
        </div>
        {byDevice.length === 0 ? (
          <Card className="items-center gap-2 py-10 text-center">
            <p className="font-medium">No requests for this model</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Nothing in the selected range. Try widening the dates.
            </p>
            <Link href="/admin/usage?range=all" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Show all time
            </Link>
          </Card>
        ) : (
          <BreakdownTable
            rows={byDevice}
            caption="Device"
            sort={devices.sort || "cost"}
            dir={devices.dir}
            sortParam="dsort"
            dirParam="ddir"
            pathname={pathname}
            params={params}
            hrefFor={(r) => `/admin/devices/${r.key}`}
            linkLabel="Open"
          />
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Spend per day</CardTitle>
          <CardDescription>{modelLabel(model)} only</CardDescription>
        </CardHeader>
        <CardContent>
          <UsageChart data={dailySeries(filters)} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Requests</h2>
        {log.total === 0 ? (
          <p className="text-sm text-muted-foreground">No requests match these filters.</p>
        ) : (
          <>
            <RequestsTable rows={log.rows} sort={requestSort} dir={dir} pathname={pathname} params={params} />
            <Pager page={log.page} pages={log.pages} total={log.total} pathname={pathname} params={params} />
          </>
        )}
      </section>
    </div>
  );
}
