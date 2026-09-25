"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/models", label: "Models" },
  { href: "/admin/audit", label: "Audit log" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {NAV.map((n) => {
        // Every device page belongs under Overview, so only "/admin" itself needs an exact match.
        const active = n.href === "/admin" ? pathname === "/admin" || pathname.startsWith("/admin/devices") : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
