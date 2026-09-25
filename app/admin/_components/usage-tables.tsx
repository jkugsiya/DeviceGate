import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, fmtNumber, fmtPct, fmtTokens, fmtUsd, modelLabel } from "@/lib/format";
import { ratesFor } from "@/lib/pricing";
import { zoneLabel } from "@/lib/timezone";
import type { BreakdownRow, RequestRow } from "@/lib/usage-queries";
import type { Params } from "./query";
import { SortableHead, type SortDir } from "./sortable";

const shell = "overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";

function ShareBar({ fraction }: { fraction: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{fmtPct(fraction)}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(fraction * 100, 2)}%` }} />
      </div>
    </div>
  );
}

/**
 * Cost for a group. A group is only "unpriced" when its model genuinely has no published rate —
 * otherwise the rows just haven't been priced yet, which is a different problem with a different fix.
 */
function GroupCost({ row, model }: { row: BreakdownRow; model?: string }) {
  if (row.unpriced === 0 || row.cost > 0) return <>{fmtUsd(row.cost)}</>;
  const known = model ? ratesFor(model) !== null : true;
  return <span className="text-muted-foreground">{known ? "not priced yet" : "no rate"}</span>;
}

/** Spend and tokens per model or per device, sortable, with each row linking somewhere useful. */
export function BreakdownTable({
  rows,
  caption,
  sort,
  dir,
  pathname,
  params,
  hrefFor,
  linkLabel,
  sortParam,
  dirParam,
}: {
  rows: BreakdownRow[];
  caption: string;
  sort: string;
  dir: SortDir;
  pathname: string;
  params: Params;
  hrefFor?: (row: BreakdownRow) => string;
  linkLabel: string;
  sortParam?: string;
  dirParam?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing in this range.</p>;
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const head = { sort, dir, pathname, params, sortParam, dirParam };

  return (
    <div className={shell}>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead column="name" {...head}>
              {caption}
            </SortableHead>
            <SortableHead column="requests" align="right" {...head}>
              Requests
            </SortableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Cache write</TableHead>
            <TableHead className="text-right">Cache read</TableHead>
            <SortableHead column="tokens" align="right" {...head}>
              Tokens
            </SortableHead>
            <SortableHead column="cost" align="right" {...head}>
              Cost
            </SortableHead>
            <TableHead className="text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const href = hrefFor?.(r);
            return (
              <TableRow key={r.key}>
                <TableCell>
                  {href ? (
                    <Link href={href} className="font-medium hover:underline" title={`${linkLabel} ${r.label}`}>
                      {caption === "Model" ? modelLabel(r.label) : r.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.label}</span>
                  )}
                  {caption === "Model" && <div className="font-mono text-xs text-muted-foreground">{r.label}</div>}
                  {r.blocked > 0 && (
                    <div className="text-xs text-muted-foreground">{fmtNumber(r.blocked)} blocked</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtTokens(r.input)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtTokens(r.output)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtTokens(r.cacheWrite)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmtTokens(r.cacheRead)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtTokens(r.tokens)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  <GroupCost row={r} model={caption === "Model" ? r.key : undefined} />
                </TableCell>
                <TableCell>
                  <ShareBar fraction={totalCost > 0 ? r.cost / totalCost : 0} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Outcome({ row }: { row: RequestRow }) {
  if (row.errorType) return <Badge variant="destructive">{row.errorType}</Badge>;
  if (row.statusCode >= 400) return <span className="text-destructive">{row.statusCode}</span>;
  return (
    <span className="text-muted-foreground">
      {row.statusCode}
      {row.aborted && " · cancelled"}
    </span>
  );
}

/** The request log: one row per request, sortable and paged. */
export function RequestsTable({
  rows,
  sort,
  dir,
  pathname,
  params,
  showDevice = true,
}: {
  rows: RequestRow[];
  sort: string;
  dir: SortDir;
  pathname: string;
  params: Params;
  showDevice?: boolean;
}) {
  const head = { sort, dir, pathname, params };
  return (
    <div className={shell}>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead column="time" {...head}>
              Time ({zoneLabel()})
            </SortableHead>
            {showDevice && <TableHead>Device</TableHead>}
            <TableHead>Model</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Cache w / r</TableHead>
            <SortableHead column="tokens" align="right" {...head}>
              Tokens
            </SortableHead>
            <SortableHead column="cost" align="right" {...head}>
              Cost
            </SortableHead>
            <SortableHead column="latency" align="right" {...head}>
              Latency
            </SortableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">{fmtDateTime(r.ts)}</TableCell>
              {showDevice && (
                <TableCell className="whitespace-nowrap">
                  <Link href={`/admin/devices/${r.deviceId}`} className="hover:underline">
                    {r.deviceName ?? "—"}
                  </Link>
                </TableCell>
              )}
              <TableCell className="whitespace-nowrap">
                {r.model ? (
                  <Link href={`/admin/usage/models/${encodeURIComponent(r.model)}`} className="hover:underline">
                    {modelLabel(r.model)}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <Outcome row={r} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmtNumber(r.input)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmtNumber(r.output)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                {fmtTokens(r.cacheWrite)} / {fmtTokens(r.cacheRead)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{fmtTokens(r.tokens)}</TableCell>
              {/* A refused request cost nothing; an unpriced one is unknown. Neither is "$0.00". */}
              <TableCell className="text-right font-mono tabular-nums">
                {r.errorType ? <span className="text-muted-foreground">—</span> : fmtUsd(r.costUsd)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{(r.latencyMs / 1000).toFixed(1)}s</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{r.clientIp ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
