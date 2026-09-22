"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBadge } from "@/components/shared/badges";
import { ContactActions } from "@/components/shared/contact-actions";
import { changeStageAction } from "@/lib/actions/companies";
import type { PipelineCard } from "@/lib/queries/pipeline";

interface Stage {
  id: string;
  key: string;
  label: string;
  color: string | null;
  position: number;
  kind: string;
}

export function PipelineBoard({ stages, initialCards }: { stages: Stage[]; initialCards: PipelineCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);

  function handleDrop(stageId: string) {
    if (!dragging) return;
    const cardId = dragging;
    setDragging(null);
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, pipeline_stage_id: stageId } : c)));
    startTransition(async () => {
      const res = await changeStageAction(cardId, stageId);
      if (res.error) toast.error(res.error);
    });
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const stageCards = cards.filter((c) => c.pipeline_stage_id === stage.id);
        return (
          <div
            key={stage.id}
            className="w-72 shrink-0"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stage.id)}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold" style={stage.color ? { color: stage.color } : undefined}>
                {stage.label}
              </h3>
              <span className="text-xs text-muted-foreground">{stageCards.length}</span>
            </div>
            <div className="min-h-[120px] space-y-2 rounded-md bg-muted/30 p-2">
              {stageCards.map((card) => (
                <Card
                  key={card.id}
                  draggable
                  onDragStart={() => setDragging(card.id)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm">
                      <Link href={`/companies/${card.id}`} className="hover:underline">
                        {card.trade_name || card.legal_name || "Sem nome"}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between pb-3">
                    <span className="text-xs text-muted-foreground">
                      {[card.city, card.state].filter(Boolean).join("/")}
                    </span>
                    <ScoreBadge score={card.prospect_score} />
                  </CardContent>
                  <CardContent className="pb-3 pt-0">
                    <ContactActions
                      compact
                      target={{
                        name: card.trade_name,
                        legalName: card.legal_name,
                        street: card.street,
                        houseNumber: card.street_number,
                        city: card.city,
                        state: card.state,
                        lat: card.latitude,
                        lon: card.longitude,
                        website: card.website,
                        phone: card.phone,
                        whatsapp: card.whatsapp,
                        email: card.email,
                      }}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
