import { publicBaseUrl } from "@/lib/config";
import { setupShellScript } from "@/lib/setup-scripts";

export function GET() {
  return new Response(setupShellScript(publicBaseUrl()), { headers: { "content-type": "text/x-shellscript; charset=utf-8" } });
}
