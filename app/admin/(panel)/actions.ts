"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  createDevice,
  deleteDevice,
  rotateDeviceToken,
  setDeviceStatus,
  setModelEnabled,
  updateDefaultLimits,
  updateDeviceDetails,
  updateDevicePolicy,
} from "@/lib/devices";
import { createEnrollmentCode } from "@/lib/enrollment";
import { audit } from "@/lib/audit";
import { removeAccount, setAccountPaused } from "@/lib/pool-quota";

const id = z.uuid();
const name = z.string().trim().min(1, "Name is required").max(60);
const notes = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s || null);
// Empty input = no limit of its own (a device inherits the default; the default is unlimited).
const limit = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (s === "") return null;
    const n = Number(s.replaceAll(",", ""));
    if (!Number.isInteger(n) || n < 0 || n > 1e12) {
      ctx.addIssue({ code: "custom", message: "Limits must be whole numbers of 0 or more, or empty." });
      return z.NEVER;
    }
    return n;
  });
// Dollar amounts, rounded to cents. Empty input works like `limit`.
const usdLimit = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (s === "") return null;
    const n = Number(s.replace(/^\$/, "").replaceAll(",", ""));
    if (!Number.isFinite(n) || n < 0 || n > 1e9) {
      ctx.addIssue({ code: "custom", message: "Spend limits must be dollar amounts of 0 or more, or empty." });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

const str = (f: FormData, key: string) => String(f.get(key) ?? "");

const limits = z.object({
  dailyRequests: limit,
  weeklyRequests: limit,
  dailyTokens: limit,
  weeklyTokens: limit,
  dailyCostUsd: usdLimit,
  weeklyCostUsd: usdLimit,
  requestsPerMinute: limit,
  maxConcurrent: limit,
});
/** The raw limit fields of a limits form, keyed like `limits`, for parsing. */
const limitFields = (f: FormData) => Object.fromEntries(Object.keys(limits.shape).map((k) => [k, str(f, k)]));

/**
 * Runs a mutation and reports the outcome to the form, so every action ends in a visible toast
 * instead of silence. `fn` may return the toast's text. Never wrap `redirect()` in this — it
 * signals by throwing.
 */
function run(fn: () => string | void): FormResult {
  try {
    const message = fn();
    return { ok: true, at: Date.now(), ...(message && { message }) };
  } catch (err) {
    console.error("[admin] action failed:", err);
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export type TokenResult = { token: string } | { error: string } | null;
export type SetupResult = { code: string; expiresAt: number; deviceId: string; name: string } | { error: string } | null;
// `message` is the toast's text when it must describe what happened: a toggle's props have already
// flipped by the time the result arrives, so they can't say which way it went.
export type FormResult = { ok: true; at: number; message?: string } | { error: string } | null;

export async function createDeviceAction(_prev: SetupResult, form: FormData): Promise<SetupResult> {
  const { actor } = await requireAdmin();
  const input = z.object({ name, notes }).safeParse({ name: str(form, "name"), notes: str(form, "notes") });
  if (!input.success) return { error: input.error.issues[0].message };
  const { id: deviceId } = createDevice(db(), actor, input.data);
  const setup = createEnrollmentCode(db(), actor, deviceId);
  revalidatePath("/admin");
  return { code: setup.code, expiresAt: setup.expiresAt.getTime(), deviceId, name: input.data.name };
}

/** New one-time setup code for connecting (or re-connecting) a PC as this device. */
export async function createSetupCodeAction(deviceId: string, _prev: SetupResult): Promise<SetupResult> {
  const { actor } = await requireAdmin();
  const setup = createEnrollmentCode(db(), actor, id.parse(deviceId));
  return { code: setup.code, expiresAt: setup.expiresAt.getTime(), deviceId, name: "" };
}

export async function updateDetailsAction(deviceId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const input = z.object({ name, notes }).safeParse({ name: str(form, "name"), notes: str(form, "notes") });
  if (!input.success) return { error: input.error.issues[0].message };
  const result = run(() => updateDeviceDetails(db(), actor, id.parse(deviceId), input.data));
  revalidatePath("/admin", "layout");
  return result;
}

export async function updatePolicyAction(deviceId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const input = z
    .object({
      allowedModelIds: z.array(z.string().max(40)).max(50),
      limits,
    })
    .safeParse({ allowedModelIds: form.getAll("models").map(String), limits: limitFields(form) });
  if (!input.success) return { error: input.error.issues[0].message };
  const result = run(() => updateDevicePolicy(db(), actor, id.parse(deviceId), input.data));
  revalidatePath("/admin", "layout");
  return result;
}

export async function updateDefaultLimitsAction(_prev: FormResult, form: FormData): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const input = limits.safeParse(limitFields(form));
  if (!input.success) return { error: input.error.issues[0].message };
  const result = run(() => updateDefaultLimits(db(), actor, input.data));
  revalidatePath("/admin", "layout");
  return result;
}

export async function setDeviceStatusAction(
  deviceId: string,
  status: "enabled" | "disabled",
  _prev: FormResult,
): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const next = z.enum(["enabled", "disabled"]).parse(status);
  const result = run(() => `${setDeviceStatus(db(), actor, id.parse(deviceId), next)} ${next}`);
  revalidatePath("/admin", "layout");
  return result;
}

export async function rotateTokenAction(deviceId: string, _prev: TokenResult): Promise<TokenResult> {
  const { actor } = await requireAdmin();
  try {
    const token = rotateDeviceToken(db(), actor, id.parse(deviceId));
    revalidatePath(`/admin/devices/${deviceId}`);
    return { token };
  } catch (err) {
    console.error("[admin] action failed:", err);
    return { error: err instanceof Error ? err.message : "Could not issue a new token." };
  }
}

export async function deleteDeviceAction(deviceId: string, _prev: FormResult): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const name = deleteDevice(db(), actor, id.parse(deviceId));
  revalidatePath("/admin", "layout");
  // The device page is gone, so the confirmation is handed to the overview instead.
  redirect(`/admin?deleted=${encodeURIComponent(name)}`);
}

export async function setModelEnabledAction(modelId: string, enabled: boolean, _prev: FormResult): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const on = z.boolean().parse(enabled);
  const result = run(() => {
    const name = setModelEnabled(db(), actor, z.string().max(40).parse(modelId), on);
    return on ? `${name} enabled` : `${name} disabled for every device`;
  });
  revalidatePath("/admin", "layout");
  return result;
}

/** Pauses or resumes a TeamClaude account. The change lives in TeamClaude; DeviceGate only audits it. */
export async function setAccountPausedAction(account: string, paused: boolean, _prev: FormResult): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const input = z.object({ account: z.string().trim().min(1).max(200), paused: z.boolean() }).parse({ account, paused });
  try {
    await setAccountPaused(input.account, input.paused);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change the account." };
  }
  audit(db(), actor, {
    action: input.paused ? "account.disable" : "account.enable",
    targetType: "account",
    targetId: input.account,
    before: { disabled: !input.paused },
    after: { disabled: input.paused },
  });
  revalidatePath("/admin");
  return { ok: true, at: Date.now(), message: input.paused ? `${input.account} paused` : `${input.account} is back in rotation` };
}

/** Removes a TeamClaude account and its saved login. TeamClaude has no undo for this. */
export async function removeAccountAction(account: string, _prev: FormResult): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const name = z.string().trim().min(1).max(200).parse(account);
  try {
    await removeAccount(name);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove the account." };
  }
  audit(db(), actor, { action: "account.delete", targetType: "account", targetId: name });
  revalidatePath("/admin");
  return { ok: true, at: Date.now(), message: `${name} deleted` };
}
