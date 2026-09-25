import { cn } from "cn";
import { Card } from "@/components/ui/card";

/** A single headline figure: label, big number, and one line of supporting detail. */
export function StatCard({
  label,
  value,
  sub,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <Card className="gap-2">
      <div className="px-(--card-spacing) text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div
        className={cn(
          "px-(--card-spacing) font-mono text-3xl leading-none font-semibold tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="px-(--card-spacing) text-sm text-muted-foreground">{sub}</div>}
    </Card>
  );
}
