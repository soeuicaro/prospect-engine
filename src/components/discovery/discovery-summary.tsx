"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getSourceDefinition } from "@/lib/discovery/registry";
import { COMPLETENESS_WEIGHTS, completenessBreakdown } from "@/lib/discovery/completeness";
import { formatSeconds } from "@/lib/utils-date";
import type { SearchContext, SearchResponse, SourceKey, UnifiedCompany } from "@/lib/discovery/types";
import { RunStatusBadge } from "./badges";

export interface EnrichProgress {
  done: number;
  running: number;
  total: number;
  failed: number;
  startedAt: number | null;
  /** When the last batch finished — basis for the remaining-time estimate. */
  updatedAt?: number;
}

export const COMPLETENESS_FIELD_LABEL: Record<keyof typeof COMPLETENESS_WEIGHTS, string> = {
  cnpj: "CNPJ",
  name: "Nome",
  address: "Endereço",
  phone: "Telefone/WhatsApp",
  email: "E-mail",
  website: "Site",
  social: "Rede social",
  decisionMaker: "Dono/sócio",
};

const OUTCOME_STYLE: Record<SearchResponse["outcome"], string> = {
  SUCCESS: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
  SUCCESS_WITH_WARNINGS: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
  PARTIAL: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
  NO_RESULTS: "border-zinc-300 bg-muted text-foreground",
  FAILED: "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100",
};

export function DiscoverySummary({
  response,
  results,
  enrich,
  onSuggestion,
  onRetry,
  onRefreshSource,
}: {
  response: SearchResponse;
  results: UnifiedCompany[];
  enrich: EnrichProgress;
  onSuggestion: (patch: Partial<SearchContext>) => void;
  onRetry: () => void;
  onRefreshSource: (source: SourceKey) => void;
}) {
  const few = results.length < 5;
  const [showDiag, setShowDiag] = useState(few || response.outcome === "NO_RESULTS");
  const [showSources, setShowSources] = useState(response.outcome !== "SUCCESS");
  const s = {
    withPhone: results.filter((c) => c.phone || c.whatsapp).length,
    withWebsite: results.filter((c) => c.website).length,
    withInstagram: results.filter((c) => c.socials.instagram).length,
    withCnpj: results.filter((c) => c.cnpj).length,
    withEmail: results.filter((c) => c.email).length,
  };
  const activeFilters = response.diagnostics.filters.filter((f) => f.active);
  const failedRuns = response.sourceRuns.filter((r) => /ERROR|TIMEOUT|RATE_LIMITED|BLOCKED|CIRCUIT/.test(r.status));
  const overtureMissing = response.sourceRuns.some((r) => r.source === "places_overture" && r.warnings.some((w) => w.includes("ainda não foi importada")));

  return (
    <div className="space-y-4">
      {response.userMessages.length > 0 && (
        <div className={`space-y-1 rounded-md border p-3 text-sm ${OUTCOME_STYLE[response.outcome]}`}>
          {response.userMessages.map((m, i) => (
            <p key={i} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {m}
            </p>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            {failedRuns.length > 0 && (
              <Button size="xs" variant="outline" onClick={() => setShowSources(true)}>
                Ver detalhes
              </Button>
            )}
            {(response.outcome === "PARTIAL" || failedRuns.length > 0) && (
              <Button size="xs" variant="outline" onClick={onRetry}>
                Tentar novamente
              </Button>
            )}
            <Button size="xs" variant="ghost" asChild>
              <Link href="/settings/sources">Ver status das fontes</Link>
            </Button>
          </div>
        </div>
      )}

      {overtureMissing && (
        <div className="space-y-1 rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-100">
          <p className="font-medium">
            {response.context.city}/{response.context.state} ainda não tem os locais do Overture Maps (a fonte que mais traz empresas, grátis).
          </p>
          <p className="text-xs">
            Rode uma vez no terminal do projeto (~20 s por cidade):{" "}
            <code className="rounded bg-background px-1 py-0.5">
              npm run places:sync -- --uf {response.context.state} --municipio &quot;{response.context.city}&quot;
            </code>{" "}
            e depois clique em Refresh.
          </p>
        </div>
      )}

      {response.outcome === "NO_RESULTS" || results.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-sm font-medium">Não encontramos empresas suficientes com os filtros atuais.</p>
            <SuggestionButtons response={response} onSuggestion={onSuggestion} onDiagnostic={() => setShowDiag(true)} centered />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
          <Stat label="Encontradas" value={response.summary.found} hint="registros brutos somando todas as fontes" />
          <Stat label="Únicas" value={results.length} hint="após deduplicação e filtros visíveis" strong />
          <Stat label="Com telefone" value={s.withPhone} />
          <Stat label="Com website" value={s.withWebsite} />
          <Stat label="Com Instagram" value={s.withInstagram} />
          <Stat label="Com CNPJ" value={s.withCnpj} />
          <Stat label="Com e-mail" value={s.withEmail} />
          <Stat label="Já no pipeline" value={results.filter((c) => c.inPipeline).length} />
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 pt-4 text-xs">
            <p className="text-muted-foreground">Cobertura (dentro das fontes disponíveis)</p>
            <p className="text-lg font-semibold">
              {response.coverage.found} / {response.coverage.requested} <span className="text-sm text-muted-foreground">({response.coverage.percent}%)</span>
            </p>
            <Progress value={response.coverage.percent} />
            {results.length > response.context.limit && (
              <p className="text-muted-foreground">Encontramos mais que a meta — a tabela permite ver o top {response.context.limit} ou todas.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-4 text-xs">
            <p className="text-muted-foreground">Discovery Quality Score</p>
            <p className="text-lg font-semibold">{response.qualityScore}/100</p>
            <p className="text-muted-foreground">
              {response.durationMs ? `${(response.durationMs / 1000).toFixed(1)}s` : ""} · {response.counts.duplicates} duplicatas consolidadas ·{" "}
              {response.summary.needsReview} para revisão
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-4 text-xs">
            <p className="text-muted-foreground">Enriquecimento (CNPJ → site oficial)</p>
            {enrich.total ? (
              <>
                <p className="text-lg font-semibold">
                  {enrich.done} enriquecidas <span className="text-sm text-muted-foreground">· {enrich.running} em processamento{enrich.failed ? ` · ${enrich.failed} falharam` : ""}</span>
                </p>
                <Progress value={((enrich.done + enrich.failed) / enrich.total) * 100} />
                <EnrichEta enrich={enrich} />
              </>
            ) : (
              <p className="text-muted-foreground">
                {response.context.depth === "FAST" || response.context.autoEnrichTop === 0
                  ? "Desativado nesta busca — use o botão “Enriquecer” em cada linha."
                  : `${results.filter((r) => r.enrichment.state === "DONE").length} já enriquecidas.`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <CompletenessExplainer results={results} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Filtros ativos:</span>
        {activeFilters.length === 0 && <span className="text-muted-foreground">nenhum (dados faltantes nunca removem empresas)</span>}
        {activeFilters.map((f) => (
          <span key={f.key} className="rounded border px-1.5 py-0.5">
            {f.label} — {f.removed} removida(s)
          </span>
        ))}
        {response.diagnostics.broadeningApplied.length > 0 && (
          <span className="rounded border border-sky-300 px-1.5 py-0.5 text-sky-700">
            Variações aplicadas automaticamente: {response.diagnostics.broadeningApplied.join(" · ")}
          </span>
        )}
      </div>

      <Card>
        <CardHeader className="cursor-pointer py-3" onClick={() => setShowSources((v) => !v)}>
          <CardTitle className="flex items-center gap-2 text-sm">
            {showSources ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Fontes consultadas
            <span className="flex flex-wrap gap-1">
              {response.sourceRuns.map((r) => (
                <span key={r.source} className="inline-flex items-center gap-1 text-xs font-normal">
                  {getSourceDefinition(r.source).shortLabel} <RunStatusBadge status={r.status} />
                </span>
              ))}
            </span>
          </CardTitle>
        </CardHeader>
        {showSources && (
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Fonte</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3">Brutos</th>
                  <th className="pr-3">Descartados</th>
                  <th className="pr-3">Duplicados</th>
                  <th className="pr-3">Filtrados</th>
                  <th className="pr-3">Aceitos</th>
                  <th className="pr-3">Tempo</th>
                  <th className="pr-3">Estratégia</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {response.funnel.map((f) => {
                  const run = response.sourceRuns.find((r) => r.source === f.source);
                  return (
                    <tr key={f.source} className="border-t align-top">
                      <td className="py-1.5 pr-3 font-medium">
                        {getSourceDefinition(f.source).label}
                        {f.isFallback && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">fallback</span>}
                        {run?.userMessage && /ERROR|TIMEOUT|RATE|BLOCKED|CIRCUIT|PARTIAL/.test(f.status) && (
                          <p className="font-normal text-muted-foreground">{run.userMessage}</p>
                        )}
                        {run?.warnings.map((w, i) => (
                          <p key={i} className="font-normal text-muted-foreground">
                            ⚠ {w}
                          </p>
                        ))}
                      </td>
                      <td className="pr-3">
                        <RunStatusBadge status={f.status} />
                      </td>
                      <td className="pr-3">{f.returned}</td>
                      <td className="pr-3">{f.invalid}</td>
                      <td className="pr-3">{f.duplicate}</td>
                      <td className="pr-3">{f.filtered}</td>
                      <td className="pr-3 font-semibold">{f.accepted}</td>
                      <td className="pr-3">{(f.durationMs / 1000).toFixed(1)}s</td>
                      <td className="pr-3">{f.strategy ?? "—"}</td>
                      <td>
                        {response.searchId && (
                          <Button size="xs" variant="ghost" onClick={() => onRefreshSource(f.source)} title="Consulta só esta fonte de novo e consolida com o resultado atual">
                            Atualizar fonte
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>

      {(few || response.suggestions.length > 0) && (
        <Card>
          <CardHeader className="cursor-pointer py-3" onClick={() => setShowDiag((v) => !v)}>
            <CardTitle className="flex items-center gap-2 text-sm">
              {showDiag ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <Info className="size-4" /> Por que encontrei {few ? "poucos" : "esse número"}? · <Sparkles className="size-4" /> Como ampliar a busca?
            </CardTitle>
          </CardHeader>
          {showDiag && (
            <CardContent className="space-y-3 text-sm">
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {response.diagnostics.lowResultReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Termos: {response.diagnostics.appliedTerms.join(", ") || "—"} · Tags OSM: {response.diagnostics.appliedOsmTags.join(", ") || "—"} · CNAEs:{" "}
                {response.diagnostics.appliedCnaes.join(", ") || "—"}
              </p>
              <SuggestionButtons response={response} onSuggestion={onSuggestion} />
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function SuggestionButtons({
  response,
  onSuggestion,
  onDiagnostic,
  centered,
}: {
  response: SearchResponse;
  onSuggestion: (patch: Partial<SearchContext>) => void;
  onDiagnostic?: () => void;
  centered?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${centered ? "justify-center" : ""}`}>
      {response.suggestions.map((s) => (
        <Button key={s.kind + s.label} size="sm" variant="outline" onClick={() => onSuggestion(s.patch)} title={s.description}>
          {s.label}
        </Button>
      ))}
      {onDiagnostic && (
        <Button size="sm" variant="ghost" onClick={onDiagnostic}>
          Ver diagnóstico
        </Button>
      )}
    </div>
  );
}

function EnrichEta({ enrich }: { enrich: EnrichProgress }) {
  const processed = enrich.done + enrich.failed;
  const remaining = enrich.total - processed;
  if (!remaining) return <p className="text-muted-foreground">Concluído.</p>;
  if (!enrich.startedAt || !enrich.updatedAt || !processed) return <p className="text-muted-foreground">Calculando tempo restante...</p>;
  const perItem = (enrich.updatedAt - enrich.startedAt) / 1000 / processed;
  return <p className="text-muted-foreground">~{formatSeconds(perItem * remaining)} restantes ({remaining} na fila)</p>;
}

/**
 * Explains the completeness score with the points table and a real example
 * from this search (the weakest record), so "Fraco 35%" is actionable.
 */
function CompletenessExplainer({ results }: { results: UnifiedCompany[] }) {
  const [open, setOpen] = useState(false);
  if (!results.length) return null;
  const weak = results.filter((c) => c.completenessLabel === "FRACO").length;
  const partial = results.filter((c) => c.completenessLabel === "PARCIAL").length;
  const example = [...results].sort((a, b) => a.completeness - b.completeness)[0];
  const breakdown = completenessBreakdown(example);
  const keys = Object.keys(COMPLETENESS_WEIGHTS) as (keyof typeof COMPLETENESS_WEIGHTS)[];
  const missing = keys.filter((k) => !breakdown[k]);
  return (
    <Card>
      <CardHeader className="cursor-pointer py-3" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Como funciona a completude?
          <span className="text-xs font-normal text-muted-foreground">
            🟢 {results.length - weak - partial} completas · 🟡 {partial} parciais · 🔴 {weak} fracas
          </span>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-4 text-xs md:grid-cols-2">
          <div className="space-y-1">
            <p>
              Cada empresa começa em 0% e ganha pontos por dado encontrado. <strong>🟢 Completo ≥ 75%</strong> · <strong>🟡 Parcial ≥ 45%</strong> ·{" "}
              <strong>🔴 Fraco &lt; 45%</strong>. Dado faltando nunca remove a empresa da lista — só indica o que falta para você abordar.
            </p>
            <table className="w-full">
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-0.5">{COMPLETENESS_FIELD_LABEL[k]}</td>
                    <td className="text-right font-medium">+{COMPLETENESS_WEIGHTS[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Exemplo desta busca: por que “{example.name}” está com {example.completeness}%?</p>
            <ul className="space-y-0.5">
              {keys.map((k) => {
                const has = breakdown[k];
                return (
                  <li key={k} className={has ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
                    {has ? "✓" : "✗"} {COMPLETENESS_FIELD_LABEL[k]} {has ? `(+${COMPLETENESS_WEIGHTS[k]})` : `— faltando (−${COMPLETENESS_WEIGHTS[k]})`}
                  </li>
                );
              })}
            </ul>
            {missing.length > 0 && (
              <p className="text-muted-foreground">
                Como melhorar: “Enriquecer” busca o CNPJ na Receita (traz sócios, telefone e e-mail cadastrais) e o site oficial (traz redes sociais,
                e-mail e telefone). OSM raramente tem CNPJ, e-mail ou dono.
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2" title={hint}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={strong ? "text-xl font-semibold" : "text-lg font-medium"}>{value}</p>
    </div>
  );
}
