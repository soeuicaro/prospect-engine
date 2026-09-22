/**
 * OpenStreetMap — Overpass API adapter.
 *
 * What was wrong before (see OSM.md "Causa raiz"):
 * - one hard-coded endpoint (overpass-api.de), no timeout, no retry — a
 *   504/429 from an overloaded public server became a fatal search error;
 * - HTTP 200 responses carrying `remark: "runtime error: Query timed out"`
 *   (Overpass's way of saying "partial/empty result") were treated as a
 *   complete answer — the likely source of "2 results";
 * - a single tag per search (amenity=restaurant) and only node/way
 *   (relations dropped), `node/<id>` hard-coded even for ways.
 *
 * Now: municipality-boundary query (no geocoder needed), bbox/radius
 * fallbacks, all niche tags in ONE request, 3 mirrors each behind its own
 * circuit breaker, remark detection with best-partial retention.
 */

import { requestWithPolicy, SourceRequestError } from "../http";
import { buildOverpassQuery, OsmQueryError, type OsmLocation } from "../osm-query-builder";
import { throttleFor } from "../rate-limit";
import type { RequestLog, SourceCompany, SourceRunResult } from "../types";
import {
  emptyMetadata,
  errorEntry,
  finalizeRun,
  type DiscoverySource,
  type SourceEnv,
  type SourceSearchInput,
} from "./base";
import { osmAddressFields, osmCategory, osmContactFields, osmName, osmRecordId, osmUrl } from "./osm-common";

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const LABEL = "OpenStreetMap";

interface OverpassElement {
  type: "node" | "way" | "relation" | "area";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
  remark?: string;
}

const PARTIAL_REMARK = /runtime (error|remark)|timed out|out of memory|Query run out/i;

export function mirrorBreakerKey(endpoint: string): string {
  return `osm_overpass@${new URL(endpoint).host}`;
}

/** Runs one query across mirrors. Keeps the largest partial answer seen. */
export async function runOverpassQuery(
  query: string,
  env: SourceEnv,
  endpoints: string[] = OVERPASS_ENDPOINTS
): Promise<{
  data: OverpassResponse | null;
  partial: boolean;
  logs: RequestLog[];
  errors: SourceRunResult["errors"];
  endpointsTried: string[];
}> {
  const logs: RequestLog[] = [];
  const errors: SourceRunResult["errors"] = [];
  const endpointsTried: string[] = [];
  let bestPartial: OverpassResponse | null = null;
  const rounds = 1 + Math.max(0, env.config.retryCount);

  for (let round = 0; round < rounds; round++) {
    for (const [index, endpoint] of endpoints.entries()) {
      if (env.signal.aborted || Date.now() >= env.deadline) break;
      const bkey = mirrorBreakerKey(endpoint);
      const host = new URL(endpoint).host;
      if (!env.breakers.canRequest(bkey)) {
        if (round === 0) {
          errors.push({ kind: "CIRCUIT_OPEN", message: `Circuit breaker aberto para ${host}`, endpoint: host });
        }
        continue;
      }
      endpointsTried.push(host);
      const started = Date.now();
      try {
        const outcome = await requestWithPolicy<OverpassResponse>(
          {
            source: "osm_overpass",
            url: endpoint,
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: `data=${encodeURIComponent(query)}`,
            queryForLog: query,
            timeoutMs: env.config.timeoutMs,
            retries: 0, // move to the next mirror instead of hammering this one
            signal: env.signal,
            deadline: env.deadline,
            throttle: throttleFor(host, env.config.rateLimitPerSec),
            fallbackActivated: env.isFallback || index > 0 || round > 0,
            parse: (text) => {
              const json = JSON.parse(text) as OverpassResponse;
              if (!json || !Array.isArray(json.elements)) throw new Error("campo 'elements' ausente");
              return json;
            },
            validate: (data) => {
              if (data.remark && PARTIAL_REMARK.test(data.remark)) {
                if (!bestPartial || data.elements.length > bestPartial.elements.length) bestPartial = data;
                return { kind: "PARTIAL_RESPONSE", message: `Overpass: ${data.remark.slice(0, 160)}` };
              }
              return null;
            },
            countResults: (data) => data.elements.length,
          },
          env.http
        );
        logs.push(...outcome.logs);
        env.breakers.recordSuccess(bkey, { latencyMs: outcome.latencyMs, results: outcome.data.elements.length, status: "SOURCE_SUCCESS" });
        return { data: outcome.data, partial: false, logs, errors, endpointsTried };
      } catch (err) {
        const { entry, logs: errLogs } = errorEntry(err);
        logs.push(...errLogs);
        errors.push(entry);
        if (entry.kind === "ABORTED") return { data: bestPartial, partial: Boolean(bestPartial), logs, errors, endpointsTried };
        env.breakers.recordFailure(bkey, {
          latencyMs: Date.now() - started,
          error: entry.message,
          kind: entry.kind,
          status: entry.kind === "PARTIAL_RESPONSE" ? "SOURCE_PARTIAL_RESULTS" : "SOURCE_ERROR",
        });
        // HTTP 400 = our query is malformed; another mirror would reject it too.
        if (err instanceof SourceRequestError && err.kind === "HTTP_4XX" && err.httpStatus === 400) {
          return { data: bestPartial, partial: Boolean(bestPartial), logs, errors, endpointsTried };
        }
      }
    }
  }
  return { data: bestPartial, partial: Boolean(bestPartial), logs, errors, endpointsTried };
}

export function parseOverpassElements(
  elements: OverpassElement[],
  opts: { matchedBy: SourceCompany["matchedBy"]; collectedAt: string }
): { results: SourceCompany[]; invalid: number; invalidReasons: Record<string, number>; areaFound: boolean } {
  const seen = new Set<string>();
  const results: SourceCompany[] = [];
  const invalidReasons: Record<string, number> = {};
  let areaFound = false;
  const bump = (reason: string) => (invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1);

  for (const el of elements) {
    if (el.type === "area") {
      areaFound = true;
      continue;
    }
    const recordId = osmRecordId(el.type, el.id);
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const tags = el.tags ?? {};
    const name = osmName(tags);
    if (!name) {
      bump("sem nome no OSM");
      continue;
    }
    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    results.push({
      source: "osm_overpass",
      sourceRecordId: recordId,
      sourceUrl: osmUrl(recordId),
      collectedAt: opts.collectedAt,
      name,
      category: osmCategory(tags),
      ...osmAddressFields(tags),
      ...osmContactFields(tags),
      lat,
      lon,
      openingHours: tags.opening_hours ?? null,
      matchedBy: opts.matchedBy,
      confidence: "MEDIUM",
    });
  }
  const invalid = Object.values(invalidReasons).reduce((a, b) => a + b, 0);
  return { results, invalid, invalidReasons, areaFound };
}

export function createOverpassSource(opts: { endpoints?: string[] } = {}): DiscoverySource {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  return {
    key: "osm_overpass",
    kind: "discovery",
    cost: "FREE",
    requiresLocation: false,
    capabilities: {
      canSearch: true,
      canEnrich: false,
      canGeocode: false,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnCnpj: false,
      canReturnSocials: true,
      supportsPagination: "none",
    },
    isConfigured: () => endpoints.length > 0,

    async search(input: SourceSearchInput, env: SourceEnv): Promise<SourceRunResult> {
      const startedAt = Date.now();
      const { context, expansion, location } = input;
      const metadata = emptyMetadata("osm_overpass", Math.min(context.limit, env.config.maxResults));
      metadata.sourceLimit = env.config.maxResults;
      const logs: RequestLog[] = [];
      const errors: SourceRunResult["errors"] = [];
      const warnings: string[] = [];

      let nameKeywords = expansion.nameKeywords;
      if (!expansion.osmTags.length && !nameKeywords.length) nameKeywords = expansion.textTerms;
      if (!expansion.osmTags.length && !nameKeywords.length) {
        warnings.push("Nicho sem tags OSM nem palavras-chave mapeadas.");
        return finalizeRun("osm_overpass", LABEL, { results: [], metadata, warnings, logs, isFallback: env.isFallback, startedAt, status: "NO_RESULTS_FROM_SOURCE" });
      }

      // Strategies are resolved lazily: the municipality-area query needs no
      // geocoder, so a slow/failed Nominatim never delays Overpass.
      let geo = location;
      const getGeo = async () => (geo ??= (await input.resolveLocation?.()) ?? null);
      const strategies: { name: string; build: () => Promise<OsmLocation | null> }[] = [];
      if (context.radiusKm) {
        strategies.push({
          name: "radius",
          build: async () => {
            const g = await getGeo();
            return g ? { kind: "around", lat: g.lat, lon: g.lon, radiusM: context.radiusKm! * 1000 } : null;
          },
        });
      } else {
        strategies.push({ name: "area", build: async () => ({ kind: "area", city: location?.city ?? context.city, stateUf: context.state }) });
        strategies.push({
          name: "bbox",
          build: async () => {
            const g = await getGeo();
            return g?.bbox ? { kind: "bbox", ...g.bbox } : null;
          },
        });
      }

      const serverTimeoutSec = Math.max(8, Math.floor(env.config.timeoutMs / 1000) - 5);
      for (const [strategyIndex, strategy] of strategies.entries()) {
        const osmLocation = await strategy.build();
        if (!osmLocation) {
          warnings.push(strategy.name === "radius" ? "Busca por raio exige geocoding da cidade, que falhou." : "Sem bounding box do geocoder para tentar novamente.");
          continue;
        }
        const hasNextStrategy = strategyIndex < strategies.length - 1;
        // Tag clauses (index-backed, fast) and name-keyword clauses (regex over
        // every named object, slow) run as SEPARATE requests: in testing the
        // combined BROAD query timed out on every mirror and returned nothing,
        // while the tag query alone answered in ~11s. Name matching is a
        // best-effort bonus that never takes the tag results down with it.
        const passes: { kind: "tags" | "names"; tags: typeof expansion.osmTags; names: string[] }[] = [];
        if (expansion.osmTags.length) passes.push({ kind: "tags", tags: expansion.osmTags, names: [] });
        if (nameKeywords.length) passes.push({ kind: "names", tags: [], names: nameKeywords });

        let primary: ReturnType<typeof parseOverpassElements> | null = null;
        const collected = new Map<string, SourceCompany>();
        for (const pass of passes) {
          const isPrimary = primary === null;
          if (!isPrimary && env.deadline - Date.now() < 12_000) {
            warnings.push("Busca por nome no OSM pulada para respeitar o tempo limite.");
            break;
          }
          let query: string;
          try {
            query = buildOverpassQuery({ location: osmLocation, tags: pass.tags, nameKeywords: pass.names, timeoutSec: serverTimeoutSec, maxResults: env.config.maxResults });
          } catch (err) {
            errors.push({ kind: "HTTP_4XX", message: err instanceof OsmQueryError ? err.message : String(err) });
            continue;
          }
          metadata.queries.push(query);
          metadata.strategy = strategy.name;

          // The secondary (name) pass gets its own earlier deadline so it
          // times out by itself instead of running into the search deadline.
          const passEnv = isPrimary ? env : { ...env, deadline: env.deadline - 3000 };
          const run = await runOverpassQuery(query, passEnv, endpoints);
          logs.push(...run.logs);
          metadata.endpointsTried.push(...run.endpointsTried);
          if (!run.data) {
            if (isPrimary) errors.push(...run.errors);
            else warnings.push(`Busca por nome no OSM falhou (${run.errors[run.errors.length - 1]?.kind ?? "erro"}); resultados por tag mantidos.`);
            if (isPrimary) break;
            continue;
          }
          if (run.partial) {
            if (isPrimary) errors.push(...run.errors.filter((e) => e.kind === "PARTIAL_RESPONSE").slice(-1));
            warnings.push("Overpass devolveu resultado parcial (timeout no servidor).");
          } else if (run.errors.length) {
            warnings.push(`Mirror alternativo usado após falha em ${run.errors.length} tentativa(s).`);
          }
          const parsed = parseOverpassElements(run.data.elements, {
            matchedBy: pass.kind === "tags" ? "tag" : "name_keyword",
            collectedAt: new Date().toISOString(),
          });
          if (isPrimary) primary = parsed;
          metadata.invalid += parsed.invalid;
          for (const [k, v] of Object.entries(parsed.invalidReasons)) metadata.invalidReasons[k] = (metadata.invalidReasons[k] ?? 0) + v;
          for (const r of parsed.results) if (!collected.has(r.sourceRecordId)) collected.set(r.sourceRecordId, r);
          // Area not resolvable → no point running more passes on this strategy.
          if (strategy.name === "area" && !parsed.areaFound) break;
        }

        if (!primary) {
          if (errors.length) break; // network-level failure: another strategy would hit the same servers
          continue;
        }
        const primaryResult: ReturnType<typeof parseOverpassElements> = primary;
        if (strategy.name === "area" && !primaryResult.areaFound && hasNextStrategy) {
          warnings.push("Limite municipal não encontrado no OSM — usando bounding box do geocoder.");
          metadata.invalid = 0;
          metadata.invalidReasons = {};
          continue;
        }
        if (strategy.name === "area" && !primaryResult.areaFound) {
          warnings.push("Limite municipal não encontrado no OSM e sem geocoding disponível.");
        }
        if (strategy.name === "bbox") {
          warnings.push("Busca por bounding box pode incluir estabelecimentos de municípios vizinhos (filtrados por cidade quando o endereço existe).");
        }

        metadata.pages = passes.length;
        const all = [...collected.values()];
        const capped = all.slice(0, env.config.maxResults);
        metadata.hasMore = all.length > capped.length;
        return finalizeRun("osm_overpass", LABEL, {
          results: capped,
          metadata,
          warnings,
          errors,
          logs,
          isFallback: env.isFallback,
          startedAt,
          coverage: strategy.name === "area" ? `Município ${context.city}/${context.state} (limite OSM)` : strategy.name,
        });
      }

      return finalizeRun("osm_overpass", LABEL, { results: [], metadata, warnings, errors, logs, isFallback: env.isFallback, startedAt });
    },
  };
}

