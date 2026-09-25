"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

/**
 * Carries a one-off message across a redirect, for actions that finish on a different page
 * (deleting a device sends you back to the overview). The parameter is stripped once shown so a
 * refresh doesn't repeat it.
 */
export function Flash() {
  const params = useSearchParams();
  const router = useRouter();
  const shown = useRef<string | null>(null);
  const deleted = params.get("deleted");

  useEffect(() => {
    if (!deleted || shown.current === deleted) return;
    shown.current = deleted;
    toast.add({ type: "success", title: `Deleted ${deleted}`, description: "Its token was revoked. Usage history is kept." });
    router.replace("/admin");
  }, [deleted, router]);

  return null;
}
