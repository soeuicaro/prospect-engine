"use client";

import { useActionState, useRef, useEffect } from "react";
import { createIndustryAction } from "@/lib/actions/catalog";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const initialState: ActionState = {};

export function NewIndustryForm() {
  const [state, formAction, pending] = useActionState(createIndustryAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input name="name" placeholder="Nome do nicho (ex: Cerimonialista)" required />
        <Input name="keywords" placeholder="Palavras-chave (separadas por vírgula)" />
      </div>
      <Input name="pain_points" placeholder="Dores comuns (separadas por vírgula)" />
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="is_visual_segment" />
          Segmento visual
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="recurring_need" defaultChecked />
          Necessidade recorrente
        </label>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Criar nicho"}
      </Button>
    </form>
  );
}
