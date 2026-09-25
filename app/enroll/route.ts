import { z } from "zod";
import { publicBaseUrl } from "@/lib/config";
import { db } from "@/lib/db/client";
import { normalizeCode, redeemEnrollmentCode } from "@/lib/enrollment";
import { clientIp } from "@/lib/proxy/forward";

// Unauthenticated by design (the code is the credential), so failed attempts are rate limited
// per IP: codes are 8 chars from a 32-letter alphabet and expire after 15 minutes.
const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 10;
const globalForEnroll = globalThis as unknown as { __enrollFailures?: Map<string, number[]> };
const failures = (globalForEnroll.__enrollFailures ??= new Map<string, number[]>());

const body = z.object({
  code: z.string().max(32),
  hostname: z.string().max(100).nullish(),
});

export async function POST(req: Request) {
  const ip = clientIp(req.headers) ?? "unknown";
  const now = Date.now();
  const recent = (failures.get(ip) ?? []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= MAX_FAILURES) {
    return Response.json({ error: "Too many failed attempts. Try again later." }, { status: 429, headers: { "retry-after": "600" } });
  }

  const parsed = body.safeParse(await req.json().catch(() => null));
  const code = parsed.success ? normalizeCode(parsed.data.code) : "";
  const result =
    code.length === 8
      ? redeemEnrollmentCode(db(), code, { ip, hostname: parsed.data?.hostname?.replace(/[^\w.-]/g, "") || null })
      : { ok: false as const };

  if (!result.ok) {
    failures.set(ip, [...recent, now]);
    return Response.json({ error: "Invalid, used or expired setup code." }, { status: 400 });
  }
  return Response.json({ token: result.token, deviceName: result.deviceName, baseUrl: publicBaseUrl() });
}
