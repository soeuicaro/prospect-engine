/**
 * OpenStreetMap — Nominatim adapter (geocoding + text POI search).
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * ≤1 request/second, identifying User-Agent, cache results, no bulk
 * crawling. Enforced here with a per-host throttle (≤1 req/s, clamped in
 * registry.ts), bounded pagination, and a geocode cache (geo-cache.ts).
 *
 * Previously geocodeCity() swallowed every failure as `null`, so a 429 or
 * timeout surfaced as "cidade não encontrada". Errors are now reported as
 * errors, and "not found" only when Nominatim actually answered with no
 * matching municipality.
 */

import { requestWithPolicy, SourceRequestError, jsonParser } from "../http";
import { foldText, UF_NAMES } from "../normalize";
import { throttleFor } from "../rate-limit";
import type { RequestLog, ResolvedLocation, SourceCompany, SourceRunResult } from "../types";
import {
  emptyMetadata,
  errorEntry,
  finalizeRun,
  type DiscoverySource,
  type GeoSource,
  type SourceEnv,
  type SourceSearchInput,
} from "./base";
import { osmCategory, osmContactFields, osmRecordId, osmUrl } from "./osm-common";

export const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const LABEL = "OpenStreetMap (Nominatim)";
const PAGE_SIZE = 40; // Nominatim hard maximum
const POI_CATEGORIES = new Set(["amenity", "shop", "craft", "office", "healthcare", "leisure", "tourism", "club"]);
const CITY_TYPES = new Set(["municipality", "city", "town", "village", "administrative"]);

interface NominatimPlace {
  place_id: number;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  category?: string;
  class?: string;
  type: string;
  addresstype?: string;
  place_rank?: number;
  name?: string;
  display_name: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
}

function nominatimRequest(env: SourceEnv, path: string, params: Record<string, string>, fallbackActivated = false) {
  const url = `${NOMINATIM_BASE}${path}?${new URLSearchParams(params).toString()}`;
  return requestWithPolicy<NominatimPlace[]>(
    {
      source: "osm_nominatim",
      url,
      queryForLog: decodeURIComponent(new URLSearchParams(params).toString()),
      timeoutMs: env.config.timeoutMs,
      retries: env.config.retryCount,
      signal: env.signal,
      deadline: env.deadline,
      throttle: throttleFor("nominatim.openstreetmap.org", Math.min(1, env.config.rateLimitPerSec)),
      headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
      fallbackActivated: env.isFallback || fallbackActivated,
      parse: (text) => {
        const data = jsonParser<NominatimPlace[]>(text);
        if (!Array.isArray(data)) throw new Error("esperava um array");
        return data;
      },
      countResults: (d) => d.length,
    },
    env.http
  );
}

export function pickMunicipality(places: NominatimPlace[], uf: string): NominatimPlace | null {
  const stateName = foldText(UF_NAMES[uf] ?? uf);
  const candidates = places.filter((p) => {
    const addrState = foldText(p.address?.state ?? "");
    const inState = addrState ? addrState === stateName : foldText(p.display_name).includes(stateName);
    const cityLike = CITY_TYPES.has(p.addresstype ?? p.type) || (p.category ?? p.class) === "boundary" || (p.category ?? p.class) === "place";
    return inState && cityLike;
  });
  candidates.sort((a, b) => {
    // Prefer the municipality boundary relation (largest correct area).
    const score = (p: NominatimPlace) =>
      (p.osm_type === "relation" ? 4 : 0) + (p.addresstype === "municipality" ? 2 : 0) + ((p.category ?? p.class) === "boundary" ? 1 : 0);
    return score(b) - score(a);
  });
  return candidates[0] ?? null;
}

export function toResolvedLocation(place: NominatimPlace, uf: string): ResolvedLocation {
  const bb = place.boundingbox?.map(Number);
  return {
    city: place.name ?? place.address?.city ?? place.address?.town ?? place.display_name.split(",")[0],
    state: uf,
    displayName: place.display_name,
    lat: Number(place.lat),
    lon: Number(place.lon),
    bbox: bb && bb.length === 4 ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] } : null,
    osmRelationId: place.osm_type === "relation" ? place.osm_id : null,
    source: "osm_nominatim",
    confidence: place.osm_type === "relation" ? "HIGH" : "MEDIUM",
  };
}

export const nominatimGeo: GeoSource = {
  key: "osm_nominatim",
  async geocodeCity(city, uf, env) {
    try {
      const out = await nominatimRequest(env, "/search", {
        city,
        state: UF_NAMES[uf] ?? uf,
        country: "Brasil",
        format: "jsonv2",
        addressdetails: "1",
        limit: "5",
      });
      const place = pickMunicipality(out.data, uf);
      return { location: place ? toResolvedLocation(place, uf) : null, logs: out.logs, error: null };
    } catch (err) {
      const { logs } = errorEntry(err);
      return { location: null, logs, error: err instanceof SourceRequestError ? err : null };
    }
  },
};

export function nominatimPlaceToCompany(p: NominatimPlace, term: string): SourceCompany | null {
  const category = p.category ?? p.class ?? "";
  if (!POI_CATEGORIES.has(category)) return null;
  const name = p.namedetails?.name ?? p.name;
  if (!name) return null;
  const a = p.address ?? {};
  const extratags = p.extratags ?? {};
  const recordId = osmRecordId(p.osm_type, p.osm_id);
  return {
    source: "osm_nominatim",
    sourceRecordId: recordId,
    sourceUrl: osmUrl(recordId),
    collectedAt: new Date().toISOString(),
    name,
    category: osmCategory({ [category]: p.type, cuisine: extratags.cuisine }),
    street: a.road ?? a.pedestrian ?? null,
    houseNumber: a.house_number ?? null,
    neighborhood: a.suburb ?? a.neighbourhood ?? a.quarter ?? null,
    city: a.city ?? a.town ?? a.municipality ?? a.village ?? null,
    state: a.state ?? null,
    postcode: a.postcode ?? null,
    ...osmContactFields(extratags),
    lat: Number(p.lat),
    lon: Number(p.lon),
    openingHours: extratags.opening_hours ?? null,
    matchedBy: "text_search",
    matchedTerm: term,
    confidence: "MEDIUM",
  };
}

export function createNominatimSource(): DiscoverySource {
  return {
    key: "osm_nominatim",
    kind: "discovery",
    cost: "FREE",
    requiresLocation: true,
    capabilities: {
      canSearch: true,
      canEnrich: false,
      canGeocode: true,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnCnpj: false,
      canReturnSocials: true,
      supportsPagination: "exclude_ids",
    },
    isConfigured: () => true,

    async search(input: SourceSearchInput, env: SourceEnv): Promise<SourceRunResult> {
      const startedAt = Date.now();
      const { context, expansion, location } = input;
      const metadata = emptyMetadata("osm_nominatim", Math.min(context.limit, env.config.maxResults));
      metadata.sourceLimit = PAGE_SIZE;
      metadata.strategy = "viewbox";
      const logs: RequestLog[] = [];
      const errors: SourceRunResult["errors"] = [];
      const warnings: string[] = [];

      if (!location?.bbox) {
        return finalizeRun("osm_nominatim", LABEL, {
          results: [],
          metadata,
          logs,
          isFallback: env.isFallback,
          startedAt,
          status: "SOURCE_ERROR",
          errors: [{ kind: "NOT_CONFIGURED", message: "Sem bounding box da cidade (geocoding falhou)" }],
        });
      }

      const maxTerms = context.mode === "PRECISE" ? 1 : context.mode === "BALANCED" ? 3 : 8;
      const terms = expansion.textTerms.slice(0, maxTerms);
      const maxPages = Math.max(1, Math.min(context.mode === "BROAD" ? 5 : 3, Math.ceil(env.config.maxResults / PAGE_SIZE)));
      const { south, north, west, east } = location.bbox;
      const viewbox = `${west},${north},${east},${south}`;
      const byId = new Map<string, SourceCompany>();
      let invalid = 0;

      for (const term of terms) {
        const excluded: number[] = [];
        for (let page = 1; page <= maxPages; page++) {
          if (env.signal.aborted || Date.now() >= env.deadline) {
            warnings.push("Prazo da busca atingido antes de consultar todos os termos/páginas.");
            break;
          }
          const params: Record<string, string> = {
            q: term,
            format: "jsonv2",
            limit: String(PAGE_SIZE),
            viewbox,
            bounded: "1",
            countrycodes: "br",
            addressdetails: "1",
            extratags: "1",
            namedetails: "1",
          };
          if (excluded.length) params.exclude_place_ids = excluded.join(",");
          metadata.queries.push(`q=${term} page=${page}`);
          try {
            const out = await nominatimRequest(env, "/search", params);
            logs.push(...out.logs);
            metadata.pages += 1;
            for (const place of out.data) {
              excluded.push(place.place_id);
              const company = nominatimPlaceToCompany(place, term);
              if (!company) {
                invalid++;
                continue;
              }
              if (!byId.has(company.sourceRecordId)) byId.set(company.sourceRecordId, company);
            }
            if (out.data.length < PAGE_SIZE) break;
            if (page === maxPages) metadata.hasMore = true;
          } catch (err) {
            const { entry, logs: errLogs } = errorEntry(err);
            logs.push(...errLogs);
            errors.push(entry);
            break;
          }
        }
        if (errors.length && errors[errors.length - 1].kind === "RATE_LIMITED") break; // don't keep pushing
      }

      metadata.invalid = invalid;
      metadata.invalidReasons = invalid ? { "não é estabelecimento (rua, bairro, lugar)": invalid } : {};
      const results = [...byId.values()];
      if (errors.length && results.length) warnings.push(`${errors.length} consulta(s) falharam; resultados parciais mantidos.`);
      return finalizeRun("osm_nominatim", LABEL, {
        results,
        metadata,
        warnings,
        errors,
        logs,
        isFallback: env.isFallback,
        startedAt,
        coverage: `bbox de ${location.city}`,
      });
    },
  };
}
