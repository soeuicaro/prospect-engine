import "server-only";

/**
 * Server-side entry points for the Discovery Engine: wires real adapters,
 * persisted config/health, cache and logs around the pure orchestrator.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeWebsite } from "@/lib/providers/website-analyzer";
import type { Database, Workspace } from "@/types/database";
import type { BreakerRegistry } from "./circuit-breaker";
import { computeCacheKey, normalizeSearchContext } from "./context";
import { enrichCompanies, type EnrichOutput } from "./enrich";
import { expansionForCustomIndustry, getIndustry, type IndustryDefinition } from "./industries";
import { mergeSourceCompanies } from "./merge";
import { runDiscovery } from "./orchestrator";
import { DISCOVERY_SOURCE_KEYS, type FieldPriority, type SourceConfigMap } from "./registry";
import type { DiscoverySource, EnrichmentSource } from "./sources/base";
import { createBrasilApiSource } from "./sources/brasilapi";
import { createLocalDbSource } from "./sources/local-db";
import { createNominatimSource, nominatimGeo } from "./sources/nominatim";
import { createOverpassSource } from "./sources/overpass";
import { createPhotonSource, photonGeo } from "./sources/photon";
import { createWebsiteSource } from "./sources/website";
import {
  completeSearchRow,
  createSearchRow,
  failSearchRow,
  findCachedSearch,
  geocodeCacheFor,
  getSearchRow,
  insertRequestLogs,
  loadBreakers,
  loadDiscoveryConfig,
  persistBreakers,
  pruneDiscoveryData,
  rowToResponse,
  updateSearchResults,
} from "./store";
import type { SearchContext, SearchResponse, SearchStreamEvent, SourceCompany, SourceKey, UnifiedCompany } from "./types";

type Client = SupabaseClient<Database>;

export interface DiscoveryRuntime {
  configs: SourceConfigMap;
  fieldPriority: FieldPriority;
  breakers: BreakerRegistry;
  discoverySources: Partial<Record<SourceKey, DiscoverySource>>;
  enrichmentSources: EnrichmentSource[];
}

export async function loadRuntime(supabase: Client, workspace: Workspace): Promise<DiscoveryRuntime> {
  const [{ configs, fieldPriority }, breakers] = await Promise.all([
    loadDiscoveryConfig(supabase, workspace.id),
    loadBreakers(supabase, workspace.id),
  ]);
  // The legacy OSM_DISCOVERY flag still switches off every OSM-based source.
  if (workspace.feature_flags.OSM_DISCOVERY === false) {
    for (const k of ["osm_overpass", "osm_nominatim", "osm_photon"] as SourceKey[]) configs[k] = { ...configs[k], enabled: false };
  }
  if (workspace.feature_flags.WEB_ANALYSIS === false) configs.website_discovery = { ...configs.website_discovery, enabled: false };
  return {
    configs,
    fieldPriority,
    breakers,
    discoverySources: {
      local_db: createLocalDbSource({ supabase, workspaceId: workspace.id }),
      osm_overpass: createOverpassSource(),
      osm_nominatim: createNominatimSource(),
      osm_photon: createPhotonSource(),
    },
    enrichmentSources: [createBrasilApiSource(), createWebsiteSource({ analyze: analyzeWebsite })],
  };
}

/** Map a workspace industry row to a catalog entry (by slug) or a custom definition. */
async function resolveIndustry(supabase: Client, ctx: SearchContext): Promise<{ ctx: SearchContext; custom: IndustryDefinition | null }> {
  if (!ctx.industryId) return { ctx, custom: null };
  const [{ data: row }, { data: cnaeRows }] = await Promise.all([
    supabase.from("industries").select("slug, name, keywords").eq("id", ctx.industryId).maybeSingle(),
    supabase.from("industry_cnaes").select("cnae_code").eq("industry_id", ctx.industryId),
  ]);
  if (!row) return { ctx, custom: null };
  if (getIndustry(row.slug)) return { ctx: { ...ctx, industryKey: ctx.industryKey ?? row.slug }, custom: null };
  const cnaes = (cnaeRows ?? []).map((r) => r.cnae_code);
  return { ctx, custom: expansionForCustomIndustry([row.name, ...(row.keywords ?? [])], cnaes, ctx.mode) };
}

function searchCacheTtl(configs: SourceConfigMap, used: SourceKey[]): number {
  const ttls = used.map((k) => configs[k]?.cacheTtlMinutes ?? 0);
  return ttls.length ? Math.min(...ttls) : 0;
}

export interface ExecuteSearchInput {
  supabase: Client;
  workspace: Workspace;
  userId: string | null;
  rawContext: unknown;
  refresh?: "none" | "all" | { source: SourceKey; searchId: string };
  emit?: (e: SearchStreamEvent) => void;
  signal?: AbortSignal;
}

export async function executeSearch(input: ExecuteSearchInput): Promise<SearchResponse> {
  const { supabase, workspace } = input;
  const emit = input.emit ?? (() => {});
  const parsed = normalizeSearchContext(input.rawContext);
  const { ctx, custom } = await resolveIndustry(supabase, parsed);
  const cacheKey = await computeCacheKey(ctx);
  const runtime = await loadRuntime(supabase, workspace);

  // ---- cache (§62) ------------------------------------------------------
  if (!input.refresh || input.refresh === "none") {
    const cached = await findCachedSearch(supabase, workspace.id, cacheKey).catch(() => null);
    if (cached && (cached.results as unknown[]).length) {
      emit({ type: "phase", status: "COMPLETED", message: "Resultado recente encontrado em cache." });
      return rowToResponse(cached);
    }
  }

  // ---- refresh ONE source: re-run it and merge onto the cached result ---
  let baseline: UnifiedCompany[] | null = null;
  let effectiveCtx = ctx;
  if (input.refresh && typeof input.refresh === "object") {
    const row = await getSearchRow(supabase, workspace.id, input.refresh.searchId);
    if (row) {
      baseline = row.results as unknown as UnifiedCompany[];
      effectiveCtx = { ...ctx, sourcesEnabled: [input.refresh.source], expandKeywords: false };
    }
  }

  const searchId = await createSearchRow(supabase, { workspaceId: workspace.id, userId: input.userId, cacheKey, context: ctx }).catch(() => null);

  try {
    const { response, logs, geoLogs } = await runDiscovery(effectiveCtx, {
      sources: runtime.discoverySources,
      geoSources: [nominatimGeo, photonGeo],
      configs: runtime.configs,
      breakers: runtime.breakers,
      fieldPriority: runtime.fieldPriority,
      customIndustry: custom,
      geocodeCache: geocodeCacheFor(supabase),
      emit,
      signal: input.signal,
      costMode: workspace.cost_mode,
    });

    if (baseline) {
      const remerged = mergeSourceCompanies([...baseline.map(unifiedToRecord), ...response.results.map(unifiedToRecord)], {
        targetCity: ctx.city,
        fieldPriority: runtime.fieldPriority,
      });
      response.results = remerged.companies.sort((a, b) => b.rankScore - a.rankScore);
      response.context = ctx;
      response.counts = { ...response.counts, final: response.results.length };
    }

    response.searchId = searchId;
    response.cacheKey = cacheKey;
    const ttl = searchCacheTtl(runtime.configs, response.sourceRuns.map((r) => r.source));
    await Promise.all([
      searchId ? completeSearchRow(supabase, searchId, response, response.outcome === "FAILED" ? 0 : ttl) : null,
      insertRequestLogs(supabase, workspace.id, searchId, [...geoLogs, ...logs]),
      persistBreakers(supabase, workspace.id, runtime.breakers),
    ]).catch(() => undefined);
    void pruneDiscoveryData(supabase, workspace.id).catch(() => undefined);
    emit({ type: "phase", status: response.status, message: "Concluído." });
    return response;
  } catch (err) {
    if (searchId) await failSearchRow(supabase, searchId, input.signal?.aborted ? "CANCELLED" : "FAILED", err instanceof Error ? err.message : String(err)).catch(() => undefined);
    await persistBreakers(supabase, workspace.id, runtime.breakers).catch(() => undefined);
    throw err;
  }
}

/** A unified record re-expressed as one source record, keeping every identity key (for re-merges). */
export function unifiedToRecord(u: UnifiedCompany): SourceCompany {
  const primary = u.sources[0];
  return {
    source: primary?.source ?? u.sourceKeys[0] ?? "local_db",
    sourceRecordId: primary?.recordId ?? u.key,
    sourceUrl: primary?.url ?? null,
    collectedAt: new Date().toISOString(),
    companyId: u.companyId,
    linkedRecordIds: u.sources
      .filter((s) => s.source.startsWith("osm_"))
      .map((s) => `osm:${s.recordId}`),
    hasDecisionMaker: u.hasDecisionMaker,
    name: u.name,
    legalName: u.legalName,
    cnpj: u.cnpj,
    cnpjStatus: u.cnpjStatus,
    category: u.category,
    street: u.street,
    houseNumber: u.houseNumber,
    neighborhood: u.neighborhood,
    city: u.city,
    state: u.state,
    postcode: u.postcode,
    phone: u.phone,
    phones: u.phones,
    whatsapp: u.whatsapp,
    email: u.email,
    website: u.website,
    lat: u.lat,
    lon: u.lon,
    socials: u.socials,
    matchedBy: primary?.matchedBy ?? "keyword",
    confidence: u.confidence,
  };
}

export async function executeEnrichment(input: {
  supabase: Client;
  workspace: Workspace;
  searchId: string | null;
  companies: UnifiedCompany[];
  signal?: AbortSignal;
}): Promise<EnrichOutput> {
  const runtime = await loadRuntime(input.supabase, input.workspace);
  const out = await enrichCompanies(input.companies, {
    sources: runtime.enrichmentSources,
    configs: runtime.configs,
    breakers: runtime.breakers,
    fieldPriority: runtime.fieldPriority,
    signal: input.signal,
    deadlineMs: 25_000,
  });
  await Promise.all([
    persistBreakers(input.supabase, input.workspace.id, runtime.breakers),
    insertRequestLogs(input.supabase, input.workspace.id, input.searchId, out.logs),
    input.searchId ? mergeEnrichedIntoSearch(input.supabase, input.workspace.id, input.searchId, out.companies) : null,
  ]).catch(() => undefined);
  return out;
}

async function mergeEnrichedIntoSearch(supabase: Client, workspaceId: string, searchId: string, enriched: UnifiedCompany[]) {
  const row = await getSearchRow(supabase, workspaceId, searchId);
  if (!row) return;
  const byKey = new Map(enriched.map((c) => [c.key, c]));
  const results = (row.results as unknown as UnifiedCompany[]).map((c) => byKey.get(c.key) ?? c);
  const funnel = (row.funnel as { source: string; enriched: number }[]).map((f) => ({ ...f }));
  for (const c of enriched) {
    if (c.enrichment.state !== "DONE") continue;
    for (const f of funnel) if (c.sourceKeys.includes(f.source as SourceKey)) f.enriched += 1;
  }
  await updateSearchResults(supabase, searchId, results, { funnel });
}

export const ALL_DISCOVERY_SOURCES = DISCOVERY_SOURCE_KEYS;
