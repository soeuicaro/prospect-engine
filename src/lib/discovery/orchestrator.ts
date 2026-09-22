/**
 * Discovery Orchestrator.
 *
 *   SEARCH REQUEST → validate → SearchContext → expansion (industry
 *   keywords/tags/CNAEs) → geocode (cached; Nominatim → Photon) in
 *   parallel with location-independent sources → run sources in parallel
 *   (each isolated: a throw or timeout becomes that source's status, never
 *   the search's) → fallback chain on failure/low yield → automatic
 *   keyword variations if still low (disclosed) → merge/dedup → visible
 *   filters → rank → diagnostics/suggestions → SearchResponse.
 *
 * Pure with respect to I/O: sources, geocoders, breakers, config and the
 * geocode cache are injected, so every failure mode is unit-testable
 * (orchestrator.test.ts). Persistence (search log, health, request logs)
 * is the caller's job (lib/discovery/service.ts).
 */

import { BreakerRegistry } from "./circuit-breaker";
import { computeCacheKey, SYSTEM_RESULT_LIMIT } from "./context";
import type { HttpDeps } from "./http";
import { expandIndustry, formatOsmTag, getIndustry, type IndustryDefinition, type IndustryExpansion } from "./industries";
import { mergeSourceCompanies, citiesCompatible } from "./merge";
import { foldText, inBbox } from "./normalize";
import { getSourceDefinition, PRIMARY_DISCOVERY_SOURCES, type FieldPriority, type SourceConfigMap } from "./registry";
import type { DiscoverySource, GeoSource, SourceEnv } from "./sources/base";
import { userMessageFor } from "./sources/base";
import {
  isFailedRun,
  type ExpansionSuggestion,
  type FilterDiagnostic,
  type RequestLog,
  type ResolvedLocation,
  type SearchContext,
  type SearchOutcome,
  type SearchResponse,
  type SearchStreamEvent,
  type SourceFunnelMetrics,
  type SourceKey,
  type SourceRunResult,
  type UnifiedCompany,
} from "./types";

export const DEPTH_DEADLINE_MS: Record<SearchContext["depth"], number> = { FAST: 20_000, BALANCED: 40_000, DEEP: 55_000 };
/** Below this many unique results the engine tries fallbacks / variations. */
export const LOW_RESULT_THRESHOLD = 20;
/** How long aborted sources get to hand back partial results. */
export const ABORT_GRACE_MS = 1500;

export interface GeocodeCache {
  get(key: string): Promise<ResolvedLocation | null | undefined>;
  set(key: string, value: ResolvedLocation): Promise<void>;
}

export interface OrchestratorDeps {
  sources: Partial<Record<SourceKey, DiscoverySource>>;
  geoSources: GeoSource[];
  configs: SourceConfigMap;
  breakers: BreakerRegistry;
  http?: HttpDeps;
  fieldPriority?: FieldPriority;
  customIndustry?: IndustryDefinition | null;
  geocodeCache?: GeocodeCache;
  emit?: (event: SearchStreamEvent) => void;
  signal?: AbortSignal;
  costMode?: "FREE_ONLY" | "MANUAL_OVERRIDE";
  deadlineMs?: number;
  now?: () => number;
}

export interface OrchestratorOutput {
  response: SearchResponse;
  logs: RequestLog[];
  geoLogs: RequestLog[];
}

function failedRun(source: SourceKey, status: SourceRunResult["status"], message: string, isFallback: boolean, requested: number): SourceRunResult {
  const label = getSourceDefinition(source).label;
  return {
    source,
    status,
    results: [],
    metadata: {
      source,
      requested,
      returned: 0,
      page: 1,
      pages: 0,
      hasMore: false,
      durationMs: 0,
      attempts: 0,
      status,
      sourceLimit: null,
      strategy: null,
      queries: [],
      endpointsTried: [],
      invalid: 0,
      invalidReasons: {},
    },
    warnings: [],
    errors: [{ kind: status === "SOURCE_CIRCUIT_OPEN" ? "CIRCUIT_OPEN" : status === "SOURCE_TIMEOUT" ? "TIMEOUT" : "NETWORK", message }],
    logs: [],
    coverage: null,
    isFallback,
    userMessage: userMessageFor(status, label),
  };
}

export async function runDiscovery(ctx: SearchContext, deps: OrchestratorDeps): Promise<OrchestratorOutput> {
  const now = deps.now ?? Date.now;
  const started = now();
  const emit = deps.emit ?? (() => {});
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  deps.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const deadline = started + (deps.deadlineMs ?? DEPTH_DEADLINE_MS[ctx.depth]);
  let deadlineHit = false;
  const deadlineTimer = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
  }, Math.max(0, deadline - started));

  try {
    emit({ type: "phase", status: "SEARCHING", message: "Buscando empresas..." });

    // ---- expansion ------------------------------------------------------
    const industry = deps.customIndustry ?? getIndustry(ctx.industryKey);
    const baseExpansion = expandIndustry(industry, {
      mode: ctx.mode,
      extraKeywords: ctx.keywords,
      includeRelatedCnaes: ctx.includeRelatedCnaes,
      expandKeywords: ctx.expandKeywords,
    });
    const expansion: IndustryExpansion = { ...baseExpansion, cnaes: [...new Set([...baseExpansion.cnaes, ...ctx.cnaes])] };

    // ---- source selection -----------------------------------------------
    const allowed = (key: SourceKey) => {
      const src = deps.sources[key];
      const cfg = deps.configs[key];
      if (!src || !cfg?.enabled) return false;
      if ((deps.costMode ?? "FREE_ONLY") === "FREE_ONLY" && src.cost !== "FREE") return false;
      return true;
    };
    const userEnabled = ctx.sourcesEnabled.filter(allowed);
    const primary = ctx.depth === "FAST" ? userEnabled.filter((k) => PRIMARY_DISCOVERY_SOURCES.includes(k)) : userEnabled;
    const fallbackPool = [
      ...new Set(primary.flatMap((k) => (deps.configs[k].fallbackEnabled ? deps.configs[k].fallbackTo : []))),
    ].filter((k) => userEnabled.includes(k) && !primary.includes(k));

    const runs = new Map<SourceKey, SourceRunResult>();
    const launched = new Set<SourceKey>();
    const pending: Promise<void>[] = [];
    const logs: RequestLog[] = [];
    const lowResultReasons: string[] = [];
    const locationStrategy: string[] = [];

    // ---- geocode (lazy, shared) -------------------------------------------
    let geoLogs: RequestLog[] = [];
    let geoPromise: Promise<ResolvedLocation | null> | null = null;
    const geoEnvFor = (key: SourceKey): SourceEnv => ({
      signal: controller.signal,
      deadline,
      // Geocoding is on the critical path of text sources: keep it tight.
      config: { ...deps.configs[key], timeoutMs: Math.min(8000, deps.configs[key].timeoutMs), retryCount: Math.min(1, deps.configs[key].retryCount) },
      breakers: deps.breakers,
      http: deps.http ?? {},
      isFallback: false,
    });
    const resolveLocation = () => {
      geoPromise ??= (async () => {
        const cacheKey = `geo:v1:${foldText(ctx.city)}:${ctx.state}`;
        const cached = await deps.geocodeCache?.get(cacheKey).catch(() => undefined);
        if (cached) {
          locationStrategy.push(`geocode em cache (${cached.source})`);
          return cached;
        }
        let anyAnswered = false;
        for (const geo of deps.geoSources) {
          if (!deps.configs[geo.key]?.enabled || !deps.breakers.canRequest(`${geo.key}:geocode`)) continue;
          const t0 = now();
          const out = await geo.geocodeCity(ctx.city, ctx.state, geoEnvFor(geo.key));
          geoLogs = [...geoLogs, ...out.logs];
          if (out.error) {
            deps.breakers.recordFailure(`${geo.key}:geocode`, { latencyMs: now() - t0, error: out.error.message, kind: out.error.kind, status: "SOURCE_ERROR" });
            locationStrategy.push(`geocode ${geo.key} falhou (${out.error.kind})`);
            continue;
          }
          anyAnswered = true;
          deps.breakers.recordSuccess(`${geo.key}:geocode`, { latencyMs: now() - t0, results: out.location ? 1 : 0, status: "SOURCE_SUCCESS" });
          if (out.location && out.location.state === ctx.state) {
            locationStrategy.push(`geocode ${geo.key}`);
            await deps.geocodeCache?.set(cacheKey, out.location).catch(() => undefined);
            return out.location;
          }
          locationStrategy.push(`geocode ${geo.key}: cidade não encontrada`);
        }
        lowResultReasons.push(
          anyAnswered
            ? `A cidade "${ctx.city}/${ctx.state}" não foi encontrada nas fontes geográficas — confira a grafia.`
            : "Serviços de geocoding indisponíveis — fontes que dependem de bbox não puderam rodar."
        );
        return null;
      })();
      return geoPromise;
    };

    const needsGeo = (key: SourceKey) => Boolean(deps.sources[key]?.requiresLocation);

    const uniqueSoFar = () => mergeSourceCompanies([...runs.values()].flatMap((r) => r.results), { targetCity: ctx.city }).companies.length;

    const runSource = async (key: SourceKey, isFallback: boolean, overrideExpansion?: IndustryExpansion): Promise<SourceRunResult> => {
      const source = deps.sources[key]!;
      const config = deps.configs[key];
      const requested = Math.min(ctx.limit, config.maxResults);
      if (!source.isConfigured()) return failedRun(key, "SOURCE_NOT_CONFIGURED", "Fonte não configurada", isFallback, requested);
      if (!deps.breakers.canRequest(key)) {
        const secs = Math.ceil(deps.breakers.msUntilRetry(key) / 1000);
        return failedRun(key, "SOURCE_CIRCUIT_OPEN", `Circuit breaker aberto — nova tentativa em ~${secs}s`, isFallback, requested);
      }
      const location = needsGeo(key) ? await resolveLocation() : null;
      const t0 = now();
      try {
        const result = await source.search(
          { context: ctx, expansion: overrideExpansion ?? expansion, location, resolveLocation },
          { signal: controller.signal, deadline, config, breakers: deps.breakers, http: deps.http ?? {}, isFallback }
        );
        const latencyMs = now() - t0;
        const locationMissing = result.errors.some((e) => e.kind === "NOT_CONFIGURED");
        if (isFailedRun(result.status) && !locationMissing) {
          const last = result.errors[result.errors.length - 1];
          deps.breakers.recordFailure(key, { latencyMs, error: last?.message ?? result.status, kind: last?.kind ?? "NETWORK", status: result.status });
        } else if (!locationMissing) {
          deps.breakers.recordSuccess(key, { latencyMs, results: result.results.length, status: result.status });
        }
        return result;
      } catch (err) {
        // A throwing adapter must never take the aggregator down with it (§88).
        const message = err instanceof Error ? err.message : String(err);
        deps.breakers.recordFailure(key, { latencyMs: now() - t0, error: message, kind: "NETWORK", status: "SOURCE_ERROR" });
        return failedRun(key, deadlineHit ? "SOURCE_TIMEOUT" : "SOURCE_ERROR", message, isFallback, requested);
      }
    };

    const launch = (key: SourceKey, isFallback: boolean): Promise<void> => {
      if (launched.has(key)) return Promise.resolve();
      launched.add(key);
      const p = runSource(key, isFallback).then((result) => {
        runs.set(key, result);
        logs.push(...result.logs.map((l) => ({ ...l, fallbackActivated: l.fallbackActivated || isFallback })));
        emit({
          type: "source",
          source: key,
          status: result.status,
          returned: result.results.length,
          durationMs: result.metadata.durationMs,
          isFallback,
          message: result.userMessage,
        });
        const found = [...runs.values()].reduce((n, r) => n + r.results.length, 0);
        emit({ type: "progress", found, unique: uniqueSoFar(), message: `${found} encontradas até agora` });

        // Fallback chain: a failed or low-yield primary activates its fallbacks (§10, §60, §130).
        const cfg = deps.configs[key];
        const lowYield = result.results.length < LOW_RESULT_THRESHOLD;
        if (!isFallback && cfg.fallbackEnabled && (isFailedRun(result.status) || lowYield) && !controller.signal.aborted) {
          const next = cfg.fallbackTo.filter((k) => fallbackPool.includes(k) && !launched.has(k));
          if (next.length) {
            emit({ type: "phase", status: "SEARCHING", message: "Consultando fontes adicionais..." });
            pending.push(...next.map((k) => launch(k, true)));
          }
        }
      });
      pending.push(p);
      return p;
    };

    // Start geocoding right away (in parallel) — text sources, the city-area
    // filter and radius searches all use it; Overpass area queries don't wait for it.
    if ([...primary, ...fallbackPool].length) void resolveLocation();
    for (const key of primary) void launch(key, false);

    // Wait until no new work is scheduled (fallbacks may add more), bounded by the deadline.
    const deadlinePromise = new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve();
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    let settledCount = -1;
    while (settledCount !== pending.length && !controller.signal.aborted) {
      settledCount = pending.length;
      await Promise.race([Promise.all([...pending]), deadlinePromise]);
    }
    // Aborted sources return whatever they already collected as soon as they
    // see the signal — give them a brief grace period so those partial
    // results aren't thrown away.
    if (controller.signal.aborted && launched.size > runs.size) {
      await Promise.race([Promise.all([...pending]), new Promise((r) => setTimeout(r, ABORT_GRACE_MS))]);
    }
    for (const key of launched) {
      if (!runs.has(key)) {
        runs.set(
          key,
          failedRun(key, "SOURCE_TIMEOUT", deps.signal?.aborted ? "Busca cancelada" : "Prazo geral da busca atingido", false, ctx.limit)
        );
      }
    }

    // ---- automatic keyword variations (disclosed, §24) -----------------
    const broadeningApplied: string[] = [];
    const remaining = deadline - now();
    if (
      !controller.signal.aborted &&
      ctx.mode !== "PRECISE" &&
      ctx.expandKeywords &&
      remaining > 8000 &&
      uniqueSoFar() < Math.min(ctx.limit, LOW_RESULT_THRESHOLD)
    ) {
      const textSources = (["osm_nominatim", "osm_photon"] as SourceKey[]).filter((k) => userEnabled.includes(k) && deps.breakers.canRequest(k));
      const extraTerms = expansion.availableTerms.slice(0, 4);
      const extraTags = expansion.availableOsmTags;
      const variations: Promise<void>[] = [];
      if (extraTerms.length) {
        for (const key of textSources) {
          broadeningApplied.push(`${getSourceDefinition(key).shortLabel}: ${extraTerms.join(", ")}`);
          variations.push(
            runSource(key, true, { ...expansion, textTerms: extraTerms }).then((r) => mergeRun(runs, key, r, logs))
          );
        }
      }
      if (extraTags.length && userEnabled.includes("osm_overpass") && deps.breakers.canRequest("osm_overpass")) {
        broadeningApplied.push(`OSM: tags ${extraTags.map(formatOsmTag).join(", ")}`);
        variations.push(
          runSource("osm_overpass", true, { ...expansion, osmTags: extraTags, nameKeywords: [] }).then((r) => mergeRun(runs, "osm_overpass", r, logs))
        );
      }
      if (variations.length) {
        emit({ type: "phase", status: "SEARCHING", message: "Poucos resultados — aplicando variações do nicho..." });
        await Promise.race([Promise.all(variations), deadlinePromise]);
      }
    }

    // ---- merge ------------------------------------------------------------
    emit({ type: "phase", status: "MERGING", message: "Consolidando e removendo duplicatas..." });
    const allRuns = [...runs.values()];
    const records = allRuns.flatMap((r) => r.results);
    const merged = mergeSourceCompanies(records, { targetCity: ctx.city, fieldPriority: deps.fieldPriority });
    // Only use the geocode if it already finished — never wait on it here.
    const inflight = geoPromise as Promise<ResolvedLocation | null> | null;
    const location: ResolvedLocation | null = inflight ? await Promise.race([inflight, Promise.resolve(null)]) : null;

    // ---- visible filters (§53-54: nothing hidden) -------------------------
    const target = foldText(ctx.city);
    const filters: FilterDiagnostic[] = [];
    const removedKeys = new Set<string>();
    const applyFilter = (key: string, label: string, active: boolean, predicate: (c: UnifiedCompany) => boolean) => {
      let removed = 0;
      if (active) {
        for (const c of merged.companies) {
          if (removedKeys.has(c.key)) continue;
          if (predicate(c)) {
            removedKeys.add(c.key);
            removed++;
          }
        }
      }
      filters.push({ key, label, removed, active });
    };
    applyFilter("city", `Endereço em outra cidade (≠ ${ctx.city})`, !ctx.radiusKm, (c) => Boolean(c.city) && !citiesCompatible(foldText(c.city), target));
    applyFilter(
      "outside_area",
      "Coordenadas fora da área da cidade (sem cidade no endereço)",
      !ctx.radiusKm && Boolean(location?.bbox),
      (c) => !c.city && c.lat != null && c.lon != null && c.sourceKeys.every((s) => s !== "local_db") && !inBbox({ lat: c.lat, lon: c.lon }, location!.bbox!)
    );
    const statusFilter = ctx.cnpjStatus.length ? ctx.cnpjStatus : ctx.mode === "PRECISE" ? ["ATIVA", "SUSPENSA"] : [];
    applyFilter(
      "cnpj_status",
      statusFilter.length ? `Situação cadastral fora de: ${statusFilter.join(", ")} (empresas sem CNPJ são mantidas)` : "Situação cadastral",
      statusFilter.length > 0,
      (c) => Boolean(c.cnpjStatus) && !statusFilter.includes(c.cnpjStatus!)
    );
    applyFilter("low_confidence", "Confiança baixa (modo Preciso)", ctx.mode === "PRECISE", (c) => c.confidence === "LOW");

    let results = merged.companies.filter((c) => !removedKeys.has(c.key));
    const hitSystemLimit = results.length > SYSTEM_RESULT_LIMIT;

    // ---- rank -------------------------------------------------------------
    emit({ type: "phase", status: "SCORING", message: "Calculando completude e prioridade..." });
    results.sort((a, b) =>
      ctx.sort === "name"
        ? a.name.localeCompare(b.name, "pt-BR")
        : ctx.sort === "completeness"
          ? b.completeness - a.completeness || b.rankScore - a.rankScore
          : b.rankScore - a.rankScore || b.completeness - a.completeness
    );
    if (hitSystemLimit) results = results.slice(0, SYSTEM_RESULT_LIMIT);
    const enrichBudget = ctx.depth === "FAST" ? 0 : ctx.depth === "DEEP" ? Math.max(ctx.autoEnrichTop, 50) : ctx.autoEnrichTop;
    results.forEach((c, i) => {
      if (i >= enrichBudget) c.enrichment = { state: "SKIPPED", sources: [], message: "Fora do lote de enriquecimento automático" };
    });

    // ---- metrics ----------------------------------------------------------
    const finalKeys = new Set(results.map((c) => c.key));
    const funnel: SourceFunnelMetrics[] = allRuns.map((run) => {
      const idxStart = records.indexOf(run.results[0]);
      const memberKeys = run.results.map((_, i) => merged.clusterOf.get(idxStart + i)!).filter(Boolean);
      const per = merged.perSource[run.source] ?? { members: 0, primary: 0 };
      return {
        source: run.source,
        status: run.status,
        isFallback: run.isFallback,
        requested: run.metadata.requested,
        returned: run.results.length + run.metadata.invalid,
        invalid: run.metadata.invalid,
        valid: run.results.length,
        duplicate: Math.max(0, per.members - per.primary),
        filtered: memberKeys.filter((k) => removedKeys.has(k)).length,
        accepted: new Set(memberKeys.filter((k) => finalKeys.has(k))).size,
        enriched: 0,
        durationMs: run.metadata.durationMs,
        attempts: run.metadata.attempts,
        sourceLimit: run.metadata.sourceLimit,
        strategy: run.metadata.strategy,
      };
    });

    const raw = funnel.reduce((n, f) => n + f.returned, 0);
    const valid = records.length;
    const counts = {
      raw,
      valid,
      normalized: valid,
      duplicates: merged.duplicateRecords,
      filtered: removedKeys.size,
      final: results.length,
    };

    const summary = {
      found: valid,
      unique: merged.companies.length,
      withPhone: results.filter((c) => c.phone || c.whatsapp).length,
      withWebsite: results.filter((c) => c.website).length,
      withEmail: results.filter((c) => c.email).length,
      withInstagram: results.filter((c) => c.socials.instagram).length,
      withCnpj: results.filter((c) => c.cnpj).length,
      existingInDb: results.filter((c) => c.companyId).length,
      newCompanies: results.filter((c) => !c.companyId).length,
      needsReview: results.filter((c) => c.qualityLabel === "NEEDS_REVIEW").length,
    };

    // ---- outcome ----------------------------------------------------------
    const failed = allRuns.filter((r) => isFailedRun(r.status) || r.status === "SOURCE_NOT_CONFIGURED");
    const partialRuns = allRuns.filter((r) => r.status === "SOURCE_PARTIAL_RESULTS");
    const cancelled = Boolean(deps.signal?.aborted);
    let outcome: SearchOutcome;
    if (allRuns.length > 0 && failed.length === allRuns.length && results.length === 0) outcome = "FAILED";
    else if (allRuns.length === 0) outcome = "FAILED";
    else if (results.length === 0) outcome = failed.length ? "PARTIAL" : "NO_RESULTS";
    else if (deadlineHit || cancelled || partialRuns.length) outcome = "PARTIAL";
    else if (failed.length) outcome = "SUCCESS_WITH_WARNINGS";
    else outcome = "SUCCESS";

    const userMessages: string[] = [];
    if (allRuns.length === 0) userMessages.push("Nenhuma fonte de descoberta está habilitada. Ative fontes em Configurações → Fontes.");
    if (outcome === "FAILED" && allRuns.length) userMessages.push("Não foi possível realizar a busca agora. Todas as fontes configuradas falharam.");
    else if (failed.length) userMessages.push("Uma das fontes apresentou instabilidade; os resultados disponíveis foram consolidados.");
    if (deadlineHit && !cancelled) userMessages.push("Algumas fontes não terminaram dentro do tempo limite — resultados parciais disponíveis.");
    if (cancelled) userMessages.push("Busca cancelada — resultados parciais mantidos.");
    for (const r of allRuns) if (r.userMessage && (isFailedRun(r.status) || r.status === "SOURCE_PARTIAL_RESULTS")) userMessages.push(r.userMessage);

    // ---- diagnostics: why so few? (§23, §59) ------------------------------
    for (const f of funnel) {
      const label = getSourceDefinition(f.source).label;
      if (isFailedRun(f.status)) lowResultReasons.push(`${label}: falhou (${f.status}).`);
      else lowResultReasons.push(`${label}: ${f.valid} registro(s) válidos${f.invalid ? `, ${f.invalid} descartado(s) na origem` : ""}${f.sourceLimit && f.valid >= f.sourceLimit ? ` — limite da fonte (${f.sourceLimit}) atingido` : ""}.`);
    }
    const localRun = runs.get("local_db");
    if (localRun && localRun.results.length === 0 && !isFailedRun(localRun.status)) {
      lowResultReasons.push("Banco local sem empresas para esta cidade/nicho — importe a base CNPJ (tools/cnpj-importer → Imports) para cobertura cadastral completa.");
    }
    if (merged.duplicateRecords) lowResultReasons.push(`${merged.duplicateRecords} registro(s) eram duplicatas e foram consolidados.`);
    for (const f of filters) if (f.active && f.removed) lowResultReasons.push(`${f.removed} removido(s) pelo filtro "${f.label}".`);
    lowResultReasons.push(`Resultado final: ${results.length} empresa(s) únicas.`);

    const suggestions = buildSuggestions(ctx, expansion, results.length, userEnabled, deps);

    const avgCompleteness = results.length ? results.reduce((n, c) => n + c.completeness, 0) / results.length : 0;
    const highShare = results.length ? results.filter((c) => c.confidence === "HIGH").length / results.length : 0;
    const healthyShare = allRuns.length ? (allRuns.length - failed.length) / allRuns.length : 0;
    const coveragePct = Math.min(100, Math.round((results.length / Math.max(1, ctx.limit)) * 100));
    const qualityScore = Math.round((coveragePct / 100) * 30 + avgCompleteness * 0.35 + highShare * 20 + healthyShare * 15);

    const status = cancelled ? "CANCELLED" : outcome === "FAILED" ? "FAILED" : outcome === "PARTIAL" ? "PARTIAL" : "COMPLETED";

    const response: SearchResponse = {
      searchId: null,
      cacheKey: await computeCacheKey(ctx),
      fromCache: false,
      outcome,
      status,
      partialResults: outcome === "PARTIAL",
      context: ctx,
      results,
      counts,
      summary,
      sourceRuns: allRuns.map(withoutPayload),
      funnel,
      diagnostics: {
        location,
        locationStrategy,
        appliedTerms: expansion.textTerms,
        appliedOsmTags: expansion.osmTags.map(formatOsmTag),
        appliedCnaes: expansion.cnaes,
        broadeningApplied,
        filters,
        limits: {
          requestedLimit: ctx.limit,
          systemLimit: SYSTEM_RESULT_LIMIT,
          sourceLimits: Object.fromEntries(allRuns.map((r) => [r.source, r.metadata.sourceLimit ?? deps.configs[r.source].maxResults])),
        },
        lowResultReasons,
        deadlineHit,
        cancelled,
      },
      suggestions,
      userMessages: [...new Set(userMessages)],
      coverage: { requested: ctx.limit, found: results.length, percent: coveragePct },
      qualityScore,
      durationMs: now() - started,
      createdAt: new Date(started).toISOString(),
    };
    return { response, logs, geoLogs };
  } finally {
    clearTimeout(deadlineTimer);
    deps.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Source run summary for the response: records/logs travel separately. */
function withoutPayload(run: SourceRunResult): Omit<SourceRunResult, "results" | "logs"> {
  const summary: Partial<SourceRunResult> = { ...run };
  delete summary.results;
  delete summary.logs;
  return summary as Omit<SourceRunResult, "results" | "logs">;
}

function mergeRun(runs: Map<SourceKey, SourceRunResult>, key: SourceKey, extra: SourceRunResult, logs: RequestLog[]) {
  logs.push(...extra.logs.map((l) => ({ ...l, fallbackActivated: true })));
  const base = runs.get(key);
  if (!base) {
    runs.set(key, extra);
    return;
  }
  const seen = new Set(base.results.map((r) => r.sourceRecordId));
  base.results.push(...extra.results.filter((r) => !seen.has(r.sourceRecordId)));
  base.metadata.returned = base.results.length;
  base.metadata.invalid += extra.metadata.invalid;
  base.metadata.queries.push(...extra.metadata.queries);
  base.metadata.attempts += extra.metadata.attempts;
  base.warnings.push(...extra.warnings);
  // A variation that worked turns an earlier failure/empty run into a success with warnings.
  if (extra.results.length && (isFailedRun(base.status) || base.status === "NO_RESULTS_FROM_SOURCE")) base.status = "SOURCE_SUCCESS_WITH_WARNINGS";
}

function buildSuggestions(
  ctx: SearchContext,
  expansion: IndustryExpansion,
  found: number,
  userEnabled: SourceKey[],
  deps: OrchestratorDeps
): ExpansionSuggestion[] {
  if (found >= ctx.limit) return [];
  const out: ExpansionSuggestion[] = [];
  const nextRadius = ctx.radiusKm ? Math.min(100, ctx.radiusKm * 2) : 15;
  if (!ctx.radiusKm || ctx.radiusKm < 100) {
    out.push({
      kind: "radius",
      label: ctx.radiusKm ? `Expandir raio ${ctx.radiusKm}km → ${nextRadius}km` : `Buscar num raio de ${nextRadius} km`,
      description: "Usa o centro da cidade e um raio em vez do limite municipal.",
      patch: { radiusKm: nextRadius },
    });
  }
  if (expansion.availableTerms.length) {
    const terms = expansion.availableTerms.slice(0, 5);
    out.push({
      kind: "keywords",
      label: `Adicionar ${terms.length} termos relacionados`,
      description: terms.join(", "),
      patch: { keywords: [...new Set([...ctx.keywords, ...terms])] },
    });
  }
  if (expansion.availableCnaes.length && !ctx.includeRelatedCnaes) {
    out.push({
      kind: "cnaes",
      label: "Incluir CNAEs correlatos",
      description: expansion.availableCnaes.join(", "),
      patch: { includeRelatedCnaes: true },
    });
  }
  if (!ctx.radiusKm || ctx.radiusKm < 30) {
    out.push({
      kind: "nearby_cities",
      label: "Incluir cidades vizinhas",
      description: "Raio de 30 km a partir do centro — cobre municípios próximos.",
      patch: { radiusKm: 30 },
    });
  }
  const disabled = (Object.keys(deps.sources) as SourceKey[]).filter((k) => deps.configs[k]?.enabled && !userEnabled.includes(k));
  if (disabled.length || ctx.depth === "FAST") {
    out.push({
      kind: "sources",
      label: "Ativar outras fontes",
      description: disabled.length ? disabled.map((k) => getSourceDefinition(k).shortLabel).join(", ") : "Profundidade Balanceada usa todas as fontes gratuitas",
      patch: { sourcesEnabled: [...new Set([...ctx.sourcesEnabled, ...disabled])], depth: ctx.depth === "FAST" ? "BALANCED" : ctx.depth },
    });
  }
  if (ctx.mode !== "BROAD") {
    out.push({ kind: "mode", label: "Modo Amplo", description: "Mais tags, sinônimos e busca por nome.", patch: { mode: "BROAD" } });
  }
  return out;
}
