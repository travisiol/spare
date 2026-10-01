"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/server/actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** A form bound to a server action, with its result announced underneath. */
export function ActionForm({
  action,
  children,
  className,
  hidden,
  quiet = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  hidden?: Record<string, string>;
  /** Hide the success line (errors always show). */
  quiet?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      {(state.error || (!quiet && state.ok)) && (
        <p role={state.error ? "alert" : "status"} className={`mt-3 text-sm font-medium ${state.error ? "text-ember" : "text-muted"}`}>
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, className = "btn btn-primary", pendingLabel, disabled }: { children: React.ReactNode; className?: string; pendingLabel?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/** Re-reads server data while a batch is moving through funding, execution or settlement. */
export function AutoRefresh({ active, everyMs = 1500 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
