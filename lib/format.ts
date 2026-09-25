import { TIME_ZONE } from "./timezone";

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * US$ with enough precision to stay meaningful: single requests land in fractions of a cent,
 * while a week of traffic runs to tens of dollars.
 */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** `claude-haiku-4-5-20251001` → `Haiku 4.5`. Falls back to the raw id for anything unrecognised. */
export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?$/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace("-", ".")}` : id;
}

/** A price per million tokens: whole dollars stay whole, fractions get cents ($10, $12.50, $0.25). */
export function fmtRate(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
}

export function fmtDateTime(d: Date | number | null | undefined): string {
  if (d == null) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function fmtAgo(d: Date | number | null | undefined, now = Date.now()): string {
  if (d == null) return "never";
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function fmtIn(d: Date | number | null | undefined, now = Date.now()): string {
  if (d == null) return "—";
  const m = Math.max(0, Math.round((new Date(d).getTime() - now) / 60_000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h ${m % 60} min`;
  return `in ${Math.floor(h / 24)} d`;
}
