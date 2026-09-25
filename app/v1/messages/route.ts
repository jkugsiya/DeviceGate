import { proxyToUpstream } from "@/lib/proxy/forward";

export function POST(req: Request) {
  return proxyToUpstream(req, "messages");
}
