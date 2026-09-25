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
  updateDeviceDetails,
  updateDevicePolicy,
} from "@/lib/devices";
import { createEnrollmentCode } from "@/lib/enrollment";

const id = z.uuid();
const name = z.string().trim().min(1, "Name is required").max(60);
const notes = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s || null);
// Empty input = unlimited.
const limit = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (s === "") return null;
    const n = Number(s.replaceAll(",", ""));
    if (!Number.isInteger(n) || n < 0 || n > 1e12) {
      ctx.addIssue({ code: "custom", message: "Limits must be whole numbers ≥ 0 (leave empty for unlimited)" });
      return z.NEVER;
    }
    return n;
  });

const str = (f: FormData, key: string) => String(f.get(key) ?? "");

/**
 * Runs a mutation and reports the outcome to the form, so every action ends in a visible toast
 * instead of silence. Never wrap `redirect()` in this — it signals by throwing.
 */
function run(fn: () => void): FormResult {
  try {
    fn();
    return { ok: true, at: Date.now() };
  } catch (err) {
    console.error("[admin] action failed:", err);
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export type TokenResult = { token: string } | { error: string } | null;
export type SetupResult = { code: string; expiresAt: number; deviceId: string; name: string } | { error: string } | null;
export type FormResult = { ok: true; at: number } | { error: string } | null;

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
      limits: z.object({
        dailyRequests: limit,
        weeklyRequests: limit,
        dailyTokens: limit,
        weeklyTokens: limit,
        requestsPerMinute: limit,
        maxConcurrent: limit,
      }),
    })
    .safeParse({
      allowedModelIds: form.getAll("models").map(String),
      limits: {
        dailyRequests: str(form, "dailyRequests"),
        weeklyRequests: str(form, "weeklyRequests"),
        dailyTokens: str(form, "dailyTokens"),
        weeklyTokens: str(form, "weeklyTokens"),
        requestsPerMinute: str(form, "requestsPerMinute"),
        maxConcurrent: str(form, "maxConcurrent"),
      },
    });
  if (!input.success) return { error: input.error.issues[0].message };
  const result = run(() => updateDevicePolicy(db(), actor, id.parse(deviceId), input.data));
  revalidatePath("/admin", "layout");
  return result;
}

export async function setDeviceStatusAction(
  deviceId: string,
  status: "enabled" | "disabled",
  _prev: FormResult,
): Promise<FormResult> {
  const { actor } = await requireAdmin();
  const result = run(() => setDeviceStatus(db(), actor, id.parse(deviceId), z.enum(["enabled", "disabled"]).parse(status)));
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
  const result = run(() => setModelEnabled(db(), actor, z.string().max(40).parse(modelId), z.boolean().parse(enabled)));
  revalidatePath("/admin", "layout");
  return result;
}
