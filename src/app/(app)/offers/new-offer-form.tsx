"use client";

import { useActionState, useRef, useEffect } from "react";
import { createOfferAction } from "@/lib/actions/catalog";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/shared/native-select";

const initialState: ActionState = {};

export function NewOfferForm({ industries }: { industries: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createOfferAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Input name="name" placeholder="Nome da oferta" required className="col-span-2" />
        <NativeSelect name="offer_type" defaultValue="recurring">
          <option value="recurring">Recorrente</option>
          <option value="one_off">Pontual</option>
        </NativeSelect>
        <NativeSelect name="industry_id" defaultValue="">
          <option value="">Nicho (opcional)</option>
          {industries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Textarea name="description" placeholder="Descrição da oferta" rows={2} />
      <Textarea name="argument" placeholder="Argumento de venda" rows={2} />
      <div className="grid grid-cols-2 gap-3">
        <Input name="ticket_min" type="number" placeholder="Ticket mínimo (R$)" />
        <Input name="ticket_max" type="number" placeholder="Ticket máximo (R$)" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Salvando..." : "Salvar oferta"}
      </Button>
    </form>
  );
}
