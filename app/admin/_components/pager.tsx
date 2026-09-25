import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { fmtNumber } from "@/lib/format";
import { PAGE_SIZE } from "@/lib/usage-queries";
import { hrefWith, type Params } from "./query";

/** Prev/next paging that says where you are, so a long log stays navigable. */
export function Pager({
  page,
  pages,
  total,
  pathname,
  params,
}: {
  page: number;
  pages: number;
  total: number;
  pathname: string;
  params: Params;
}) {
  if (total === 0) return null;
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const link = (to: number) => hrefWith(pathname, params, { page: String(to) });
  const disabled = "pointer-events-none opacity-40";

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground tabular-nums">
        {fmtNumber(first)}–{fmtNumber(last)} of {fmtNumber(total)}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Link
            href={link(page - 1)}
            aria-disabled={page <= 1}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && disabled)}
          >
            Previous
          </Link>
          <span className="text-muted-foreground tabular-nums">
            Page {page} of {pages}
          </span>
          <Link
            href={link(page + 1)}
            aria-disabled={page >= pages}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pages && disabled)}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}
