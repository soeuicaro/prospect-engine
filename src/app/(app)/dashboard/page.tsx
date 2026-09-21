import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getDashboardData } from "@/lib/queries/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpportunityBadge, ScoreBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { Building2, TrendingUp } from "lucide-react";

const CARD_DEFS = [
  { key: "totalCompanies", label: "Total de Empresas" },
  { key: "newLeadsLast7Days", label: "Novos Leads (7d)" },
  { key: "qualifiedLeads", label: "Leads Qualificados" },
  { key: "highOpportunity", label: "Alta Oportunidade" },
  { key: "contacted", label: "Contatados" },
  { key: "replies", label: "Respostas" },
  { key: "meetings", label: "Reuniões" },
  { key: "proposals", label: "Propostas" },
  { key: "won", label: "Clientes (Ganho)" },
] as const;

export default async function DashboardPage() {
  const workspace = await requireWorkspace();
  const data = await getDashboardData(workspace.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Quem eu devo prospectar hoje, e por quê.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {CARD_DEFS.map((c) => (
          <Card key={c.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{data[c.key]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Taxa de Resposta</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{data.replyRate ?? "—"}{data.replyRate !== null && "%"}</p>
            <p className="text-xs text-muted-foreground">Contatados → Respondeu</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Taxa de Reunião</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{data.meetingRate ?? "—"}{data.meetingRate !== null && "%"}</p>
            <p className="text-xs text-muted-foreground">Respondeu → Reunião</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Atividade de hoje</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-sm">
              <span className="font-semibold">{data.followupsToday}</span> follow-ups hoje
            </p>
            <p className="text-sm">
              <span className="font-semibold text-destructive">{data.tasksOverdue}</span> tarefas vencidas
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Top Leads
          </CardTitle>
          <Link href="/companies" className="text-sm text-muted-foreground underline underline-offset-4">
            Ver todas as empresas
          </Link>
        </CardHeader>
        <CardContent>
          {data.topLeads.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="Você ainda não possui prospects"
              description="Importe empresas via CSV/CNPJ ou crie manualmente para começar a pontuar e priorizar oportunidades."
              actionLabel="Criar minha primeira busca"
              actionHref="/imports"
            />
          ) : (
            <div className="divide-y">
              {data.topLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/companies/${lead.id}`}
                  className="flex items-center justify-between gap-4 py-3 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{lead.trade_name || lead.legal_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[lead.industry_name, lead.city, lead.state].filter(Boolean).join(" · ")}
                      {lead.next_best_action ? ` — ${lead.next_best_action}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ScoreBadge score={lead.prospect_score} />
                    <OpportunityBadge level={lead.opportunity_level} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
