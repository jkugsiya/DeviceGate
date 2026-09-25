import { proxyToUpstream } from "@/lib/proxy/forward";

// Upstream model list, narrowed to the families this device may use.
export function GET(req: Request) {
  return proxyToUpstream(req, "models");
}
