import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db/client";
import { loadDefaultLimits } from "@/lib/policy/load";
import { TIME_ZONE } from "@/lib/timezone";
import { DefaultLimitsForm } from "../../_components/forms";
import { limitFields } from "../../_components/limit-fields";

export default function LimitsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Limits</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every device gets these limits for each field left empty on its own page. A value set on a device replaces the
          default, higher or lower. Each device counts its own usage against them.
        </p>
      </div>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Default limits</CardTitle>
          <CardDescription>Days start at midnight {TIME_ZONE} time; weeks start on Monday.</CardDescription>
        </CardHeader>
        <CardContent>
          <DefaultLimitsForm limits={limitFields(loadDefaultLimits(db()))} />
        </CardContent>
      </Card>
    </div>
  );
}
