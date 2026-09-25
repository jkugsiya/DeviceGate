import { proxyToUpstream } from "@/lib/proxy/forward";

// Token counting is free upstream: model gate only, no quota, not recorded in usage_events.
export function POST(req: Request) {
  return proxyToUpstream(req, "count_tokens");
}
