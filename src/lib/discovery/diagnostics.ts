import "server-only";

/**
 * Source connectivity tests (admin: TEST CONNECTION / TEST ALL SOURCES).
 * Runs each adapter with a tiny, real query and reports status, latency,
 * count and the normalized error — using the same code path as searches,
 * so a green test means searches will work.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Workspace } from "@/types/database";
import { normalizeSearchContext } from "./context";
import { expandIndustry, getIndustry, type IndustryExpansion } from "./industries";
import { mergeSourceCompanies } from "./merge";
import { nominatimGeo } from "./sources/nominatim";
import { loadRuntime } from "./service";
import { insertRequestLogs, persistBreakers } from "./store";
import type { RequestLog, ResolvedLocation, SourceKey, SourceRunStatus, UnifiedCompany } from "./types";
import { isFailedRun } from "./types";

export interface SourceTestInput {
  city?: string;
  state?: string;
  lat?: number | null;
  lon?: number | null;
  radiusKm?: number | null;
  /** OSM tag ("amenity=restaurant") or a free-text keyword ("pizzaria"). */
  query?: string;
  cnpj?: string;
  website?: string;
}

export interface SourceTestResult {
  source: SourceKey;
  status: SourceRunStatus | "SKIPPED";
  ok: boolean;
  latencyMs: number;
  count: number;
  sample: string[];
  error: string | null;
  endpoints: string[];
  queries: string[];
  logs: RequestLog[];
}

const TAG_RE = /^([a-z][a-z0-9_:]*)=([a-z0-9_;:.-]+)$/;

export async function runSourceTest(
  supabase: SupabaseClient<Database>,
  workspace: Workspace,
  source: SourceKey,
  input: SourceTestInput
): Promise<SourceTestResult> {
  const started = Date.now();
  const runtime = await loadRuntime(supabase, workspace);
  const controller = new AbortController();
  const deadline = Date.now() + 30_000;
  const timer = setTimeout(() => controller.abort(), 30_000);
  const base: SourceTestResult = { source, status: "SKIPPED", ok: false, latencyMs: 0, count: 0, sample: [], error: null, endpoints: [], queries: [], logs: [] };

  try {
    const env = { signal: controller.signal, deadline, config: runtime.configs[source], breakers: runtime.breakers, http: {}, isFallback: false };

    if (source === "cnpj_brasilapi" || source === "website_discovery") {
      const enr = runtime.enrichmentSources.find((s) => s.key === source)!;
      const stub = {
        key: "test",
        name: "Teste",
        cnpj: input.cnpj ?? "00000000000191",
        website: input.website ?? "https://www.openstreetmap.org",
        sourceKeys: [],
        sources: [],
        socials: {},
        provenance: {},
        conflicts: [],
        phones: [],
        warnings: [],
      } as unknown as UnifiedCompany;
      const patch = await enr.enrich(stub, env);
      const ok = !isFailedRun(patch.status);
      if (ok) runtime.breakers.recordSuccess(source, { latencyMs: patch.durationMs, results: 1, status: patch.status });
      else runtime.breakers.recordFailure(source, { latencyMs: patch.durationMs, error: patch.message ?? patch.status, kind: patch.status, status: patch.status });
      return {
        ...base,
        status: patch.status,
        ok,
        latencyMs: Date.now() - started,
        count: Object.values(patch.fields).filter(Boolean).length,
        sample: Object.entries(patch.fields)
          .filter(([, v]) => v && typeof v === "string")
          .slice(0, 5)
          .map(([k, v]) => `${k}: ${v}`),
        error: ok ? null : patch.message,
        logs: patch.logs,
        endpoints: patch.logs.map((l) => l.endpoint),
        queries: patch.logs.map((l) => l.query),
      };
    }

    const discovery = runtime.discoverySources[source];
    if (!discovery) return { ...base, error: "Fonte não testável (validação manual)." };

    const ctx = normalizeSearchContext({
      city: input.city || workspace.city || "Sobral",
      state: input.state || workspace.state || "CE",
      radiusKm: input.lat != null && input.lon != null ? input.radiusKm ?? 2 : input.radiusKm ?? null,
      industryKey: "restaurante",
      mode: "PRECISE",
      limit: 50,
    });

    const q = (input.query ?? "").trim();
    let expansion: IndustryExpansion = expandIndustry(getIndustry("restaurante"), { mode: "PRECISE" });
    const tag = q.match(TAG_RE);
    if (tag) expansion = { ...expansion, osmTags: [{ key: tag[1], value: tag[2] }], textTerms: [tag[2].replace(/_/g, " ")], nameKeywords: [] };
    else if (q) expansion = { ...expansion, osmTags: [], textTerms: [q], nameKeywords: [q] };

    let location: ResolvedLocation | null = null;
    if (input.lat != null && input.lon != null) {
      location = { city: ctx.city, state: ctx.state, displayName: "coordenadas informadas", lat: input.lat, lon: input.lon, bbox: null, osmRelationId: null, source: "osm_nominatim", confidence: "HIGH" };
      const d = (input.radiusKm ?? 2) / 111;
      location.bbox = { south: input.lat - d, north: input.lat + d, west: input.lon - d, east: input.lon + d };
    } else if (discovery.requiresLocation) {
      location = (await nominatimGeo.geocodeCity(ctx.city, ctx.state, { ...env, config: runtime.configs.osm_nominatim })).location;
    }

    const run = await discovery.search(
      { context: ctx, expansion, location, resolveLocation: async () => location ?? (await nominatimGeo.geocodeCity(ctx.city, ctx.state, { ...env, config: runtime.configs.osm_nominatim })).location },
      env
    );
    const ok = !isFailedRun(run.status);
    if (ok) runtime.breakers.recordSuccess(source, { latencyMs: run.metadata.durationMs, results: run.results.length, status: run.status });
    else {
      const last = run.errors[run.errors.length - 1];
      runtime.breakers.recordFailure(source, { latencyMs: run.metadata.durationMs, error: last?.message ?? run.status, kind: last?.kind ?? "NETWORK", status: run.status });
    }
    const unique = mergeSourceCompanies(run.results, { targetCity: ctx.city }).companies;
    return {
      ...base,
      status: run.status,
      ok,
      latencyMs: Date.now() - started,
      count: unique.length,
      sample: unique.slice(0, 8).map((c) => c.name),
      error: ok ? (run.warnings[0] ?? null) : run.errors.map((e) => `${e.kind}${e.httpStatus ? ` ${e.httpStatus}` : ""}: ${e.message}`).join(" | "),
      endpoints: [...new Set(run.metadata.endpointsTried.length ? run.metadata.endpointsTried : run.logs.map((l) => l.endpoint))],
      queries: run.metadata.queries,
      logs: run.logs,
    };
  } catch (err) {
    return { ...base, status: "SOURCE_ERROR", latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    await Promise.all([
      persistBreakers(supabase, workspace.id, runtime.breakers),
    ]).catch(() => undefined);
  }
}

export async function persistTestLogs(supabase: SupabaseClient<Database>, workspaceId: string, results: SourceTestResult[]) {
  await insertRequestLogs(supabase, workspaceId, null, results.flatMap((r) => r.logs)).catch(() => undefined);
}
