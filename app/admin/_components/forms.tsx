"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  createDeviceAction,
  createSetupCodeAction,
  deleteDeviceAction,
  type FormResult,
  removeAccountAction,
  rotateTokenAction,
  setAccountPausedAction,
  type SetupResult,
  setDeviceStatusAction,
  setModelEnabledAction,
  type TokenResult,
  updateDefaultLimitsAction,
  updateDetailsAction,
  updatePolicyAction,
} from "../(panel)/actions";
import { useActionToast } from "./action-feedback";
import { SetupInstructions, TokenReveal } from "./token-reveal";

/** Field-level errors stay next to the form as well as in the toast, where they're easiest to act on. */
function InlineError({ state }: { state: FormResult | TokenResult | SetupResult }) {
  if (!state || !("error" in state)) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.error}
    </p>
  );
}

/**
 * A destructive action behind a dialog. Replaces window.confirm, which can't explain what is about
 * to happen and looks like a browser warning rather than part of the app.
 */
function ConfirmAction({
  action,
  success,
  trigger,
  title,
  description,
  confirmLabel,
  typeToConfirm,
}: {
  action: (prev: FormResult) => Promise<FormResult>;
  success: string;
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  description: string;
  confirmLabel: string;
  /** Text you must type before confirming, for actions with no undo. */
  typeToConfirm?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmed = !typeToConfirm || typed === typeToConfirm;

  // Called directly rather than through useActionState so the dialog can stay open, and keep its
  // button in a pending state, until the server answers. An action that redirects never returns.
  async function confirm() {
    setPending(true);
    const result = await action(null);
    setPending(false);
    setOpen(false);
    if (result && "error" in result) toast.add({ type: "error", title: "That didn't work", description: result.error });
    else toast.add({ type: "success", title: success });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setTyped("");
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {typeToConfirm && (
          <div className="space-y-1.5">
            <Label htmlFor="type-to-confirm">
              Type <span className="font-mono">{typeToConfirm}</span> to confirm
            </Label>
            <Input
              id="type-to-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending || !confirmed} onClick={confirm}>
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function NewDeviceForm({ baseUrl }: { baseUrl: string }) {
  const [state, action, pending] = useActionState(createDeviceAction, null);
  useActionToast(state);

  if (state && "code" in state) {
    return (
      <div className="space-y-6">
        <p className="text-sm">
          Device <strong>{state.name}</strong> created. On that PC:
        </p>
        <SetupInstructions code={state.code} expiresAt={state.expiresAt} baseUrl={baseUrl} />
        <Link href={`/admin/devices/${state.deviceId}`} className={buttonVariants({ variant: "outline" })}>
          Set its models and limits →
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="e.g. MacBook Air, Office desktop" required maxLength={60} autoFocus />
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" placeholder="Where it lives, who uses it…" maxLength={500} />
      </div>
      <InlineError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create device"}
      </Button>
      <p className="text-xs text-muted-foreground">
        New devices can use every enabled model and get the <Link href="/admin/limits" className="underline underline-offset-2">default limits</Link> until you change them.
      </p>
    </form>
  );
}

export function DetailsForm({ deviceId, name, notes }: { deviceId: string; name: string; notes: string | null }) {
  const [state, action, pending] = useActionState(updateDetailsAction.bind(null, deviceId), null);
  useActionToast(state, "Details saved");
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={name} required maxLength={60} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={notes ?? ""} maxLength={500} />
      </div>
      <InlineError state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

// `usd` fields take dollar amounts with cents; the rest are whole numbers. `fallback` is the
// default a device gets when the field is empty; it is absent on the defaults form itself.
export type LimitField = {
  name: string;
  label: string;
  value: number | null;
  fallback?: number | null;
  hint?: string;
  usd?: boolean;
};

const fmtLimit = (v: number, usd?: boolean) => (usd ? `$${v.toFixed(2)}` : v.toLocaleString("en-US"));

function LimitInputs({ legend, limits }: { legend: string; limits: LimitField[] }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {limits.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={f.name}>{f.label}</Label>
            <Input
              id={f.name}
              name={f.name}
              inputMode={f.usd ? "decimal" : "numeric"}
              placeholder={f.fallback != null ? `Default: ${fmtLimit(f.fallback, f.usd)}` : f.usd ? "Unlimited ($)" : "Unlimited"}
              defaultValue={f.value ?? ""}
              className="font-mono tabular-nums"
            />
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function PolicyForm({
  deviceId,
  models,
  limits,
}: {
  deviceId: string;
  models: { id: string; displayName: string; enabled: boolean; allowed: boolean }[];
  limits: LimitField[];
}) {
  const [state, action, pending] = useActionState(updatePolicyAction.bind(null, deviceId), null);
  useActionToast(state, "Access & limits saved");
  return (
    <form action={action} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Allowed models</legend>
        <div className="flex flex-wrap gap-2">
          {models.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors has-checked:border-foreground/25 has-checked:bg-muted"
            >
              <input type="checkbox" name="models" value={m.id} defaultChecked={m.allowed} className="size-4 accent-primary" />
              {m.displayName}
              {!m.enabled && <span className="text-xs text-muted-foreground">(off globally)</span>}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Claude Code uses Haiku for background tasks (titles, summaries). Blocking it can make those fail.
        </p>
      </fieldset>
      <div className="space-y-2">
        <LimitInputs legend="Limits: leave a field empty to use the default" limits={limits} />
        <p className="text-xs text-muted-foreground">
          A value here replaces the <Link href="/admin/limits" className="underline underline-offset-2">default</Link>, higher or lower.
        </p>
      </div>
      <InlineError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save access & limits"}
      </Button>
    </form>
  );
}

/** The limits every device inherits for the fields it leaves empty. */
export function DefaultLimitsForm({ limits }: { limits: LimitField[] }) {
  const [state, action, pending] = useActionState(updateDefaultLimitsAction, null);
  useActionToast(state, "Default limits saved");
  return (
    <form action={action} className="space-y-6">
      <LimitInputs legend="Leave a field empty for no default limit" limits={limits} />
      <InlineError state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save default limits"}
      </Button>
    </form>
  );
}

/** Connect (or re-connect) a PC as this device via a one-time setup code. */
export function ConnectDevice({ deviceId, connected, baseUrl }: { deviceId: string; connected: boolean; baseUrl: string }) {
  const [setup, generate, generating] = useActionState(createSetupCodeAction.bind(null, deviceId), null);
  const [rotated, rotate, rotating] = useActionState(rotateTokenAction.bind(null, deviceId), null);
  useActionToast(setup);
  useActionToast(rotated);

  return (
    <div className="space-y-4">
      {setup && "code" in setup ? (
        <SetupInstructions code={setup.code} expiresAt={setup.expiresAt} baseUrl={baseUrl} />
      ) : (
        <form action={generate} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {connected
              ? "Moving this device to another PC, or reinstalling? Generate a setup code and run it there. The current PC stops working once the new one connects."
              : "This device isn't connected to a PC yet. Generate a setup code and follow the steps on that PC."}
          </p>
          <InlineError state={setup} />
          <Button type="submit" disabled={generating}>
            {generating ? "Generating…" : "Generate setup code"}
          </Button>
        </form>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Advanced: manual setup with a token
        </summary>
        <div className="mt-3 space-y-3">
          <form action={rotate}>
            <Button type="submit" variant="outline" size="sm" disabled={rotating}>
              {rotating ? "Issuing…" : "Show a new token"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">Issuing a new token stops the current one working immediately.</p>
          {rotated && "token" in rotated && <TokenReveal token={rotated.token} baseUrl={baseUrl} />}
        </div>
      </details>
    </div>
  );
}

export function DeviceControls({ deviceId, name, status }: { deviceId: string; name: string; status: string }) {
  const enabled = status === "enabled";
  const [state, toggle, toggling] = useActionState(
    setDeviceStatusAction.bind(null, deviceId, enabled ? "disabled" : "enabled"),
    null,
  );
  useActionToast(state);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <form action={toggle}>
          <Button type="submit" variant={enabled ? "outline" : "default"} disabled={toggling}>
            {toggling ? "Working…" : enabled ? "Disable device" : "Enable device"}
          </Button>
        </form>
        <ConfirmAction
          action={deleteDeviceAction.bind(null, deviceId)}
          success={`Deleted ${name}`}
          trigger={<Button variant="destructive">Delete</Button>}
          title={`Delete ${name}?`}
          description="Its token is revoked immediately and that PC stops working. Usage and audit history are kept."
          confirmLabel="Delete device"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {enabled
          ? "Disabling blocks every request from this PC but keeps its token, so you can turn it back on."
          : "This device is blocked from making requests."}
      </p>
    </div>
  );
}

export function ModelToggle({ modelId, enabled }: { modelId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(setModelEnabledAction.bind(null, modelId, !enabled), null);
  useActionToast(state);
  return (
    <form action={action}>
      <Button type="submit" size="sm" variant={enabled ? "outline" : "default"} disabled={pending}>
        {pending ? "…" : enabled ? "Disable" : "Enable"}
      </Button>
    </form>
  );
}

/** Takes a TeamClaude account out of rotation, or puts it back. */
export function AccountPauseToggle({ name, paused }: { name: string; paused: boolean }) {
  const [state, action, pending] = useActionState(setAccountPausedAction.bind(null, name, !paused), null);
  useActionToast(state);
  return (
    <form action={action}>
      <Button type="submit" size="sm" variant={paused ? "default" : "outline"} disabled={pending}>
        {pending ? "…" : paused ? "Resume" : "Pause"}
      </Button>
    </form>
  );
}

/** Deletes a TeamClaude account and its saved login, after you type its name. */
export function AccountDelete({ name }: { name: string }) {
  return (
    <ConfirmAction
      action={removeAccountAction.bind(null, name)}
      success={`Deleted ${name}`}
      trigger={
        <Button size="sm" variant="destructive">
          Delete
        </Button>
      }
      title={`Delete ${name}?`}
      description="TeamClaude removes this account from rotation and deletes its saved Claude login. There is no undo: to use it again, sign in with teamclaude login. Pause it instead if you may want it back."
      confirmLabel="Delete account"
      typeToConfirm={name}
    />
  );
}
