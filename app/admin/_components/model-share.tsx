"use client";

import { Cell, Pie, PieChart } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtPct, fmtTokens, fmtUsd, modelLabel } from "@/lib/format";
import type { BreakdownRow } from "@/lib/usage-queries";

// Categorical slots are assigned in fixed order and never cycled; a sixth model folds into
// "Other" rather than inventing a colour, which also keeps the ring readable.
const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const OTHER = "var(--muted-foreground)";
const MAX_SLICES = 5;

type Slice = { key: string; label: string; value: number; tokens: number; color: string };

function toSlices(rows: BreakdownRow[], metric: "cost" | "tokens"): Slice[] {
  const ranked = [...rows].filter((r) => r[metric] > 0).sort((a, b) => b[metric] - a[metric]);
  const head = ranked.slice(0, MAX_SLICES).map((r, i) => ({
    key: r.key,
    label: modelLabel(r.label),
    value: r[metric],
    tokens: r.tokens,
    color: SLOTS[i],
  }));
  const rest = ranked.slice(MAX_SLICES);
  if (rest.length > 0) {
    head.push({
      key: "__other",
      label: `${rest.length} more`,
      value: rest.reduce((s, r) => s + r[metric], 0),
      tokens: rest.reduce((s, r) => s + r.tokens, 0),
      color: OTHER,
    });
  }
  return head;
}

/**
 * Share of spend (or tokens) per model, as a ring with the total in the middle.
 *
 * The legend carries exact figures beside each swatch: a ring shows proportion at a glance but is
 * poor at comparing close values, and two models on similar volumes is the normal case here.
 */
export function ModelShare({ rows, metric = "cost" }: { rows: BreakdownRow[]; metric?: "cost" | "tokens" }) {
  const slices = toSlices(rows, metric);
  const total = slices.reduce((s, d) => s + d.value, 0);
  const format = metric === "cost" ? fmtUsd : fmtTokens;

  if (slices.length === 0 || total === 0) {
    return <p className="py-6 text-sm text-muted-foreground">Nothing to compare in this range.</p>;
  }

  const config: ChartConfig = Object.fromEntries(slices.map((d) => [d.key, { label: d.label, color: d.color }]));

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative shrink-0">
        <ChartContainer config={config} className="aspect-square h-44 w-44">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, name) => {
                    const slice = slices.find((d) => d.key === name || d.label === name);
                    return (
                      <div className="flex flex-1 flex-col gap-0.5">
                        <span className="font-medium">{slice?.label ?? String(name)}</span>
                        <span className="font-mono tabular-nums">
                          {format(Number(value))} · {fmtPct(Number(value) / total)}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="key"
              innerRadius="62%"
              outerRadius="100%"
              // A gap in the surface colour separates segments, rather than a stroke around them.
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-semibold tabular-nums">{format(total)}</span>
          <span className="text-xs text-muted-foreground">total</span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-2 sm:max-w-sm">
        {slices.map((d) => (
          <li key={d.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 translate-y-px rounded-[3px]"
                style={{ backgroundColor: d.color }}
              />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {format(d.value)}
              <span className="ml-2 text-muted-foreground">{fmtPct(d.value / total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
