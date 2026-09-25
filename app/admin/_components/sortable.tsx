import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { TableHead } from "@/components/ui/table";
import { hrefWith, type Params } from "./query";

export type SortDir = "asc" | "desc";

/**
 * A column header that sorts by linking, so sorting works without client JS and every sorted view
 * is a shareable URL. Clicking the active column flips direction.
 */
export function SortableHead({
  column,
  sort,
  dir,
  pathname,
  params,
  align = "left",
  sortParam = "sort",
  dirParam = "dir",
  children,
}: {
  column: string;
  sort: string;
  dir: SortDir;
  pathname: string;
  params: Params;
  align?: "left" | "right";
  /** Param names, so two tables on one page can sort without fighting over `?sort`. */
  sortParam?: string;
  dirParam?: string;
  children: React.ReactNode;
}) {
  const active = sort === column;
  // Numbers are most useful biggest-first, so an inactive column starts descending.
  const nextDir: SortDir = active && dir === "desc" ? "asc" : "desc";
  const Icon = !active ? ChevronsUpDownIcon : dir === "desc" ? ArrowDownIcon : ArrowUpIcon;

  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <Link
        href={hrefWith(pathname, params, { [sortParam]: column, [dirParam]: nextDir })}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
      </Link>
    </TableHead>
  );
}
