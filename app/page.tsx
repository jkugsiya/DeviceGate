import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { fmtAgo, fmtIn, fmtTokens, fmtUsd } from "@/lib/format";
import {
  type Leaderboard,
  type LeaderRow,
  publicSnapshot,
  type Totals,
  type Trend,
  TREND_RANGES,
  type TrendRange,
  usageTotals,
  usageTrend,
} from "@/lib/public-queries";
import { HOUR_MS, TIME_ZONE, zoneLabel } from "@/lib/timezone";
import { type TrendDatum, type TrendMetric, UsageTrendChart } from "./_components/usage-trend-chart";

// Live figures on every view; nothing here is worth caching for.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DeviceGate",
  description: "Subscription capacity and per-device usage",
  robots: { index: false, follow: false },
};

/** How much of a window is left, as the headline with a bar under it. */
function Capacity({ label, remaining, reset }: { label: string; remaining: number | null; reset: Date | null }) {
  const pct = remaining === null ? null : Math.round(remaining * 100);
  const low = pct !== null && pct <= 15;
  const spent = pct === null ? 0 : 100 - pct;

  return (
    <div className="flex-1 space-y-3">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{label}</p>
      <p className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-6xl leading-none font-semibold tabular-nums",
            low && "text-destructive",
            pct === null && "text-muted-foreground",
          )}
        >
          {pct === null ? "—" : `${pct}%`}
        </span>
        <span className="text-lg text-muted-foreground">left</span>
      </p>
      {/* The bar fills with what has been used, so a full bar reads as "nearly out". */}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={pct ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} remaining`}
      >
        <div
          className={cn("h-full rounded-full transition-all", low ? "bg-destructive" : "bg-chart-1")}
          style={{ width: `${spent}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {/* Status is never colour alone: low capacity says so in words. */}
        {low && <span className="font-medium text-destructive">Running low · </span>}
        {reset ? `Resets ${fmtIn(reset)}` : "No usage recorded yet"}
      </p>
    </div>
  );
}

/** Tokens and cost for one span of time, side by side. */
function TotalsPanel({ label, totals, note }: { label: string; totals: Totals; note: string }) {
  return (
    <div className="flex-1 space-y-3">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{label}</p>
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        <div className="space-y-1.5">
          <dt className="sr-only">Tokens</dt>
          <dd className="font-mono text-4xl leading-none font-semibold tabular-nums">{fmtTokens(totals.tokens)}</dd>
          <dd className="text-sm text-muted-foreground">tokens</dd>
        </div>
        <div className="space-y-1.5">
          <dt className="sr-only">API-equivalent cost</dt>
          <dd className="font-mono text-4xl leading-none font-semibold tabular-nums">{fmtUsd(totals.cost)}</dd>
          <dd className="text-sm text-muted-foreground">API-equivalent</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{note}</p>
    </div>
  );
}

const DEFAULT_RANGE: TrendRange = "7d";
const DEFAULT_METRIC: TrendMetric = "tokens";

const RANGE_LABELS: Record<TrendRange, { short: string; caption: string }> = {
  "1d": { short: "1D", caption: "last 24 hours" },
  "7d": { short: "7D", caption: "last 7 days" },
  "30d": { short: "30D", caption: "last 30 days" },
  "90d": { short: "90D", caption: "last 90 days" },
  all: { short: "All", caption: "all time" },
};

const METRIC_LABELS: Record<TrendMetric, string> = { tokens: "Tokens", cost: "Cost" };

const dateFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, ...opts });
const fmtHour = dateFmt({ hour: "numeric" });
const fmtMonthDay = dateFmt({ month: "short", day: "numeric" });
const fmtFullDay = dateFmt({ weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtSince = dateFmt({ dateStyle: "medium" });

/** Axis and tooltip labels, formatted here so they follow the gateway's timezone, not the browser's. */
function chartData(trend: Trend): TrendDatum[] {
  return trend.points.map(({ start, tokens, cost }) =>
    trend.bucket === "hour"
      ? {
          tick: fmtHour.format(start),
          title: `${fmtMonthDay.format(start)}, ${fmtHour.format(start)} – ${fmtHour.format(start + HOUR_MS)}`,
          tokens,
          cost,
        }
      : { tick: fmtMonthDay.format(start), title: fmtFullDay.format(start), tokens, cost },
  );
}

/**
 * A row of links styled as a segmented control. Links rather than client state, so each view is a
 * plain URL and the page works without JavaScript.
 */
function Segmented<T extends string>({
  label,
  options,
  active,
  href,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  active: T;
  href: (value: T) => string;
}) {
  return (
    <nav className="flex items-center rounded-lg bg-muted p-0.5" aria-label={label}>
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
          replace
          scroll={false}
          aria-current={o.value === active ? "true" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            o.value === active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

function UsageTrend({ trend, range, metric }: { trend: Trend; range: TrendRange; metric: TrendMetric }) {
  const href = (next: { range?: TrendRange; metric?: TrendMetric }) => {
    const sp = new URLSearchParams();
    const r = next.range ?? range;
    const m = next.metric ?? metric;
    // Defaults stay out of the URL so the bare address is the canonical view.
    if (r !== DEFAULT_RANGE) sp.set("range", r);
    if (m !== DEFAULT_METRIC) sp.set("metric", m);
    const qs = sp.toString();
    return qs ? `/?${qs}` : "/";
  };
  const empty = trend.total.tokens === 0 && trend.total.cost === 0;
  const total = metric === "tokens" ? `${fmtTokens(trend.total.tokens)} tokens` : `${fmtUsd(trend.total.cost)} API-equivalent`;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="space-y-0.5">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Usage over time</h2>
          <p className="text-sm text-muted-foreground">
            {total} · {RANGE_LABELS[range].caption}
            {trend.bucket === "hour" ? ", by hour" : ", by day"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Metric"
            options={(["tokens", "cost"] as const).map((m) => ({ value: m, label: METRIC_LABELS[m] }))}
            active={metric}
            href={(m) => href({ metric: m })}
          />
          <Segmented
            label="Time range"
            options={TREND_RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r].short }))}
            active={range}
            href={(r) => href({ range: r })}
          />
        </div>
      </div>
      <div className="rounded-2xl bg-card p-4 pt-6 ring-1 ring-foreground/10 sm:p-6">
        {empty ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            No usage in the {RANGE_LABELS[range].caption === "all time" ? "gateway's history yet" : RANGE_LABELS[range].caption}.
          </p>
        ) : (
          <UsageTrendChart data={chartData(trend)} metric={metric} />
        )}
      </div>
    </section>
  );
}

/** First value of a search param, or "" — Next hands arrays back for `?a=1&a=2`. */
const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Ranking({
  title,
  rows,
  startRank,
  max,
  metric,
  format,
  accent,
}: {
  title: string;
  rows: LeaderRow[];
  startRank: number;
  max: number;
  metric: (r: LeaderRow) => number;
  format: (n: number) => string;
  accent: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex-1 space-y-3">
      <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{title}</h3>
      <ol className="space-y-2.5">
        {rows.map((r, i) => {
          const value = metric(r);
          return (
            <li key={r.name} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className="w-4 shrink-0 font-mono text-sm text-muted-foreground tabular-nums">
                    {startRank + i}
                  </span>
                  <span className="truncate font-medium">{r.name}</span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{format(value)}</span>
              </div>
              <div className="ml-[1.625rem] h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", accent)}
                  style={{ width: `${max > 0 ? Math.max((value / max) * 100, 1) : 0}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Board({
  heading,
  caption,
  board,
  metric,
  format,
  accent,
  empty,
}: {
  heading: string;
  caption: string;
  board: Leaderboard;
  metric: (r: LeaderRow) => number;
  format: (n: number) => string;
  accent: string;
  empty: string;
}) {
  const split = board.bottom.length > 0;
  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-lg font-semibold tracking-tight">{heading}</h2>
        <p className="text-sm text-muted-foreground">{caption}</p>
      </div>
      {board.max > 0 ? (
        <div className="flex flex-col gap-10 sm:flex-row sm:gap-12">
          <Ranking
            title={split ? "Top 3" : "Most"}
            rows={board.top}
            startRank={1}
            max={board.max}
            metric={metric}
            format={format}
            accent={accent}
          />
          {split && (
            <>
              <div className="hidden w-px bg-border sm:block" aria-hidden />
              <Ranking
                title="Bottom 3"
                rows={board.bottom}
                startRank={board.bottomStartRank}
                max={board.max}
                metric={metric}
                format={format}
                accent={accent}
              />
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/** Everything the page shows, read against one clock so the figures agree with each other. */
function load(range: TrendRange) {
  const now = Date.now();
  return { now, ...publicSnapshot(now), totals: usageTotals(now), trend: usageTrend(range, now) };
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const rangeParam = param(params.range);
  const range = (TREND_RANGES as readonly string[]).includes(rangeParam) ? (rangeParam as TrendRange) : DEFAULT_RANGE;
  const metric: TrendMetric = param(params.metric) === "cost" ? "cost" : DEFAULT_METRIC;
  const { now, quota, byTokens, byCost, totals, trend } = load(range);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-12 px-6 py-16">
      <header className="space-y-1">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            DG
          </span>
          <h1 className="font-heading text-lg font-semibold tracking-tight">DeviceGate</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Subscription capacity and usage
          {quota.updatedAt && ` · updated ${fmtAgo(quota.updatedAt)}`}
        </p>
      </header>

      <section className="flex flex-col gap-10 rounded-2xl bg-card p-8 ring-1 ring-foreground/10 sm:flex-row sm:gap-12">
        <Capacity label="5-hour window" remaining={quota.fiveHourRemaining} reset={quota.fiveHourReset} />
        <div className="hidden w-px bg-border sm:block" aria-hidden />
        <Capacity label="This week" remaining={quota.weeklyRemaining} reset={quota.weeklyReset} />
      </section>

      <section
        aria-label="Usage totals"
        className="flex flex-col gap-10 rounded-2xl bg-card p-8 ring-1 ring-foreground/10 sm:flex-row sm:gap-12"
      >
        <TotalsPanel
          label="All time"
          totals={totals.allTime}
          note={totals.since ? `Since ${fmtSince.format(totals.since)}` : "No usage recorded yet"}
        />
        <div className="hidden w-px bg-border sm:block" aria-hidden />
        <TotalsPanel label="Today" totals={totals.today} note={`Since midnight, ${zoneLabel(now)}`} />
      </section>

      <UsageTrend trend={trend} range={range} metric={metric} />

      <Board
        heading="Leaderboard · tokens"
        caption="Tokens used this week"
        board={byTokens}
        metric={(r) => r.tokens}
        format={fmtTokens}
        accent="bg-chart-1"
        empty="No usage recorded this week yet."
      />

      <Board
        heading="Leaderboard · cost"
        caption="API-equivalent cost this week"
        board={byCost}
        metric={(r) => r.cost}
        format={fmtUsd}
        accent="bg-chart-2"
        empty="No priced usage this week yet."
      />
    </main>
  );
}
