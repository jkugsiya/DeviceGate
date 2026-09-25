import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit, type Actor } from "../audit";
import { db } from "../db/client";
import * as schema from "../db/schema";

// Browser origins allowed to call the auth API, e.g. "http://192.168.1.50:3000,http://localhost:3000".
const trustedOrigins = (process.env.ADMIN_TRUSTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function requestActor(h: Headers | undefined, adminUserId: string | null): Actor {
  return {
    adminUserId,
    ip: h?.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: h?.get("user-agent") ?? null,
  };
}

/** Admin login for the dashboard. Single owner: sign-up is off; create the admin with `bun run admin`. */
export const auth = betterAuth({
  database: drizzleAdapter(db(), { provider: "sqlite", schema }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  trustedOrigins,
  session: { expiresIn: 60 * 60 * 24 * 7 },
  rateLimit: { enabled: true, window: 60, max: 30, customRules: { "/sign-in/email": { window: 60, max: 5 } } },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const failed = ctx.context.returned instanceof APIError;
      const session = ctx.context.newSession;
      audit(db(), requestActor(ctx.headers, session?.user.id ?? null), {
        action: failed ? "admin.login_failed" : "admin.login",
        targetType: "admin",
        targetId: session?.user.id ?? null,
        // Only the attempted email is kept; the password never reaches the audit log.
        after: { email: (ctx.body as { email?: string } | undefined)?.email ?? null },
      });
    }),
  },
  plugins: [nextCookies()],
});

/** Server-side guard for admin pages and actions. Returns who is acting, for audit rows. */
export async function requireAdmin(): Promise<{ user: { id: string; email: string; name: string }; actor: Actor }> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/admin/login");
  return { user: session.user, actor: requestActor(h, session.user.id) };
}
