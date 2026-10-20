import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { fmtNumber } from "@/lib/format";
import { PAGE_SIZE } from "@/lib/usage-queries";
import { hrefWith, type Params } from "./query";

/**
 * Prev/next paging that says where you are, so a long log stays navigable. Each link jumps to
 * `anchor`, the id of the table's section, so a new page opens at its first row instead of the top
 * of the whole page.
 */
export function Pager({
  page,
  pages,
  total,
  pathname,
  params,
  anchor,
}: {
  page: number;
  pages: number;
  total: number;
  pathname: string;
  params: Params;
  anchor: string;
}) {
  if (total === 0) return null;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const button = buttonVariants({ variant: "outline", size: "sm" });

  // An unavailable step renders as plain text, so it can't be focused or followed off the end.
  const step = (to: number, label: string) =>
    to < 1 || to > pages ? (
      <span aria-disabled className={cn(button, "pointer-events-none opacity-40")}>
        {label}
      </span>
    ) : (
      <Link href={`${hrefWith(pathname, params, { page: String(to) })}#${anchor}`} className={button}>
        {label}
      </Link>
    );

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground tabular-nums">
        {fmtNumber(first)}–{fmtNumber(last)} of {fmtNumber(total)}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {step(page - 1, "Previous")}
          <span className="text-muted-foreground tabular-nums">
            Page {page} of {pages}
          </span>
          {step(page + 1, "Next")}
        </div>
      )}
    </div>
  );
}
