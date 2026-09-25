"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtTokens, fmtUsd } from "@/lib/format";

export type TrendMetric = "tokens" | "cost";

/** One bucket, with its labels already formatted on the server in the gateway's timezone. */
export type TrendDatum = { tick: string; title: string; tokens: number; cost: number };

// Same hues as the leaderboards below: blue for tokens, orange for cost.
const config = {
  tokens: { label: "Tokens", color: "var(--chart-1)" },
  cost: { label: "API-equivalent cost", color: "var(--chart-2)" },
} satisfies ChartConfig;

const formatters: Record<TrendMetric, (n: number) => string> = { tokens: fmtTokens, cost: fmtUsd };

/**
 * Tokens or cost over time, one metric at a time: the two differ by orders of magnitude, so sharing
 * a y-axis would flatten one of them. The tooltip still carries both.
 */
export function UsageTrendChart({ data, metric }: { data: TrendDatum[]; metric: TrendMetric }) {
  const fillId = `trend-fill-${useId().replace(/:/g, "")}`;
  const format = formatters[metric];
  const other: TrendMetric = metric === "tokens" ? "cost" : "tokens";

  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${metric})`} stopOpacity={0.28} />
            <stop offset="100%" stopColor={`var(--color-${metric})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
        <XAxis dataKey="tick" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickMargin={4}
          tickFormatter={(v: number) => format(v)}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4, strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => (payload?.[0]?.payload as TrendDatum | undefined)?.title ?? ""}
              formatter={(value, _name, item) => {
                const p = item?.payload as TrendDatum | undefined;
                return (
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="font-mono font-medium tabular-nums">
                      {format(Number(value))} {metric === "tokens" && "tokens"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {other === "cost" ? `${fmtUsd(p?.cost ?? 0)} API-equivalent` : `${fmtTokens(p?.tokens ?? 0)} tokens`}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        {/* Animation off so the chart paints its final state at once, as the admin chart does.
            A lone point has no line to draw, so it gets a dot instead. */}
        <Area
          dataKey={metric}
          type="monotone"
          stroke={`var(--color-${metric})`}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={data.length === 1 ? { r: 4, fill: `var(--color-${metric})`, strokeWidth: 0 } : false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
