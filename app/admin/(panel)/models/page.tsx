import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { modelList } from "@/lib/admin-queries";
import { fmtRate } from "@/lib/format";
import { familyRates } from "@/lib/pricing";
import { ModelToggle } from "../../_components/forms";

export default function ModelsPage() {
  const models = modelList();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Models</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Disabling a model blocks it for every device. Requests are matched by model id prefix, so new versions of a
          family are covered automatically. Per-device access is set on each device.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Matches</TableHead>
              <TableHead className="text-right">Rate per Mtok</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Devices allowed</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => {
              const rates = familyRates(m.matchPrefix);
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{m.matchPrefix}*</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {rates ? (
                      <>
                        {fmtRate(rates.input)} in · {fmtRate(rates.output)} out
                        <div className="text-muted-foreground">
                          {fmtRate(rates.cacheWrite5m)} cache write · {fmtRate(rates.cacheRead)} read
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">not priced</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.enabled ? "secondary" : "destructive"}>{m.enabled ? "Enabled" : "Disabled"}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.devices}</TableCell>
                  <TableCell className="text-right">
                    <ModelToggle modelId={m.id} displayName={m.displayName} enabled={m.enabled} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Rates are Anthropic&apos;s public API prices for the newest version in each family, used to estimate cost. Your
        subscription covers this traffic — see <code>lib/pricing.ts</code>.
      </p>
    </div>
  );
}
