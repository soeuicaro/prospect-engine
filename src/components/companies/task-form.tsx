"use client";

import { useActionState, useRef, useEffect } from "react";
import { addTaskAction, type ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/shared/native-select";

const initialState: ActionState = {};

export function TaskForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState(addTaskAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="company_id" value={companyId} />
      <div className="flex-1 min-w-[180px]">
        <Input name="title" placeholder="Ex: Ligar para confirmar reunião" required />
      </div>
      <Input name="due_at" type="datetime-local" className="w-52" />
      <NativeSelect name="priority" defaultValue="MEDIUM" className="w-32">
        <option value="LOW">Baixa</option>
        <option value="MEDIUM">Média</option>
        <option value="HIGH">Alta</option>
        <option value="URGENT">Urgente</option>
      </NativeSelect>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Adicionar tarefa"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
