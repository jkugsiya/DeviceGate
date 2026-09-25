import type { Metadata } from "next";
import { cn } from "cn";
import { fmtAgo, fmtIn, fmtTokens, fmtUsd } from "@/lib/format";
import { type Leaderboard, type LeaderRow, publicSnapshot } from "@/lib/public-queries";

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

export default function HomePage() {
  const { quota, byTokens, byCost } = publicSnapshot();

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
          Subscription capacity
          {quota.updatedAt && ` · updated ${fmtAgo(quota.updatedAt)}`}
        </p>
      </header>

      <section className="flex flex-col gap-10 rounded-2xl bg-card p-8 ring-1 ring-foreground/10 sm:flex-row sm:gap-12">
        <Capacity label="5-hour window" remaining={quota.fiveHourRemaining} reset={quota.fiveHourReset} />
        <div className="hidden w-px bg-border sm:block" aria-hidden />
        <Capacity label="This week" remaining={quota.weeklyRemaining} reset={quota.weeklyReset} />
      </section>

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
