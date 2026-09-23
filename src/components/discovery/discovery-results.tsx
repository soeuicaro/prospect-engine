"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChoiceSelect } from "@/components/shared/choice-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactActions } from "@/components/shared/contact-actions";
import { displayPhone } from "@/lib/domain/contact-links";
import { getSourceDefinition, sourceLabel } from "@/lib/discovery/registry";
import { foldText, hostOf } from "@/lib/discovery/normalize";
import { COMPLETENESS_WEIGHTS, completenessBreakdown } from "@/lib/discovery/completeness";
import type { MergeField, UnifiedCompany } from "@/lib/discovery/types";
import { CompletenessBadge, ConfidencePill, QualityBadge, SourceBadges } from "./badges";
import { COMPLETENESS_FIELD_LABEL } from "./discovery-summary";

/** 0 = everything on one page (default: the user wants to see every result). */
const PAGE_SIZES = [0, 50, 100, 200, 500];

function missingFields(c: UnifiedCompany): (keyof typeof COMPLETENESS_WEIGHTS)[] {
  const b = completenessBreakdown(c);
  return (Object.keys(COMPLETENESS_WEIGHTS) as (keyof typeof COMPLETENESS_WEIGHTS)[]).filter((k) => !b[k]);
}

const FIELD_LABEL: Partial<Record<MergeField, string>> = {
  name: "Nome",
  legalName: "Razão social",
  cnpj: "CNPJ",
  category: "Categoria",
  street: "Logradouro",
  houseNumber: "Número",
  neighborhood: "Bairro",
  city: "Cidade",
  postcode: "CEP",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  email: "E-mail",
  website: "Website",
  coordinates: "Coordenadas",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

type Filter = "all" | "new" | "existing" | "review" | "no_phone" | "no_website" | "with_owner";

export function DiscoveryResults({
  results,
  limit,
  selected,
  onToggle,
  onSelectMany,
  onEnrichOne,
}: {
  results: UnifiedCompany[];
  limit: number;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectMany: (keys: string[], value: boolean) => void;
  onEnrichOne: (c: UnifiedCompany) => void;
}) {
  const [topOnly, setTopOnly] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"rank" | "completeness" | "name">("rank");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const view = useMemo(() => {
    let list = [...results];
    if (sort === "completeness") list.sort((a, b) => b.completeness - a.completeness);
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    else list.sort((a, b) => b.rankScore - a.rankScore);
    if (topOnly) list = list.slice(0, limit);
    if (q.trim()) {
      const f = foldText(q);
      list = list.filter((c) => foldText(`${c.name} ${c.legalName ?? ""} ${c.street ?? ""} ${c.neighborhood ?? ""} ${c.category ?? ""}`).includes(f));
    }
    if (filter === "new") list = list.filter((c) => !c.inPipeline);
    if (filter === "existing") list = list.filter((c) => c.inPipeline);
    if (filter === "review") list = list.filter((c) => c.qualityLabel === "NEEDS_REVIEW");
    if (filter === "no_phone") list = list.filter((c) => !c.phone && !c.whatsapp);
    if (filter === "no_website") list = list.filter((c) => !c.website);
    if (filter === "with_owner") list = list.filter((c) => c.contacts?.length);
    return list;
  }, [results, sort, topOnly, limit, q, filter]);

  const size = pageSize || Math.max(1, view.length);
  const pages = Math.max(1, Math.ceil(view.length / size));
  const current = Math.min(page, pages);
  const pageRows = view.slice((current - 1) * size, current * size);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.key));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Filtrar resultados..." className="h-8 w-52" />
        <ChoiceSelect
          value={filter}
          onValueChange={(v) => { setFilter(v as Filter); setPage(1); }}
          className="w-56"
          aria-label="Filtro"
          options={[
            { value: "all", label: "Todas" },
            { value: "new", label: "Fora do pipeline" },
            { value: "existing", label: "Já no pipeline" },
            { value: "with_owner", label: "Com dono/sócio identificado" },
            { value: "review", label: "Precisa revisão" },
            { value: "no_phone", label: "Sem telefone" },
            { value: "no_website", label: "Sem website (oportunidade)" },
          ]}
        />
        <ChoiceSelect
          value={sort}
          onValueChange={(v) => setSort(v as typeof sort)}
          className="w-44"
          aria-label="Ordenar por"
          options={[
            { value: "rank", label: "Relevância" },
            { value: "completeness", label: "Completude" },
            { value: "name", label: "Nome" },
          ]}
        />
        {results.length > limit && (
          <label className="flex items-center gap-2">
            <Checkbox checked={topOnly} onCheckedChange={(v) => { setTopOnly(Boolean(v)); setPage(1); }} />
            Mostrar top {limit} (de {results.length})
          </label>
        )}
        <Button size="xs" variant="outline" onClick={() => onSelectMany(view.map((r) => r.key), true)}>
          Selecionar {view.length} filtradas
        </Button>
        {selected.size > 0 && (
          <Button size="xs" variant="ghost" onClick={() => onSelectMany([...selected], false)}>
            Limpar seleção
          </Button>
        )}
        <ChoiceSelect
          value={String(pageSize)}
          onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
          className="w-40"
          aria-label="Linhas por página"
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: n ? `${n} por página` : "Mostrar todas" }))}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {view.length} de {results.length} exibidas{pages > 1 ? ` · página ${current}/${pages}` : ""}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={allOnPageSelected} onCheckedChange={(v) => onSelectMany(pageRows.map((r) => r.key), Boolean(v))} />
              </TableHead>
              <TableHead className="w-6" />
              <TableHead>Empresa</TableHead>
              <TableHead>Dono / sócio</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Fontes</TableHead>
              <TableHead>Completude</TableHead>
              <TableHead>Confiança</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((c) => {
              const open = expanded === c.key;
              return (
                <Fragment key={c.key}>
                  <TableRow className="align-top">
                    <TableCell>
                      <Checkbox checked={selected.has(c.key)} onCheckedChange={() => onToggle(c.key)} />
                    </TableCell>
                    <TableCell>
                      <button type="button" onClick={() => setExpanded(open ? null : c.key)} aria-label="Detalhes" className="text-muted-foreground">
                        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <div className="font-medium">
                        {c.companyId ? (
                          <Link href={`/companies/${c.companyId}`} className="hover:underline">
                            {c.name}
                          </Link>
                        ) : (
                          c.name
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {c.category && <span>{c.category}</span>}
                        {c.companyId &&
                          (c.inPipeline ? (
                            <Badge variant="outline" className="border-sky-300 px-1 py-0 text-[10px] text-sky-700 dark:text-sky-300">
                              no pipeline
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="px-1 py-0 text-[10px]" title="Está no banco (ex.: base CNPJ), mas ainda não foi enviada ao pipeline">
                              na base
                            </Badge>
                          ))}
                        {c.qualityLabel !== "PARTIAL" && <QualityBadge label={c.qualityLabel} />}
                        {c.conflicts.length > 0 && <span className="text-amber-700">{c.conflicts.length} conflito(s)</span>}
                        {c.possibleDuplicates.length > 0 && <span className="text-violet-700">possível duplicata</span>}
                        {c.enrichment.state === "RUNNING" && <Loader2 className="size-3 animate-spin" />}
                        {c.enrichment.state === "DONE" && <span className="text-emerald-700">enriquecida</span>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-48 text-xs">
                      <OwnerCell company={c} />
                    </TableCell>
                    <TableCell className="max-w-56 text-xs text-muted-foreground">
                      {[c.street, c.houseNumber].filter(Boolean).join(", ") || "—"}
                      {c.neighborhood && <div>{c.neighborhood}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{displayPhone(c.phone ?? c.whatsapp) ?? <span className="text-muted-foreground">não encontrado</span>}</TableCell>
                    <TableCell className="max-w-40 truncate text-xs">{c.website ? hostOf(c.website) : <span className="text-muted-foreground">não encontrado</span>}</TableCell>
                    <TableCell>
                      <SourceBadges sources={c.sourceKeys} />
                    </TableCell>
                    <TableCell className="max-w-40">
                      <CompletenessBadge label={c.completenessLabel} score={c.completeness} />
                      <MissingHint company={c} />
                    </TableCell>
                    <TableCell>
                      <ConfidencePill confidence={c.confidence} />
                    </TableCell>
                    <TableCell>
                      <ContactActions
                        compact
                        target={{
                          name: c.name,
                          legalName: c.legalName,
                          street: c.street,
                          houseNumber: c.houseNumber,
                          neighborhood: c.neighborhood,
                          city: c.city ?? undefined,
                          state: c.state,
                          lat: c.lat,
                          lon: c.lon,
                          website: c.website,
                          phone: c.phone,
                          whatsapp: c.whatsapp,
                          email: c.email,
                          socials: c.socials,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow>
                      <TableCell colSpan={11} className="bg-muted/20">
                        <ResultDetail company={c} onEnrich={() => onEnrichOne(c)} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum resultado com este filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            Anterior
          </Button>
          <Button size="sm" variant="outline" disabled={current >= pages} onClick={() => setPage(current + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

function OwnerCell({ company: c }: { company: UnifiedCompany }) {
  const [first, ...rest] = c.contacts ?? [];
  if (first) {
    return (
      <div title={(c.contacts ?? []).map((p) => `${p.name}${p.role ? ` (${p.role})` : ""} — ${sourceLabel(p.source)}`).join("\n")}>
        <div className="font-medium">{first.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {first.role ?? "Sócio"}
          {rest.length > 0 && ` · +${rest.length}`}
        </div>
      </div>
    );
  }
  let why = "sem CNPJ — não dá para consultar o quadro societário";
  if (c.cnpj && c.enrichment.state === "RUNNING") why = "consultando Receita...";
  else if (c.cnpj && c.enrichment.state === "DONE") why = "Receita não lista sócios (ex.: MEI/EI)";
  else if (c.cnpj) why = "clique em Enriquecer para consultar a Receita";
  else if (c.enrichment.state === "PENDING" || c.enrichment.state === "SKIPPED") why = "Enriquecer pode achar o CNPJ e os sócios";
  return (
    <span className="text-muted-foreground" title={why}>
      não identificado
      <span className="block text-[10px] leading-tight">{why}</span>
    </span>
  );
}

function MissingHint({ company }: { company: UnifiedCompany }) {
  const missing = missingFields(company);
  if (!missing.length) return null;
  return (
    <p className="text-[10px] leading-tight text-muted-foreground" title={missing.map((k) => `${COMPLETENESS_FIELD_LABEL[k]} (−${COMPLETENESS_WEIGHTS[k]})`).join(", ")}>
      falta: {missing.map((k) => COMPLETENESS_FIELD_LABEL[k].toLowerCase()).join(", ")}
    </p>
  );
}

function ResultDetail({ company: c, onEnrich }: { company: UnifiedCompany; onEnrich: () => void }) {
  const fields = Object.entries(c.provenance) as [MergeField, NonNullable<UnifiedCompany["provenance"][MergeField]>][];
  return (
    <div className="grid gap-4 py-2 text-xs md:grid-cols-3">
      <div className="space-y-1 md:col-span-2">
        <p className="font-medium">Dados encontrados por</p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {fields.map(([field, v]) => (
            <div key={field} className="flex justify-between gap-2 border-b py-0.5">
              <span className="text-muted-foreground">{FIELD_LABEL[field] ?? field}</span>
              <span className="truncate text-right" title={v.value}>
                {field === "phone" || field === "whatsapp" ? displayPhone(v.value) : v.value}{" "}
                <span className="text-muted-foreground">· {sourceLabel(v.source)} · {v.confidence}</span>
              </span>
            </div>
          ))}
        </div>
        {c.phones.length > 1 && <p className="pt-1">Outros telefones: {c.phones.filter((p) => p !== c.phone).map((p) => displayPhone(p)).join(", ")}</p>}
        {c.contacts && c.contacts.length > 0 && (
          <div className="pt-1">
            <p className="font-medium">Donos / sócios</p>
            {c.contacts.map((p) => (
              <p key={p.name}>
                {p.name}
                {p.role ? ` — ${p.role}` : ""} <span className="text-muted-foreground">· {sourceLabel(p.source)}</span>
              </p>
            ))}
          </div>
        )}
        <div className="pt-1">
          <p className="font-medium">
            Completude {c.completeness}% — por quê
          </p>
          <div className="flex flex-wrap gap-x-3">
            {(Object.keys(COMPLETENESS_WEIGHTS) as (keyof typeof COMPLETENESS_WEIGHTS)[]).map((k) => {
              const has = completenessBreakdown(c)[k];
              return (
                <span key={k} className={has ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
                  {has ? "✓" : "✗"} {COMPLETENESS_FIELD_LABEL[k]} ({has ? "+" : "−"}
                  {COMPLETENESS_WEIGHTS[k]})
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {c.conflicts.length > 0 && (
          <div>
            <p className="font-medium text-amber-700">Existem dados conflitantes</p>
            {c.conflicts.map((cf) => (
              <p key={cf.field}>
                {FIELD_LABEL[cf.field] ?? cf.field}: <strong>{cf.chosen.value}</strong> ({sourceLabel(cf.chosen.source)}) vs{" "}
                {cf.alternatives.map((a) => `${a.value} (${sourceLabel(a.source)})`).join(", ")}
              </p>
            ))}
            <p className="text-muted-foreground">Escolha o valor correto na página da empresa após importar.</p>
          </div>
        )}
        {c.possibleDuplicates.length > 0 && (
          <div>
            <p className="font-medium text-violet-700">Possíveis duplicatas (não mescladas automaticamente)</p>
            {c.possibleDuplicates.map((d) => (
              <p key={d.key}>
                {d.name} — {d.confidence} ({d.reasons.join(", ")})
              </p>
            ))}
          </div>
        )}
        {c.warnings.map((w, i) => (
          <p key={i} className="text-amber-700">
            ⚠ {w}
          </p>
        ))}
        <div>
          <p className="font-medium">Registros de origem</p>
          {c.sources.map((s) => (
            <p key={`${s.source}:${s.recordId}`}>
              {getSourceDefinition(s.source).label.split(" (")[0]} ·{" "}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {s.recordId}
                </a>
              ) : (
                s.recordId
              )}{" "}
              · {s.matchedBy}
            </p>
          ))}
          {c.mergeConfidence && <p className="text-muted-foreground">Merge: {c.mergeConfidence}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={onEnrich} disabled={c.enrichment.state === "RUNNING"}>
            <Wand2 className="size-3" /> {c.enrichment.state === "DONE" ? "Enriquecer de novo" : "Enriquecer"}
          </Button>
          <span className="text-muted-foreground">
            {c.enrichment.state}
            {c.enrichment.message ? ` — ${c.enrichment.message}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
