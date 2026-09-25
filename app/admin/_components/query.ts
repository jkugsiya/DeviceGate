/** Search-param helpers shared by the server pages and the client filter bar. */

export type Params = Record<string, string | string[] | undefined>;

/** First value of a repeated param, or "" — Next hands arrays back for `?a=1&a=2`. */
export function one(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function toSearchParams(params: Params): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const v = one(params, key);
    if (v) sp.set(key, v);
  }
  return sp;
}

/**
 * Current URL with some params changed; `null` removes one. Anything that narrows the result set
 * also resets paging, since page 4 of a new filter is usually empty.
 */
export function hrefWith(pathname: string, params: Params, updates: Record<string, string | null>): string {
  const sp = toSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") sp.delete(key);
    else sp.set(key, value);
  }
  if (!("page" in updates)) sp.delete("page");
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
