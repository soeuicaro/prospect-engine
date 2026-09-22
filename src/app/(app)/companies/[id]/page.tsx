import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getCompanyDetail } from "@/lib/queries/company-detail";
import { formatCnpj } from "@/lib/domain/cnpj";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ScoreBadge,
  OpportunityBadge,
  ConfidenceBadge,
  TemperatureBadge,
} from "@/components/shared/badges";
import { StageSelector } from "@/components/companies/stage-selector";
import { RefreshScoreButton } from "@/components/companies/refresh-score-button";
import { MapsActions } from "@/components/companies/maps-actions";
import { DataProvenance } from "@/components/companies/data-provenance";
import { ContactActions } from "@/components/shared/contact-actions";
import { NoteForm } from "@/components/companies/note-form";
import { TaskForm } from "@/components/companies/task-form";
import { FollowupForm } from "@/components/companies/followup-form";
import { OutreachPanel } from "@/components/companies/outreach-panel";
import { AnalyzeWebsiteButton } from "@/components/companies/analyze-website-button";
import { TaskList } from "@/components/companies/task-list";
import { FollowupList } from "@/components/companies/followup-list";
import { ArchiveDeleteMenu } from "@/components/companies/archive-delete-menu";
import { formatDistanceToNow } from "@/lib/utils-date";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const detail = await getCompanyDetail(workspace.id, id);
  const { company, scores, scoreFactors, contacts, sources, social, analysis } = detail;

  const decisionMakers = contacts.filter((c) =>
    ["SOCIO", "DECISOR_ESTIMADO", "RESPONSAVEL_CADASTRAL"].includes(c.contact_type)
  );
  const commercialContacts = contacts.filter((c) => c.contact_type === "CONTATO_COMERCIAL");

  const recommendedOffers = detail.offers
    .filter((o) => !o.industry_id || o.industry_id === company.industry_id)
    .sort((a, b) => (a.industry_id === company.industry_id ? -1 : 0) - (b.industry_id === company.industry_id ? -1 : 0))
    .slice(0, 3);

  const businessProfile = workspace.business_profile;
  const primaryContact = decisionMakers[0] ?? commercialContacts[0] ?? null;
  const topContentIdea = detail.contentIdeas[0] ?? null;

  const templateVariables = {
    first_name: primaryContact?.name?.split(" ")[0] ?? null,
    company_name: company.trade_name ?? company.legal_name,
    trade_name: company.trade_name,
    industry: company.industries && !Array.isArray(company.industries) ? company.industries.name : null,
    city: company.city,
    state: company.state,
    website: company.website,
    instagram: social.find((s) => s.channel === "instagram" && s.status === "FOUND")?.handle_or_url ?? null,
    offer: recommendedOffers[0]?.name ?? null,
    observation: detail.industryPlaybook?.pain_points?.[0]
      ? `notei que ${detail.industryPlaybook.pain_points[0].toLowerCase()}`
      : null,
    pain_point: detail.industryPlaybook?.pain_points?.[0] ?? null,
    content_idea: topContentIdea?.title ?? null,
    sender_name: businessProfile.sender_name ?? null,
  };

  const industry = company.industries && !Array.isArray(company.industries) ? company.industries : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {company.trade_name || company.legal_name || "Sem nome"}
            </h1>
            <TemperatureBadge temperature={company.lead_temperature} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[industry?.name, company.city, company.state].filter(Boolean).join(" · ")}
          </p>
          <ContactActions
            className="mt-2"
            target={{
              name: company.trade_name,
              legalName: company.legal_name,
              street: company.street,
              houseNumber: company.street_number,
              neighborhood: company.neighborhood,
              city: company.city,
              state: company.state,
              lat: company.latitude !== null ? Number(company.latitude) : null,
              lon: company.longitude !== null ? Number(company.longitude) : null,
              website: company.website,
              phone: company.phone,
              whatsapp: company.whatsapp,
              email: company.email,
              socials: Object.fromEntries(
                social
                  .filter((s) => s.status === "FOUND" && s.handle_or_url && s.channel !== "whatsapp" && s.channel !== "other")
                  .map((s) => [s.channel, s.handle_or_url as string])
              ),
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <RefreshScoreButton companyId={company.id} />
          <ArchiveDeleteMenu companyId={company.id} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Prospect Score</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <ScoreBadge score={scores?.prospect_score} />
            <OpportunityBadge level={scores?.opportunity_level ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Etapa do funil</CardTitle>
          </CardHeader>
          <CardContent>
            <StageSelector companyId={company.id} currentStageId={company.pipeline_stage_id} stages={detail.allStages} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Qualidade dos dados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{company.data_quality_score}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Próxima ação</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{company.next_best_action || "Enviar primeiro contato"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Identidade</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Razão social" value={company.legal_name} />
              <Field label="CNPJ" value={formatCnpj(company.cnpj) ?? "Não informado"} />
              <Field label="Situação" value={company.cnpj_status ?? "UNKNOWN"} />
              <Field label="Porte oficial" value={company.official_size?.value ?? "Não informado"} />
              <Field
                label="Tamanho estimado"
                value={
                  company.estimated_size
                    ? `${company.estimated_size} (${company.estimated_size_confidence})`
                    : "Não estimado"
                }
              />
              <Field label="Data de abertura" value={company.opened_at ?? "Não informado"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Endereço</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                {[company.street, company.street_number, company.neighborhood, company.city, company.state]
                  .filter(Boolean)
                  .join(", ") || "Endereço não informado"}
              </p>
              <MapsActions
                companyId={company.id}
                company={{
                  trade_name: company.trade_name,
                  legal_name: company.legal_name,
                  street: company.street,
                  street_number: company.street_number,
                  neighborhood: company.neighborhood,
                  city: company.city,
                  state: company.state,
                  latitude: company.latitude !== null ? Number(company.latitude) : null,
                  longitude: company.longitude !== null ? Number(company.longitude) : null,
                }}
                validationStatus={company.maps_validation_status}
                validatedAt={company.maps_last_validated_at}
                note={company.maps_validation_note}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decisores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {contacts.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum contato identificado ainda.</p>
              )}
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{c.name || "Nome não identificado"}</p>
                    <p className="text-xs text-muted-foreground">
                      {contactTypeLabel(c.contact_type)} {c.role ? `· ${c.role}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.phone, c.email].filter(Boolean).join(" · ") || "Sem canal direto"}
                    </p>
                  </div>
                  <ConfidenceBadge confidence={c.confidence} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Presença Digital & Análise</CardTitle>
              <AnalyzeWebsiteButton companyId={company.id} hasWebsite={Boolean(company.website)} />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Website" value={company.website ?? "Não identificado"} />
                <Field label="Status do site" value={analysis?.website_status ?? "UNKNOWN"} />
              </div>
              <div className="flex flex-wrap gap-2">
                {social.map((s) => (
                  <Badge key={s.id} variant="outline">
                    {s.channel}: {s.status === "FOUND" ? s.handle_or_url : statusLabel(s.status)}
                  </Badge>
                ))}
              </div>
              {analysis?.website_flags && analysis.website_flags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {analysis.website_flags.map((f) => (
                    <Badge key={f} variant="outline" className="border-amber-300 text-amber-700">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
              {!analysis && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma análise de site/redes executada ainda para esta empresa.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por que este lead?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {scoreFactors.length === 0 && (
                <p className="text-sm text-muted-foreground">Score ainda não calculado — clique em Refresh Lead.</p>
              )}
              {scoreFactors.map((f) => (
                <div key={f.id} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{f.factor_label}</p>
                    <p className="text-xs text-muted-foreground">{f.evidence}</p>
                  </div>
                  <Badge variant="outline">+{f.points.toFixed(0)}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Oferta recomendada & Ideias de conteúdo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {recommendedOffers.map((o) => (
                  <Badge key={o.id} className="border-0 bg-primary text-primary-foreground">
                    {o.name}
                  </Badge>
                ))}
                {recommendedOffers.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma oferta mapeada para este nicho ainda.</p>
                )}
              </div>
              <Separator />
              <div className="space-y-2">
                {detail.contentIdeas.slice(0, 4).map((idea) => (
                  <div key={idea.id}>
                    <p className="text-sm font-medium">{idea.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {idea.format} · {idea.objective}
                    </p>
                  </div>
                ))}
                {detail.contentIdeas.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma ideia de conteúdo cadastrada para este nicho.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mensagem sugerida</CardTitle>
            </CardHeader>
            <CardContent>
              <OutreachPanel
                companyId={company.id}
                templates={detail.templates}
                variables={templateVariables}
                phone={company.phone}
                whatsapp={company.whatsapp}
                email={company.email}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Follow-ups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FollowupList followups={detail.followups} />
              <FollowupForm companyId={company.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tarefas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TaskList tasks={detail.tasks} />
              <TaskForm companyId={company.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.stageHistory.slice(0, 8).map((h) => (
                <p key={h.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{h.to?.label ?? "—"}</span>{" "}
                  {formatDistanceToNow(h.changed_at)}
                </p>
              ))}
              {detail.stageHistory.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dados encontrados por</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {sources.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      {s.source_url ? (
                        <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="underline">
                          {s.source_name}
                        </a>
                      ) : (
                        s.source_name
                      )}
                      <span className="text-muted-foreground"> · {formatDistanceToNow(s.collected_at)}</span>
                    </span>
                    <ConfidenceBadge confidence={s.confidence} />
                  </div>
                ))}
                {sources.length === 0 && <p className="text-xs text-muted-foreground">Sem fontes registradas.</p>}
              </div>
              <Separator />
              <DataProvenance companyId={company.id} provenance={company.field_provenance} conflicts={company.data_conflicts} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.notes.map((n) => (
                <div key={n.id} className="border-b pb-2 text-sm last:border-0">
                  <p>{n.body}</p>
                  <p className="text-xs text-muted-foreground">{formatDistanceToNow(n.created_at)}</p>
                </div>
              ))}
              <NoteForm companyId={company.id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="pt-2">
        <Link href="/companies" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Voltar para empresas
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value || "—"}</p>
    </div>
  );
}

function contactTypeLabel(type: string) {
  return (
    {
      RESPONSAVEL_CADASTRAL: "Responsável cadastral",
      SOCIO: "Sócio",
      DECISOR_ESTIMADO: "Possível decisor",
      CONTATO_COMERCIAL: "Contato comercial",
    }[type] ?? type
  );
}

function statusLabel(status: string) {
  return { NOT_FOUND: "Não encontrado", UNKNOWN: "Não verificado", NOT_CHECKED: "Não verificado" }[status] ?? status;
}
