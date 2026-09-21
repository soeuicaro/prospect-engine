"use client";

import { useActionState, useRef, useState, useEffect } from "react";
import { scheduleFollowupAction, type ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: ActionState = {};

export function FollowupForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(scheduleFollowupAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  const [defaultDate] = useState(() => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16));

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="company_id" value={companyId} />
      <Input name="follow_up_at" type="datetime-local" defaultValue={defaultDate} required className="w-52" />
      <div className="flex-1 min-w-[180px]">
        <Input name="note" placeholder="Nota (opcional)" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Agendando..." : "Agendar follow-up"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
