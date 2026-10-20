"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { modelLabel } from "@/lib/format";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All" },
] as const;

const OUTCOME_LABELS: Record<string, string> = {
  ok: "Succeeded",
  blocked: "Blocked by policy",
  error: "Upstream error",
};

export type FilterBarProps = {
  range: string;
  fromKey: string;
  devices: { id: string; name: string }[];
  models: string[];
  /** Hidden when the page is already scoped to one model, e.g. the model drill-down. */
  lockedModel?: string;
};

/**
 * Local mirror of a URL value so typing stays responsive. `commit` runs once you pause for `delay`
 * ms, and the draft follows the URL again whenever you aren't mid-edit.
 */
function useDraft(urlValue: string, commit: (value: string) => void, delay: number) {
  const [draft, setDraft] = useState(urlValue);
  const editing = useRef(false);
  const onCommit = useEffectEvent(commit);

  useEffect(() => {
    if (!editing.current) setDraft(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (!editing.current) return;
    const id = setTimeout(() => {
      editing.current = false;
      if (draft !== urlValue) onCommit(draft);
    }, delay);
    return () => clearTimeout(id);
  }, [draft, urlValue, delay]);

  const edit = (value: string) => {
    editing.current = true;
    setDraft(value);
  };
  return [draft, edit] as const;
}

/**
 * Every control writes to the URL, so the server components below re-render with new data and each
 * view stays a shareable link.
 */
export function FilterBar({ range, fromKey, devices, models, lockedModel }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParams = (updates: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") sp.delete(key);
      else sp.set(key, value);
    }
    sp.delete("page");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useDraft(urlQ, (v) => setParams({ q: v || null }), 300);

  const device = params.get("device") ?? "";
  const model = lockedModel ?? params.get("model") ?? "";
  const outcome = params.get("outcome") ?? "";
  const custom = !!(fromKey && params.get("from")) || !!params.get("to");
  // Typing a year into a date field produces a valid date per digit (0002, 0020, 0202), so dates
  // wait for a pause too instead of reloading the results on every keystroke.
  const [from, setFrom] = useDraft(params.get("from") ?? (custom ? fromKey : ""), (v) => setParams({ from: v || null, range: null }), 600);
  const [to, setTo] = useDraft(params.get("to") ?? "", (v) => setParams({ to: v || null, range: null }), 600);
  // Leaving the model page keeps every other filter, so you land on the same slice of usage.
  const withoutModel = new URLSearchParams(params.toString());
  withoutModel.delete("model");
  withoutModel.delete("page");
  const activeCount = [device, lockedModel ? "" : model, outcome, urlQ].filter(Boolean).length;

  const selectClass =
    "h-8 rounded-lg border border-border bg-background px-2 text-sm shadow-xs transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

  return (
    <div className="space-y-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label="Time range">
          {PRESETS.map((p) => {
            const active = !custom && range === p.value;
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={active}
                onClick={() => setParams({ range: p.value, from: null, to: null })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                  active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-[9.5rem]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[9.5rem]"
            />
          </div>
          {custom && (
            <Button variant="ghost" size="sm" onClick={() => setParams({ from: null, to: null, range: "7d" })}>
              Clear dates
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search model, device, IP or request id…"
          aria-label="Search requests"
          className="h-8 w-full sm:w-80"
        />
        <select
          aria-label="Device"
          className={selectClass}
          value={device}
          onChange={(e) => setParams({ device: e.target.value || null })}
        >
          <option value="">All devices</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {!lockedModel && (
          <select
            aria-label="Model"
            className={selectClass}
            value={model}
            onChange={(e) => setParams({ model: e.target.value || null })}
          >
            <option value="">All models</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {modelLabel(m)}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Outcome"
          className={selectClass}
          value={outcome}
          onChange={(e) => setParams({ outcome: e.target.value || null })}
        >
          <option value="">Any outcome</option>
          {Object.entries(OUTCOME_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>

        {lockedModel && (
          <Badge variant="secondary" className="gap-1">
            {modelLabel(lockedModel)}
            <Link
              href={withoutModel.size ? `/admin/usage?${withoutModel}` : "/admin/usage"}
              aria-label="Remove model filter"
              className="hover:text-foreground"
            >
              <XIcon className="size-3" />
            </Link>
          </Badge>
        )}
        {activeCount > 0 && (
          <Link
            href={pathname}
            replace
            scroll={false}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto text-muted-foreground")}
          >
            Reset filters
          </Link>
        )}
      </div>
    </div>
  );
}
