"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
/**
 * Raises a toast whenever a server action reports back. Actions return a fresh object each run,
 * so comparing identity re-announces repeat saves instead of swallowing them. Omit `success` for
 * actions whose result is already visible on the page — errors still surface.
 */
export function useActionToast(state: unknown, success?: string) {
  const seen = useRef<unknown>(null);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    const error = typeof state === "object" && "error" in state ? String(state.error) : null;
    if (error) toast.add({ type: "error", title: "That didn't work", description: error });
    else if (success) toast.add({ type: "success", title: success });
  }, [state, success]);
}

/** Submit button for forms that post straight to an action, with the pending state wired up. */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
