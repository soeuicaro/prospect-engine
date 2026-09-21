import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { BookOpen } from "lucide-react";

export default async function PlaybooksPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: playbooks } = await supabase
    .from("industry_playbooks")
    .select("*, industries(name)")
    .eq("workspace_id", workspace.id);

  type Row = {
    id: string;
    pain_points: string[];
    recommended_offers: string[];
    channels: string[];
    approach_notes: string | null;
    opportunity_signals: string[];
    industries: { name: string } | { name: string }[] | null;
  };
  const rows = (playbooks ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Playbooks por nicho</h1>
        <p className="text-sm text-muted-foreground">
          Dores, ofertas recomendadas, canais e sinais de oportunidade — a abordagem para um restaurante é
          diferente da abordagem para uma clínica.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nenhum playbook cadastrado"
          description="Playbooks são criados automaticamente ao criar o workspace para os nichos iniciais, e podem ser criados para novos nichos em Configurações > Nichos."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((p) => {
            const industry = Array.isArray(p.industries) ? p.industries[0] : p.industries;
            return (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle className="text-base">{industry?.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Dores comuns</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.pain_points.map((pt) => (
                        <Badge key={pt} variant="outline">
                          {pt}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Ofertas recomendadas</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.recommended_offers.map((o) => (
                        <Badge key={o} className="border-0 bg-primary text-primary-foreground">
                          {o}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Sinais de oportunidade</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.opportunity_signals.map((s) => (
                        <Badge key={s} variant="outline" className="border-amber-300 text-amber-700">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {p.approach_notes && (
                    <p className="text-xs text-muted-foreground">{p.approach_notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
