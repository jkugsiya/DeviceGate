import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Claude Code probes the gateway's base URL to check reachability. That path also serves the
 * public status page, so a browser gets the page and anything else gets a plain-text 200.
 *
 * A browser either asks for HTML or sends `Sec-Fetch-Mode`, which every current browser adds and
 * HTTP clients don't. The second check matters: when you change the chart's range, Next fetches the
 * new page data without asking for HTML, and a plain-text reply makes it reload the whole page.
 *
 * Scoped to `/` alone: the proxy must never sit in front of /v1/*, which is the streaming hot path.
 */
export function proxy(request: NextRequest) {
  const fromBrowser = request.headers.get("accept")?.includes("text/html") || request.headers.has("sec-fetch-mode");
  if (fromBrowser) return NextResponse.next();
  return new NextResponse(request.method === "HEAD" ? null : "devicegate", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = { matcher: "/" };
