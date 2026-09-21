"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateScoringWeightsAction } from "@/lib/actions/settings";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { ScoringCategoryWeight } from "@/types/database";

const initialState: ActionState = {};

const CATEGORY_LABELS: Record<string, string> = {
  digital_presence: "Presença Digital",
  content_need: "Necessidade de Conteúdo",
  purchase_capacity: "Capacidade de Compra",
  marketing_opportunity: "Oportunidade de Marketing",
  fit: "Aderência ao Negócio",
  size: "Porte",
  local_proximity: "Proximidade Local",
};

export function ScoringWeightsForm({ weights }: { weights: ScoringCategoryWeight[] }) {
  const [state, formAction, pending] = useActionState(updateScoringWeightsAction, initialState);

  useEffect(() => {
    if (state.success) toast.success("Pesos atualizados.");
  }, [state.success]);

  const byCategory = new Map(weights.map((w) => [w.category, w.weight]));
  const total = weights.reduce((sum, w) => sum + w.weight, 0);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Soma atual: {(total * 100).toFixed(0)}%. Os pesos são normalizados automaticamente no cálculo do score.
      </p>
      <div className="grid grid-cols-2 gap-4">
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`weight_${key}`}>{label}</Label>
            <Input
              id={`weight_${key}`}
              name={`weight_${key}`}
              type="number"
              step="0.05"
              min={0}
              max={1}
              defaultValue={byCategory.get(key as never) ?? 0}
            />
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar pesos"}
      </Button>
    </form>
  );
}
