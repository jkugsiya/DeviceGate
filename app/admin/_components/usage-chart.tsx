"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtNumber, fmtTokens, fmtUsd } from "@/lib/format";
import type { DayPoint } from "@/lib/usage-queries";

// One series, so no legend: the heading already says what is plotted.
const config = { cost: { label: "Cost", color: "var(--chart-1)" } } satisfies ChartConfig;

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Spend per local day. Days with no traffic are present as zeroes rather than skipped, so a quiet
 * stretch reads as a gap instead of being compressed away.
 */
export function UsageChart({ data }: { data: DayPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No requests in this range.</p>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={shortDay}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickMargin={4}
          tickFormatter={(v: number) => fmtUsd(v)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const day = payload?.[0]?.payload?.day as string | undefined;
                return day
                  ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })
                  : "";
              }}
              formatter={(value, _name, item) => {
                const p = item?.payload as DayPoint | undefined;
                return (
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="font-mono font-medium tabular-nums">{fmtUsd(Number(value))}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtNumber(p?.requests ?? 0)} requests · {fmtTokens(p?.tokens ?? 0)} tokens
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        {/* Thin bars with a rounded data-end, square at the baseline. Animation is off: a
            dashboard should render its final state immediately, and Recharts' enter animation
            leaves the bar shapes unrendered until it commits. */}
        <Bar dataKey="cost" fill="var(--color-cost)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
