"use client";

import { useActionState, useRef, useEffect } from "react";
import { addNoteAction, type ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const initialState: ActionState = {};

export function NoteForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(addNoteAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="company_id" value={companyId} />
      <Textarea name="body" placeholder="Adicionar nota interna..." rows={2} required />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Adicionar nota"}
      </Button>
    </form>
  );
}
