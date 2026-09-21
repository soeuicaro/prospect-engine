import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CampaignActions } from "@/components/campaigns/campaign-actions";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*, offers(name), message_templates(name), outreach_sequences(name)")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!campaign) notFound();

  const { data: leads } = await supabase
    .from("campaign_leads")
    .select("status, companies(id, trade_name, legal_name, city, company_scores(prospect_score))")
    .eq("campaign_id", id);

  type LeadRow = {
    status: string;
    companies:
      | { id: string; trade_name: string | null; legal_name: string | null; city: string | null; company_scores: { prospect_score: number } | { prospect_score: number }[] | null }
      | { id: string; trade_name: string | null; legal_name: string | null; city: string | null; company_scores: { prospect_score: number } | { prospect_score: number }[] | null }[]
      | null;
  };
  const rows = (leads ?? []) as LeadRow[];
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const queued = rows.filter((r) => r.status === "QUEUED");
  const avgScore = queued.length
    ? Math.round(
        queued.reduce((sum, r) => {
          const c = Array.isArray(r.companies) ? r.companies[0] : r.companies;
          const s = Array.isArray(c?.company_scores) ? c?.company_scores[0] : c?.company_scores;
          return sum + (s?.prospect_score ?? 0);
        }, 0) / queued.length
      )
    : 0;

  const offer = Array.isArray(campaign.offers) ? campaign.offers[0] : campaign.offers;
  const template = Array.isArray(campaign.message_templates) ? campaign.message_templates[0] : campaign.message_templates;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[...(campaign.cities ?? []), campaign.state].filter(Boolean).join(", ")}
          </p>
        </div>
        <Badge variant="outline">{campaign.status}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Na fila" value={counts.QUEUED ?? 0} />
        <SummaryCard label="Suprimidos" value={counts.SKIPPED_SUPPRESSED ?? 0} />
        <SummaryCard label="Sem contato" value={counts.SKIPPED_NO_CONTACT ?? 0} />
        <SummaryCard label="Score médio" value={avgScore} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">Score mínimo:</span> {campaign.min_score}
          </p>
          <p>
            <span className="text-muted-foreground">Meta:</span> {campaign.target_count ?? "sem limite"}
          </p>
          <p>
            <span className="text-muted-foreground">Oferta:</span> {offer?.name ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Template:</span> {template?.name ?? "—"}
          </p>
        </CardContent>
      </Card>

      <CampaignActions campaignId={campaign.id} status={campaign.status} hasAudience={rows.length > 0} />

      <Card>
        <CardHeader>
          <CardTitle>Prospects na campanha</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {queued.slice(0, 50).map((r) => {
            const c = Array.isArray(r.companies) ? r.companies[0] : r.companies;
            if (!c) return null;
            return (
              <Link key={c.id} href={`/companies/${c.id}`} className="flex items-center justify-between py-2 hover:bg-muted/40">
                <span>{c.trade_name || c.legal_name}</span>
                <span className="text-xs text-muted-foreground">{c.city}</span>
              </Link>
            );
          })}
          {rows.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Nenhum prospect ainda — clique em &ldquo;Montar audiência&rdquo; acima.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
