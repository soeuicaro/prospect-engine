"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateContactLimitsAction } from "@/lib/actions/settings";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const initialState: ActionState = {};

export function ContactLimitsForm({
  limits,
}: {
  limits: { max_contacts_per_day: number; max_new_contacts_per_day: number; max_followups_per_day: number };
}) {
  const [state, formAction, pending] = useActionState(updateContactLimitsAction, initialState);

  useEffect(() => {
    if (state.success) toast.success("Limites atualizados.");
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        O sistema nunca escolhe quantidades automaticamente — estes limites existem para evitar prospecção
        agressiva ou spam.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="max_contacts_per_day">Máx. contatos/dia</Label>
          <Input id="max_contacts_per_day" name="max_contacts_per_day" type="number" defaultValue={limits.max_contacts_per_day} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_new_contacts_per_day">Máx. novos contatos/dia</Label>
          <Input id="max_new_contacts_per_day" name="max_new_contacts_per_day" type="number" defaultValue={limits.max_new_contacts_per_day} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_followups_per_day">Máx. follow-ups/dia</Label>
          <Input id="max_followups_per_day" name="max_followups_per_day" type="number" defaultValue={limits.max_followups_per_day} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar limites"}
      </Button>
    </form>
  );
}
