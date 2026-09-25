import { publicBaseUrl } from "@/lib/config";
import { setupPowerShellScript } from "@/lib/setup-scripts";

export function GET() {
  return new Response(setupPowerShellScript(publicBaseUrl()), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
