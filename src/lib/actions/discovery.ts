"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { normalizePhoneBR } from "@/lib/domain/phone";
import { normalizeCnpj } from "@/lib/domain/cnpj";
import { findBestDedupMatch, type DedupCandidate } from "@/lib/domain/dedup";
import { computeProspectScore, computeDataQualityScore } from "@/lib/domain/scoring";
import { logAudit } from "@/lib/actions/audit";
import { recomputeCompanyScore } from "@/lib/actions/scoring";
import { websiteDomain, stripAccents } from "@/lib/discovery/normalize";
import { resolveSourceConfigs, SOURCE_DEFINITIONS, type FieldPriority } from "@/lib/discovery/registry";
import {
  getSearchRow,
  loadBreakers,
  loadSourceOverrides,
  persistBreakers,
  saveFieldPriority,
  saveSourceOverrides,
} from "@/lib/discovery/store";
import { persistTestLogs, runSourceTest, type SourceTestInput, type SourceTestResult } from "@/lib/discovery/diagnostics";
import type { SourceConfig, SourceKey, UnifiedCompany } from "@/lib/discovery/types";
import type { Company, CompanyScoreFactor, CompanyScores, CompanySource, ScoringCategoryWeight, ScoringRule, SourceType } from "@/types/database";

export interface ImportResult {
  error?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  possibleDuplicates?: number;
}

const SOURCE_TYPE: Partial<Record<SourceKey, SourceType>> = {
  osm_overpass: "OSM",
  osm_nominatim: "OSM",
  osm_photon: "OSM",
  cnpj_brasilapi: "CNPJ",
  website_discovery: "WEBSITE",
};

const SOURCE_NAME: Partial<Record<SourceKey, string>> = {
  osm_overpass: "OpenStreetMap (Overpass)",
  osm_nominatim: "OpenStreetMap (Nominatim)",
  osm_photon: "OpenStreetMap (Photon)",
  cnpj_brasilapi: "Receita Federal (BrasilAPI)",
  website_discovery: "Website oficial",
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const BATCH = 500;
const MAX_IMPORT = 1000;

function provenanceJson(u: UnifiedCompany) {
  return Object.fromEntries(
    Object.entries(u.provenance).map(([field, v]) => [
      field,
      { value: v!.value, source: v!.source, confidence: v!.confidence, collected_at: v!.collectedAt, verified_at: v!.verifiedAt ?? null },
    ])
  );
}

function conflictsJson(u: UnifiedCompany) {
  return u.conflicts.map((c) => ({
    field: c.field,
    chosen: { value: c.chosen.value, source: c.chosen.source },
    alternatives: c.alternatives.map((a) => ({ value: a.value, source: a.source, collected_at: a.collectedAt })),
  }));
}

function sourceRows(workspaceId: string, companyId: string, u: UnifiedCompany, existing: Set<string>): Partial<CompanySource>[] {
  const rows: Partial<CompanySource>[] = [];
  const seen = new Set<string>();
  for (const s of u.sources) {
    const type = SOURCE_TYPE[s.source];
    if (!type) continue;
    const key = `${type}:${s.recordId}`;
    if (seen.has(key) || existing.has(key)) continue;
    seen.add(key);
    rows.push({
      workspace_id: workspaceId,
      company_id: companyId,
      source_type: type,
      source_name: SOURCE_NAME[s.source] ?? s.source,
      source_url: s.url,
      source_record_id: s.recordId,
      confidence: u.confidence,
      raw_ref: { matched_by: s.matchedBy, discovery_source: s.source },
    });
  }
  for (const src of u.sourceKeys) {
    const type = SOURCE_TYPE[src];
    if (!type || type === "OSM") continue;
    const key = `${type}:enrichment`;
    if (seen.has(key) || existing.has(key)) continue;
    seen.add(key);
    rows.push({
      workspace_id: workspaceId,
      company_id: companyId,
      source_type: type,
      source_name: SOURCE_NAME[src] ?? src,
      source_record_id: type === "CNPJ" ? normalizeCnpj(u.cnpj) : websiteDomain(u.website),
      confidence: "HIGH",
      raw_ref: { discovery_source: src },
    });
  }
  return rows;
}

function socialRows(workspaceId: string, companyId: string, u: UnifiedCompany) {
  return Object.entries(u.socials)
    .filter(([, url]) => Boolean(url))
    .map(([channel, url]) => ({
      workspace_id: workspaceId,
      company_id: companyId,
      channel: channel as "instagram" | "facebook" | "tiktok" | "linkedin" | "youtube",
      handle_or_url: url!,
      status: "FOUND" as const,
      source: u.provenance[channel as "instagram"]?.source ?? "discovery",
      confidence: u.provenance[channel as "instagram"]?.confidence ?? "MEDIUM",
      checked_at: new Date().toISOString(),
    }));
}

/**
 * All companies of the target cities, paged: PostgREST caps every response
 * at 1000 rows (Supabase `max_rows`), so a single `.limit(5000)` silently
 * returned only the first 1000 and dedup missed the rest.
 */
async function loadDedupPool(workspaceId: string, cityFilter: string): Promise<{ data: DedupCandidate[] }> {
  const supabase = await createClient();
  const out: DedupCandidate[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase
      .from("companies")
      .select("id, cnpj, website_domain, phone, email, trade_name, legal_name, city")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .or(cityFilter)
      .order("id")
      .range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...(data as DedupCandidate[]));
    if (data.length < 1000) break;
  }
  return { data: out };
}

/**
 * Imports discovery results. Never overwrites existing data:
 * - results already in the DB (companyId) get ONLY empty fields filled,
 *   new source links, socials, provenance and conflicts appended;
 * - new results are re-checked against the DB (CNPJ/domain/phone/
 *   name+city) — EXACT/LIKELY matches complement the existing company
 *   instead of creating a copy; POSSIBLE matches are created and tagged
 *   `possivel-duplicata` for review (never silently dropped).
 */
export async function importDiscoveryResultsAction(companies: UnifiedCompany[], industryId: string | null, searchId?: string | null): Promise<ImportResult> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();
  if (!companies.length) return { error: "Nenhuma empresa selecionada." };
  if (companies.length > MAX_IMPORT) return { error: `Importe no máximo ${MAX_IMPORT} empresas por vez.` };

  const cities = [...new Set(companies.map((c) => c.city).filter(Boolean) as string[])];
  const cityFilter = [...new Set(cities.flatMap((c) => [c, stripAccents(c)]))]
    .map((c) => c.replace(/[^\p{L}\p{N} ]+/gu, " ").trim())
    .filter(Boolean)
    .map((c) => `city.ilike.${c}`)
    .join(",");

  const [{ data: newStage }, { data: rules }, { data: weights }, { data: industryRow }, { data: playbook }, { data: candidates }] = await Promise.all([
    supabase.from("pipeline_stages").select("id").eq("workspace_id", workspace.id).eq("key", "NEW").maybeSingle(),
    supabase.from("scoring_rules").select("*").eq("workspace_id", workspace.id).eq("enabled", true),
    supabase.from("scoring_category_weights").select("*").eq("workspace_id", workspace.id),
    industryId ? supabase.from("industries").select("is_visual_segment, recurring_need").eq("id", industryId).maybeSingle() : Promise.resolve({ data: null }),
    industryId
      ? supabase.from("industry_playbooks").select("id").eq("workspace_id", workspace.id).eq("industry_id", industryId).maybeSingle()
      : Promise.resolve({ data: null }),
    cityFilter ? loadDedupPool(workspace.id, cityFilter) : Promise.resolve({ data: [] as DedupCandidate[] }),
  ]);

  const dedupPool = (candidates ?? []) as DedupCandidate[];
  const scoringRules = (rules ?? []) as ScoringRule[];
  const scoringWeights = (weights ?? []) as ScoringCategoryWeight[];

  // ---- resolve each result to "existing" or "new" --------------------------
  const toUpdate: { companyId: string; u: UnifiedCompany }[] = [];
  const toCreate: { u: UnifiedCompany; possibleDuplicate: boolean }[] = [];
  for (const u of companies) {
    if (u.companyId) {
      toUpdate.push({ companyId: u.companyId, u });
      continue;
    }
    const match = findBestDedupMatch(
      {
        id: "incoming",
        cnpj: u.cnpj,
        website_domain: websiteDomain(u.website),
        phone: u.phone,
        email: u.email,
        trade_name: u.name,
        legal_name: u.legalName,
        city: u.city,
      },
      dedupPool
    );
    if (match && (match.level === "EXACT_MATCH" || match.level === "LIKELY_MATCH")) toUpdate.push({ companyId: match.candidateId, u });
    else toCreate.push({ u, possibleDuplicate: match?.level === "POSSIBLE_DUPLICATE" });
  }

  // ---- complement existing companies (fill empty fields only) --------------
  let updated = 0;
  if (toUpdate.length) {
    const ids = [...new Set(toUpdate.map((t) => t.companyId))];
    const [{ data: currentRows }, { data: existingSources }, { data: existingSocial }] = await Promise.all([
      supabase.from("companies").select("*").in("id", ids).eq("workspace_id", workspace.id),
      supabase.from("company_sources").select("company_id, source_type, source_record_id").in("company_id", ids),
      supabase.from("company_social_profiles").select("company_id, channel, status").in("company_id", ids),
    ]);
    const byId = new Map((currentRows ?? []).map((r) => [r.id, r as Company]));
    const newSources: Partial<CompanySource>[] = [];
    const newSocial: ReturnType<typeof socialRows> = [];
    for (const { companyId, u } of toUpdate) {
      const cur = byId.get(companyId);
      if (!cur) continue;
      const patch: Partial<Company> = {};
      const fill = <K extends keyof Company>(key: K, value: Company[K] | null | undefined) => {
        if ((cur[key] === null || cur[key] === undefined || cur[key] === "") && value !== null && value !== undefined && value !== "") patch[key] = value;
      };
      fill("trade_name", u.name);
      fill("legal_name", u.legalName);
      fill("cnpj", normalizeCnpj(u.cnpj));
      fill("cnpj_status", u.cnpjStatus as Company["cnpj_status"]);
      fill("street", u.street);
      fill("street_number", u.houseNumber);
      fill("neighborhood", u.neighborhood);
      fill("postal_code", u.postcode);
      fill("phone", u.phone);
      if (!cur.phone && u.phone) patch.phone_normalized = normalizePhoneBR(u.phone)?.normalized ?? null;
      fill("whatsapp", u.whatsapp);
      fill("email", u.email);
      fill("website", u.website);
      if (!cur.website && u.website) patch.website_domain = websiteDomain(u.website);
      if (cur.latitude == null && u.lat != null && u.lon != null) {
        patch.latitude = u.lat;
        patch.longitude = u.lon;
        patch.geo_source = "OSM";
      }
      if (!cur.industry_id && industryId) patch.industry_id = industryId;
      patch.field_provenance = { ...provenanceJson(u), ...(cur.field_provenance ?? {}) };
      const conflicts = conflictsJson(u);
      if (conflicts.length) patch.data_conflicts = [...(cur.data_conflicts ?? []).filter((c) => !conflicts.some((n) => n.field === c.field)), ...conflicts];
      const { error } = await supabase.from("companies").update(patch).eq("id", companyId).eq("workspace_id", workspace.id);
      if (!error) updated++;

      const existingKeys = new Set(
        (existingSources ?? []).filter((s) => s.company_id === companyId).map((s) => `${s.source_type}:${s.source_record_id ?? "enrichment"}`)
      );
      newSources.push(...sourceRows(workspace.id, companyId, u, existingKeys));
      const haveSocial = new Set((existingSocial ?? []).filter((s) => s.company_id === companyId && s.status === "FOUND").map((s) => s.channel));
      newSocial.push(...socialRows(workspace.id, companyId, u).filter((s) => !haveSocial.has(s.channel)));
    }
    await Promise.all([
      ...chunk(newSources, BATCH).map((b) => supabase.from("company_sources").insert(b)),
      ...chunk(newSocial, BATCH).map((b) => supabase.from("company_social_profiles").upsert(b, { onConflict: "company_id,channel" })),
    ]);
    // Scores depend on the filled fields; recompute a bounded number inline.
    for (const batch of chunk(ids.slice(0, 50), 5)) {
      await Promise.all(batch.map((id) => recomputeCompanyScore(supabase, workspace.id, id)));
    }
  }

  // ---- create new companies --------------------------------------------------
  interface Prepared {
    company: Partial<Company> & { id: string };
    sources: Partial<CompanySource>[];
    social: ReturnType<typeof socialRows>;
    contacts: { workspace_id: string; company_id: string; name: string; role: string | null; contact_type: "SOCIO"; evidence_source: string; confidence: "HIGH" }[];
    score: Partial<CompanyScores>;
    scoreFactors: Partial<CompanyScoreFactor>[];
  }
  const prepared: Prepared[] = [];
  for (const { u, possibleDuplicate } of toCreate) {
    const id = crypto.randomUUID();
    const phone = normalizePhoneBR(u.phone);
    const socials = socialRows(workspace.id, id, u);
    const scoreResult = computeProspectScore(
      {
        company: {
          website: u.website,
          phone: u.phone,
          email: u.email,
          whatsapp: u.whatsapp,
          opened_at: null,
          estimated_size: null,
          tags: [],
          industry_id: industryId,
          city: u.city,
          state: u.state,
        },
        industry: industryRow,
        socialProfiles: socials.map(() => ({ status: "FOUND" as const })),
        analysis: null,
        hasOfferMapped: Boolean(playbook),
      },
      scoringRules,
      scoringWeights
    );
    prepared.push({
      company: {
        id,
        workspace_id: workspace.id,
        trade_name: u.name,
        legal_name: u.legalName,
        cnpj: normalizeCnpj(u.cnpj),
        cnpj_status: (u.cnpjStatus as Company["cnpj_status"]) ?? null,
        industry_id: industryId,
        street: u.street,
        street_number: u.houseNumber,
        neighborhood: u.neighborhood,
        city: u.city,
        state: u.state && u.state.length === 2 ? u.state.toUpperCase() : null,
        postal_code: u.postcode,
        latitude: u.lat,
        longitude: u.lon,
        geo_source: u.lat != null ? "OSM" : null,
        phone: u.phone,
        phone_normalized: phone?.normalized ?? null,
        whatsapp: u.whatsapp,
        email: u.email,
        website: u.website,
        website_domain: websiteDomain(u.website),
        pipeline_stage_id: newStage?.id ?? null,
        tags: possibleDuplicate ? ["possivel-duplicata"] : [],
        field_provenance: provenanceJson(u),
        data_conflicts: conflictsJson(u),
        data_quality_score: computeDataQualityScore(
          { cnpj: u.cnpj, phone: u.phone, email: u.email, website: u.website, trade_name: u.name, street: u.street, city: u.city },
          Boolean(u.contacts?.length),
          false
        ),
      },
      sources: sourceRows(workspace.id, id, u, new Set()),
      social: socials,
      contacts: (u.contacts ?? []).map((c) => ({
        workspace_id: workspace.id,
        company_id: id,
        name: c.name,
        role: c.role,
        contact_type: "SOCIO",
        evidence_source: "Quadro societário público (Receita Federal via BrasilAPI)",
        confidence: "HIGH",
      })),
      score: {
        workspace_id: workspace.id,
        company_id: id,
        digital_presence_score: scoreResult.categoryScores.digital_presence,
        content_need_score: scoreResult.categoryScores.content_need,
        purchase_capacity_score: scoreResult.categoryScores.purchase_capacity,
        marketing_opportunity_score: scoreResult.categoryScores.marketing_opportunity,
        fit_score: scoreResult.categoryScores.fit,
        size_score: scoreResult.categoryScores.size,
        local_proximity_score: scoreResult.categoryScores.local_proximity,
        prospect_score: scoreResult.prospectScore,
        opportunity_level: scoreResult.opportunityLevel,
        rule_version: "v1",
        computed_at: new Date().toISOString(),
      },
      scoreFactors: scoreResult.factors.map((f) => ({
        workspace_id: workspace.id,
        company_id: id,
        factor_key: f.factor_key,
        factor_label: f.factor_label,
        category: f.category,
        points: f.points,
        evidence: f.evidence,
        confidence: f.confidence,
      })),
    });
  }

  let created = 0;
  const succeeded: Prepared[] = [];
  const failures: string[] = [];
  for (const batch of chunk(prepared, BATCH)) {
    const { error } = await supabase.from("companies").insert(batch.map((r) => r.company));
    if (!error) {
      created += batch.length;
      succeeded.push(...batch);
    } else {
      failures.push(error.message);
    }
  }
  if (succeeded.length) {
    await Promise.all([
      ...chunk(succeeded.flatMap((r) => r.sources), BATCH).map((b) => supabase.from("company_sources").insert(b)),
      ...chunk(succeeded.flatMap((r) => r.social), BATCH).map((b) => supabase.from("company_social_profiles").insert(b)),
      ...chunk(succeeded.flatMap((r) => r.contacts), BATCH).map((b) => supabase.from("company_contacts").insert(b)),
      ...chunk(succeeded.map((r) => r.score), BATCH).map((b) => supabase.from("company_scores").insert(b)),
      ...chunk(succeeded.flatMap((r) => r.scoreFactors), BATCH).map((b) => supabase.from("company_score_factors").insert(b)),
    ]);
  }

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "discovery.import",
    entityType: "company",
    metadata: { created, updated, search_id: searchId ?? null, failures: failures.slice(0, 3) },
  });

  revalidatePath("/companies");
  if (failures.length && !created && !updated) return { error: "Não foi possível importar as empresas (erro no banco)." };
  return { created, updated, skipped: companies.length - created - toUpdate.length, possibleDuplicates: toCreate.filter((t) => t.possibleDuplicate).length };
}

// ---------------------------------------------------------------------------
// Search history
// ---------------------------------------------------------------------------

export async function saveSearchAction(searchId: string, name: string): Promise<{ error?: string; success?: boolean }> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const label = name.trim().slice(0, 120);
  if (!label) return { error: "Dê um nome para a busca." };
  const { error } = await supabase
    .from("discovery_searches")
    .update({ name: label, saved: true })
    .eq("id", searchId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar a busca." };
  revalidatePath("/discovery");
  return { success: true };
}

export async function unsaveSearchAction(searchId: string): Promise<{ error?: string; success?: boolean }> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase.from("discovery_searches").update({ saved: false }).eq("id", searchId).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível atualizar a busca." };
  revalidatePath("/discovery");
  return { success: true };
}

export async function loadSearchAction(searchId: string) {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const row = await getSearchRow(supabase, workspace.id, searchId);
  if (!row) return { error: "Busca não encontrada." };
  const { rowToResponse } = await import("@/lib/discovery/store");
  return { response: rowToResponse(row) };
}

// ---------------------------------------------------------------------------
// Source configuration / health
// ---------------------------------------------------------------------------

export async function updateSourceConfigAction(source: SourceKey, patch: Partial<SourceConfig>): Promise<{ error?: string; success?: boolean }> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  if (!SOURCE_DEFINITIONS.some((s) => s.key === source)) return { error: "Fonte desconhecida." };
  const overrides = await loadSourceOverrides(supabase, workspace.id);
  const next = { ...overrides, [source]: { ...(overrides[source] ?? {}), ...patch } };
  // Validate/clamp through the same resolver the engine uses.
  const resolved = resolveSourceConfigs(next as Partial<Record<SourceKey, Partial<SourceConfig>>>);
  const { error } = await saveSourceOverrides(supabase, workspace.id, { ...next, [source]: resolved[source] });
  if (error) return { error: "Não foi possível salvar a configuração (a migration 0011 foi aplicada?)." };
  revalidatePath("/settings/sources");
  return { success: true };
}

export async function updateFieldPriorityAction(priority: FieldPriority): Promise<{ error?: string; success?: boolean }> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const known = new Set(SOURCE_DEFINITIONS.map((s) => s.key));
  const clean = Object.fromEntries(Object.entries(priority).map(([group, list]) => [group, list.filter((k) => known.has(k))]));
  const { error } = await saveFieldPriority(supabase, workspace.id, clean);
  if (error) return { error: "Não foi possível salvar a prioridade." };
  revalidatePath("/settings/sources");
  return { success: true };
}

export async function resetBreakerAction(key: string): Promise<{ error?: string; success?: boolean }> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const breakers = await loadBreakers(supabase, workspace.id);
  breakers.reset(key);
  await persistBreakers(supabase, workspace.id, breakers);
  revalidatePath("/settings/sources");
  return { success: true };
}

export async function testSourceAction(source: SourceKey, input: SourceTestInput): Promise<SourceTestResult> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const result = await runSourceTest(supabase, workspace, source, input);
  await persistTestLogs(supabase, workspace.id, [result]);
  return result;
}

export async function testAllSourcesAction(input: SourceTestInput): Promise<SourceTestResult[]> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const keys: SourceKey[] = ["local_db", "osm_overpass", "osm_nominatim", "osm_photon", "cnpj_brasilapi", "website_discovery"];
  const results = await Promise.all(keys.map((k) => runSourceTest(supabase, workspace, k, input)));
  await persistTestLogs(supabase, workspace.id, results);
  revalidatePath("/settings/sources");
  return results;
}

// ---------------------------------------------------------------------------
// Conflict resolution (§16)
// ---------------------------------------------------------------------------

const CONFLICT_COLUMN: Record<string, keyof Company> = {
  cnpj: "cnpj",
  phone: "phone",
  email: "email",
  website: "website",
  street: "street",
  houseNumber: "street_number",
  postcode: "postal_code",
};

export async function resolveConflictAction(companyId: string, field: string, value: string): Promise<{ error?: string; success?: boolean }> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const column = CONFLICT_COLUMN[field];
  if (!column) return { error: "Campo não suporta resolução de conflito." };
  const { data: company } = await supabase
    .from("companies")
    .select("data_conflicts, field_provenance")
    .eq("id", companyId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!company) return { error: "Empresa não encontrada." };
  const conflict = (company.data_conflicts ?? []).find((c) => c.field === field);
  const allowed = conflict ? [conflict.chosen.value, ...conflict.alternatives.map((a) => a.value)] : [];
  if (!allowed.includes(value)) return { error: "Valor não pertence ao conflito." };
  const chosenSource = conflict?.chosen.value === value ? conflict.chosen.source : conflict?.alternatives.find((a) => a.value === value)?.source ?? "manual";

  const patch: Partial<Company> = {
    [column]: value,
    data_conflicts: (company.data_conflicts ?? []).filter((c) => c.field !== field),
    field_provenance: {
      ...(company.field_provenance ?? {}),
      [field]: { value, source: `${chosenSource} (escolhido pelo usuário)`, confidence: "HIGH", collected_at: new Date().toISOString(), verified_at: new Date().toISOString() },
    },
  };
  if (column === "phone") patch.phone_normalized = normalizePhoneBR(value)?.normalized ?? null;
  if (column === "website") patch.website_domain = websiteDomain(value);
  const { error } = await supabase.from("companies").update(patch).eq("id", companyId).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível salvar a escolha." };
  revalidatePath(`/companies/${companyId}`);
  return { success: true };
}
