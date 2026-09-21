"use client";

import { useActionState } from "react";
import { createCampaignAction } from "@/lib/actions/campaigns";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/shared/native-select";

const initialState: ActionState = {};

export function NewCampaignForm({
  industries,
  offers,
  templates,
  sequences,
}: {
  industries: { id: string; name: string }[];
  offers: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createCampaignAction, initialState);

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da campanha</Label>
            <Input id="name" name="name" placeholder="Ex: Restaurantes Sobral" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cities">Cidade(s)</Label>
              <Input id="cities" name="cities" placeholder="Sobral" required />
              <p className="text-xs text-muted-foreground">Para múltiplas cidades, crie a campanha e edite depois.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">UF</Label>
              <Input id="state" name="state" maxLength={2} placeholder="CE" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="niches">Nichos</Label>
            <select id="niches" name="niches" multiple required className="h-32 w-full rounded-md border bg-transparent p-2 text-sm">
              {industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Ctrl/Cmd + clique para selecionar múltiplos.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min_score">Score mínimo</Label>
              <Input id="min_score" name="min_score" type="number" min={0} max={100} defaultValue={60} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target_count">Quantidade desejada</Label>
              <Input id="target_count" name="target_count" type="number" min={1} placeholder="100" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer_id">Oferta</Label>
            <NativeSelect id="offer_id" name="offer_id" className="w-full" defaultValue="">
              <option value="">Selecione...</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="template_id">Template</Label>
              <NativeSelect id="template_id" name="template_id" className="w-full" defaultValue="">
                <option value="">Selecione...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sequence_id">Sequência</Label>
              <NativeSelect id="sequence_id" name="sequence_id" className="w-full" defaultValue="">
                <option value="">Nenhuma</option>
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Criando..." : "Criar campanha (rascunho)"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
