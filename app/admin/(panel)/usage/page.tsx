import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber, fmtTokens, fmtUsd } from "@/lib/format";
import { TIME_ZONE } from "@/lib/timezone";
import {
  type BreakdownSort,
  dailySeries,
  deviceOptions,
  listRequests,
  modelOptions,
  type Outcome,
  OUTCOMES,
  type RequestSort,
  REQUEST_SORTS,
  resolveRange,
  type UsageFilters,
  usageByDevice,
  usageByModel,
  usageSummary,
} from "@/lib/usage-queries";
import { FilterBar } from "../../_components/filter-bar";
import { Pager } from "../../_components/pager";
import { one, type Params } from "../../_components/query";
import type { SortDir } from "../../_components/sortable";
import { StatCard } from "../../_components/stats";
import { UsageChart } from "../../_components/usage-chart";
import { ModelShare } from "../../_components/model-share";
import { BreakdownTable, RequestsTable } from "../../_components/usage-tables";

/** Reads the filter half of the query string. Anything unrecognised falls back to a safe default. */
export function readFilters(params: Params): { filters: UsageFilters; range: ReturnType<typeof resolveRange> } {
  const range = resolveRange({ range: one(params, "range"), from: one(params, "from"), to: one(params, "to") });
  const outcome = one(params, "outcome");
  return {
    range,
    filters: {
      from: range.from,
      to: range.to,
      deviceId: one(params, "device") || undefined,
      model: one(params, "model") || undefined,
      outcome: (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as Outcome) : undefined,
      q: one(params, "q") || undefined,
    },
  };
}

/** Each table owns its own pair of params so sorting one never reorders another. */
export function readSort(params: Params, key = "sort", dirKey = "dir"): { sort: string; dir: SortDir } {
  return { sort: one(params, key), dir: one(params, dirKey) === "asc" ? "asc" : "desc" };
}

export function groupSortOf(sort: string): BreakdownSort {
  return sort === "name" || sort === "requests" || sort === "tokens" ? sort : "cost";
}

export default async function UsagePage({ searchParams }: PageProps<"/admin/usage">) {
  const params = await searchParams;
  const { filters, range } = readFilters(params);
  const { sort, dir } = readSort(params);
  const models = readSort(params, "msort", "mdir");
  const devices = readSort(params, "dsort", "ddir");

  const summary = usageSummary(filters);
  const series = dailySeries(filters);
  const requestSort = (REQUEST_SORTS as readonly string[]).includes(sort) ? (sort as RequestSort) : "time";
  const page = Number(one(params, "page")) || 1;
  const log = listRequests(filters, requestSort, dir, page);
  const byModel = usageByModel(filters, groupSortOf(models.sort), models.dir);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Every request the gateway has served, by date, device and model. Costs are Anthropic&apos;s public API rates
          for the same tokens — your subscription covers the traffic.
        </p>
      </div>

      <Suspense>
        <FilterBar
          range={range.range}
          fromKey={range.fromKey}
          devices={deviceOptions()}
          models={modelOptions()}
        />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Spend"
          value={fmtUsd(summary.cost)}
          sub={summary.unpriced > 0 ? `${fmtNumber(summary.unpriced)} requests unpriced` : "All requests priced"}
        />
        <StatCard
          label="Requests"
          value={fmtNumber(summary.requests)}
          sub={summary.blocked > 0 ? `${fmtNumber(summary.blocked)} blocked by policy` : "None blocked"}
        />
        <StatCard
          label="Tokens"
          value={fmtTokens(summary.tokens)}
          sub={`plus ${fmtTokens(summary.cacheRead)} cache reads`}
        />
        <StatCard
          label="Avg latency"
          value={summary.avgLatencyMs === null ? "—" : `${(summary.avgLatencyMs / 1000).toFixed(1)}s`}
          sub="Excludes blocked requests"
          muted={summary.avgLatencyMs === null}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spend per day</CardTitle>
          <CardDescription>
            {range.fromKey && range.toKey ? `${range.fromKey} to ${range.toKey}, ${TIME_ZONE}` : `All recorded traffic, by day (${TIME_ZONE})`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsageChart data={series} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">By model</h2>
          <p className="text-sm text-muted-foreground">Open a model to see which devices used it.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Share of spend</CardTitle>
            <CardDescription>How this range&apos;s cost splits across models</CardDescription>
          </CardHeader>
          <CardContent>
            <ModelShare rows={byModel} metric="cost" />
          </CardContent>
        </Card>
        <BreakdownTable
          rows={byModel}
          caption="Model"
          sort={models.sort || "cost"}
          dir={models.dir}
          sortParam="msort"
          dirParam="mdir"
          pathname="/admin/usage"
          params={params}
          hrefFor={(r) => `/admin/usage/models/${encodeURIComponent(r.key)}`}
          linkLabel="Open"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">By device</h2>
        <BreakdownTable
          rows={usageByDevice(filters, groupSortOf(devices.sort), devices.dir)}
          caption="Device"
          sort={devices.sort || "cost"}
          dir={devices.dir}
          sortParam="dsort"
          dirParam="ddir"
          pathname="/admin/usage"
          params={params}
          hrefFor={(r) => `/admin/devices/${r.key}`}
          linkLabel="Open"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Requests</h2>
        {log.total === 0 ? (
          <p className="text-sm text-muted-foreground">No requests match these filters.</p>
        ) : (
          <>
            <RequestsTable rows={log.rows} sort={requestSort} dir={dir} pathname="/admin/usage" params={params} />
            <Pager page={log.page} pages={log.pages} total={log.total} pathname="/admin/usage" params={params} />
          </>
        )}
      </section>
    </div>
  );
}
