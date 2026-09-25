import type { DbOrTx } from "./db/client";
import { auditEvents } from "./db/schema";

export type Actor = { adminUserId: string | null; ip: string | null; userAgent: string | null };

export type AuditEntry = {
  action: string;
  targetType: "device" | "model" | "admin";
  targetId: string | null;
  before?: unknown;
  after?: unknown;
};

/** Call inside the same transaction as the change it records. Never pass secrets in before/after. */
export function audit(tx: DbOrTx, actor: Actor, entry: AuditEntry) {
  tx.insert(auditEvents)
    .values({
      ...entry,
      before: entry.before ?? null,
      after: entry.after ?? null,
      adminUserId: actor.adminUserId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    })
    .run();
}
