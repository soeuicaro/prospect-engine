"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { useEffect } from "react";
import { updateBusinessProfileAction } from "@/lib/actions/settings";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/shared/native-select";
import type { Workspace } from "@/types/database";

const initialState: ActionState = {};

export function BusinessProfileForm({ workspace }: { workspace: Workspace }) {
  const [state, formAction, pending] = useActionState(updateBusinessProfileAction, initialState);

  useEffect(() => {
    if (state.success) toast.success("Perfil atualizado.");
  }, [state.success]);

  const bp = workspace.business_profile;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome do workspace</Label>
          <Input id="name" name="name" defaultValue={workspace.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">Cidade base</Label>
          <Input id="city" name="city" defaultValue={workspace.city ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">UF</Label>
          <Input id="state" name="state" maxLength={2} defaultValue={workspace.state ?? ""} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="commercial_name">Nome comercial</Label>
          <Input id="commercial_name" name="commercial_name" defaultValue={bp.commercial_name ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sender_name">Nome do vendedor (assinatura)</Label>
          <Input id="sender_name" name="sender_name" defaultValue={bp.sender_name ?? ""} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descrição / serviços</Label>
        <Textarea id="description" name="description" defaultValue={bp.description ?? ""} rows={2} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="services">Serviços (separados por vírgula)</Label>
          <Input id="services" name="services" defaultValue={(bp.services ?? []).join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="regions">Regiões atendidas (separadas por vírgula)</Label>
          <Input id="regions" name="regions" defaultValue={(bp.regions ?? []).join(", ")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input id="phone" name="phone" defaultValue={bp.phone ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" defaultValue={bp.email ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" defaultValue={bp.website ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="instagram">Instagram</Label>
          <Input id="instagram" name="instagram" defaultValue={bp.instagram ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input id="whatsapp" name="whatsapp" defaultValue={bp.whatsapp ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tone_of_voice">Tom de voz</Label>
          <NativeSelect id="tone_of_voice" name="tone_of_voice" defaultValue={workspace.tone_of_voice} className="w-full">
            <option value="direto">Direto</option>
            <option value="amigavel">Amigável</option>
            <option value="profissional">Profissional</option>
            <option value="premium">Premium</option>
            <option value="consultivo">Consultivo</option>
            <option value="descontraido">Descontraído</option>
          </NativeSelect>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar perfil"}
      </Button>
    </form>
  );
}
