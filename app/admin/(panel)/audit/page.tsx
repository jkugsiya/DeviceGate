import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditLog } from "@/lib/admin-queries";
import { fmtDateTime } from "@/lib/format";
import { zoneLabel } from "@/lib/timezone";

const json = (v: unknown) => (v == null ? "—" : JSON.stringify(v, null, 2));

export default function AuditPage() {
  const events = auditLog();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">Every admin action and sign-in attempt, newest first (last 200).</p>
      </div>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time ({zoneLabel()})</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>By</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id} className="align-top">
                <TableCell className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{e.action}</TableCell>
                <TableCell className="text-sm">{e.targetName ?? "—"}</TableCell>
                <TableCell className="text-sm">{e.actorName}</TableCell>
                <TableCell className="text-xs">{e.ip ?? "—"}</TableCell>
                <TableCell>
                  {e.before == null && e.after == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-sm text-muted-foreground">View</summary>
                      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        <pre className="overflow-x-auto rounded bg-muted p-2">before: {json(e.before)}</pre>
                        <pre className="overflow-x-auto rounded bg-muted p-2">after: {json(e.after)}</pre>
                      </div>
                    </details>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
