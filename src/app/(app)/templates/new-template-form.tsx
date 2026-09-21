"use client";

import { useActionState, useRef, useEffect } from "react";
import { createTemplateAction } from "@/lib/actions/catalog";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/shared/native-select";

const initialState: ActionState = {};

export function NewTemplateForm({ industries }: { industries: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createTemplateAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Input name="name" placeholder="Nome do template" required className="col-span-2" />
        <NativeSelect name="industry_id" defaultValue="">
          <option value="">Nicho (opcional)</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="channel" defaultValue="whatsapp">
          <option value="whatsapp">WhatsApp</option>
          <option value="email">E-mail</option>
          <option value="phone_script">Script de ligação</option>
          <option value="instagram">Instagram</option>
          <option value="linkedin">LinkedIn</option>
        </NativeSelect>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <NativeSelect name="stage" defaultValue="first_contact" className="col-span-1">
          <option value="first_contact">Primeiro contato</option>
          <option value="followup_1">Follow-up 1</option>
          <option value="followup_2">Follow-up 2</option>
          <option value="followup_3">Follow-up 3</option>
          <option value="custom">Custom</option>
        </NativeSelect>
        <Input name="subject" placeholder="Assunto (para e-mail)" className="col-span-3" />
      </div>
      <Textarea
        name="body"
        rows={4}
        required
        placeholder="Olá, {first_name}! Vi a {company_name} e {observation}. Tive uma ideia: {content_idea}."
      />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Salvar template"}
      </Button>
    </form>
  );
}
