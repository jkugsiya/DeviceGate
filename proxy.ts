import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Claude Code probes the gateway's base URL to check reachability. That path also serves the
 * public status page, so anything that isn't asking for HTML gets a plain-text 200 instead — a
 * browser gets the page, a client gets the probe.
 *
 * Scoped to `/` alone: the proxy must never sit in front of /v1/*, which is the streaming hot path.
 */
export function proxy(request: NextRequest) {
  if (request.headers.get("accept")?.includes("text/html")) return NextResponse.next();
  return new NextResponse(request.method === "HEAD" ? null : "devicegate", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = { matcher: "/" };
