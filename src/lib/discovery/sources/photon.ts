/**
 * OpenStreetMap — Photon (komoot) adapter: text POI search with bbox and a
 * reserve geocoder. Independent infrastructure from both Overpass and
 * Nominatim, which is what makes it a useful fallback. Fair-use public
 * service: throttled, bounded (≤50 per term, no pagination).
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
import { osmRecordId, osmUrl } from "./osm-common";

export const PHOTON_BASE = "https://photon.komoot.io/api/";
const LABEL = "OpenStreetMap (Photon)";
const POI_KEYS = new Set(["amenity", "shop", "craft", "office", "healthcare", "leisure", "tourism"]);

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id: number;
    osm_type: "N" | "W" | "R";
    osm_key: string;
    osm_value: string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
    locality?: string;
    state?: string;
    countrycode?: string;
    extent?: [number, number, number, number]; // minLon, maxLat, maxLon, minLat
    type?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

function photonRequest(env: SourceEnv, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return requestWithPolicy<PhotonResponse>(
    {
      source: "osm_photon",
      url: `${PHOTON_BASE}?${qs}`,
      queryForLog: decodeURIComponent(qs),
      timeoutMs: env.config.timeoutMs,
      retries: env.config.retryCount,
      signal: env.signal,
      deadline: env.deadline,
      throttle: throttleFor("photon.komoot.io", env.config.rateLimitPerSec),
      fallbackActivated: env.isFallback,
      parse: (text) => {
        const data = jsonParser<PhotonResponse>(text);
        if (!data || !Array.isArray(data.features)) throw new Error("campo 'features' ausente");
        return data;
      },
      countResults: (d) => d.features.length,
    },
    env.http
  );
}

export const photonGeo: GeoSource = {
  key: "osm_photon",
  async geocodeCity(city, uf, env) {
    try {
      const out = await photonRequest(env, { q: `${city}, ${UF_NAMES[uf] ?? uf}, Brasil`, limit: "8" });
      const stateName = foldText(UF_NAMES[uf] ?? uf);
      const match = out.data.features.find((f) => {
        const p = f.properties;
        const cityLike = (p.osm_key === "place" && ["city", "town", "village", "municipality"].includes(p.osm_value)) || p.osm_key === "boundary";
        return cityLike && foldText(p.state) === stateName && foldText(p.name) === foldText(city);
      });
      if (!match) return { location: null, logs: out.logs, error: null };
      const [lon, lat] = match.geometry.coordinates;
      const e = match.properties.extent;
      const location: ResolvedLocation = {
        city: match.properties.name ?? city,
        state: uf,
        displayName: `${match.properties.name}, ${match.properties.state}`,
        lat,
        lon,
        bbox: e ? { west: e[0], north: e[1], east: e[2], south: e[3] } : null,
        osmRelationId: match.properties.osm_type === "R" ? match.properties.osm_id : null,
        source: "osm_photon",
        confidence: e ? "MEDIUM" : "LOW",
      };
      return { location, logs: out.logs, error: null };
    } catch (err) {
      const { logs } = errorEntry(err);
      return { location: null, logs, error: err instanceof SourceRequestError ? err : null };
    }
  },
};

export function photonFeatureToCompany(f: PhotonFeature, term: string): SourceCompany | null {
  const p = f.properties;
  if (!POI_KEYS.has(p.osm_key) || !p.name) return null;
  const recordId = osmRecordId(p.osm_type, p.osm_id);
  const [lon, lat] = f.geometry.coordinates;
  return {
    source: "osm_photon",
    sourceRecordId: recordId,
    sourceUrl: osmUrl(recordId),
    collectedAt: new Date().toISOString(),
    name: p.name,
    category: `${p.osm_key}=${p.osm_value}`,
    street: p.street ?? null,
    houseNumber: p.housenumber ?? null,
    neighborhood: p.district ?? p.locality ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    postcode: p.postcode ?? null,
    lat,
    lon,
    socials: {},
    matchedBy: "text_search",
    matchedTerm: term,
    confidence: "MEDIUM",
  };
}

export function createPhotonSource(): DiscoverySource {
  return {
    key: "osm_photon",
    kind: "discovery",
    cost: "FREE",
    requiresLocation: true,
    capabilities: {
      canSearch: true,
      canEnrich: false,
      canGeocode: true,
      canReturnPhone: false,
      canReturnWebsite: false,
      canReturnEmail: false,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnCnpj: false,
      canReturnSocials: false,
      supportsPagination: "none",
    },
    isConfigured: () => true,

    async search(input: SourceSearchInput, env: SourceEnv): Promise<SourceRunResult> {
      const startedAt = Date.now();
      const { context, expansion, location } = input;
      const metadata = emptyMetadata("osm_photon", Math.min(context.limit, env.config.maxResults));
      metadata.sourceLimit = env.config.maxResults;
      metadata.strategy = "bbox";
      const logs: RequestLog[] = [];
      const errors: SourceRunResult["errors"] = [];
      const warnings: string[] = [];

      if (!location?.bbox) {
        return finalizeRun("osm_photon", LABEL, {
          results: [],
          metadata,
          logs,
          isFallback: env.isFallback,
          startedAt,
          status: "SOURCE_ERROR",
          errors: [{ kind: "NOT_CONFIGURED", message: "Sem bounding box da cidade (geocoding falhou)" }],
        });
      }

      const maxTerms = context.mode === "PRECISE" ? 2 : context.mode === "BALANCED" ? 4 : 10;
      const terms = expansion.textTerms.slice(0, maxTerms);
      const { south, north, west, east } = location.bbox;
      const byId = new Map<string, SourceCompany>();
      let invalid = 0;

      for (const term of terms) {
        if (env.signal.aborted || Date.now() >= env.deadline) {
          warnings.push("Prazo da busca atingido antes de consultar todos os termos.");
          break;
        }
        metadata.queries.push(`q=${term}`);
        try {
          const out = await photonRequest(env, {
            q: term,
            bbox: `${west},${south},${east},${north}`,
            limit: String(Math.min(50, env.config.maxResults)),
          });
          logs.push(...out.logs);
          metadata.pages += 1;
          if (out.data.features.length >= Math.min(50, env.config.maxResults)) metadata.hasMore = true;
          for (const f of out.data.features) {
            const company = photonFeatureToCompany(f, term);
            if (!company) {
              invalid++;
              continue;
            }
            if (!byId.has(company.sourceRecordId)) byId.set(company.sourceRecordId, company);
          }
        } catch (err) {
          const { entry, logs: errLogs } = errorEntry(err);
          logs.push(...errLogs);
          errors.push(entry);
          if (entry.kind === "RATE_LIMITED" || entry.kind === "BLOCKED") break;
        }
      }

      metadata.invalid = invalid;
      metadata.invalidReasons = invalid ? { "não é estabelecimento (rua, bairro, lugar)": invalid } : {};
      const results = [...byId.values()];
      if (errors.length && results.length) warnings.push(`${errors.length} consulta(s) falharam; resultados parciais mantidos.`);
      return finalizeRun("osm_photon", LABEL, {
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
