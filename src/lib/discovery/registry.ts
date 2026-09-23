/**
 * Source registry: static metadata + default configuration for every
 * source the Discovery Engine knows. Client-safe (no I/O) — the UI, docs
 * and orchestrator all read from here. Runtime overrides live in the
 * `settings` table under key `discovery.sources` (see store.ts).
 */

import type { SourceCapabilities, SourceConfig, SourceCost, SourceKey, SourceKind } from "./types";

export interface SourceDefinition {
  key: SourceKey;
  label: string;
  shortLabel: string; // table badge
  kind: SourceKind;
  cost: SourceCost;
  purpose: string;
  limits: string;
  storage: string;
  requiresConfig: boolean;
  capabilities: SourceCapabilities;
  defaults: SourceConfig;
}

const caps = (partial: Partial<SourceCapabilities>): SourceCapabilities => ({
  canSearch: false,
  canEnrich: false,
  canGeocode: false,
  canReturnPhone: false,
  canReturnWebsite: false,
  canReturnEmail: false,
  canReturnAddress: false,
  canReturnCoordinates: false,
  canReturnCnpj: false,
  canReturnSocials: false,
  supportsPagination: "none",
  ...partial,
});

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    key: "local_db",
    label: "Banco local (CNPJ importado, CSV, manual, OSM já importado)",
    shortLabel: "DB",
    kind: "discovery",
    cost: "FREE",
    purpose: "Empresas já existentes no workspace — inclui a base CNPJ importada via tools/cnpj-importer. Consultada primeiro; evita chamadas externas para o que já temos.",
    limits: "Sem limite externo. Paginação por range de 1.000 linhas até o limite do sistema.",
    storage: "É o próprio armazenamento canônico.",
    requiresConfig: false,
    capabilities: caps({
      canSearch: true,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnCnpj: true,
      canReturnSocials: true,
      supportsPagination: "range",
    }),
    defaults: {
      enabled: true,
      priority: 0,
      timeoutMs: 10_000,
      retryCount: 1,
      rateLimitPerSec: 20,
      // Local data changes when the user imports — keep cached searches short-lived.
      cacheTtlMinutes: 60,
      maxResults: 6000,
      fallbackEnabled: false,
      fallbackTo: [],
    },
  },
  {
    key: "places_overture",
    label: "Overture Maps (locais estilo Google Maps — dados abertos)",
    shortLabel: "OVT",
    kind: "discovery",
    cost: "FREE",
    purpose: "Estabelecimentos do Overture Maps Places (Meta/Facebook, Microsoft, Foursquare, AllThePlaces) importados por cidade com tools/places-importer. Telefone, site, e-mail, redes sociais e categoria — o equivalente gratuito de uma ficha do Google Maps.",
    limits: "Nenhum na busca (lê o banco). A importação baixa só os blocos da cidade do bucket público (sem chave, sem custo). Uma release nova por mês.",
    storage: "Tabela places_pois (licença CDLA-Permissive-2.0 — pode armazenar e usar comercialmente).",
    requiresConfig: false,
    capabilities: caps({
      canSearch: true,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnSocials: true,
      supportsPagination: "range",
    }),
    defaults: {
      enabled: true,
      priority: 1,
      timeoutMs: 10_000,
      retryCount: 1,
      rateLimitPerSec: 20,
      cacheTtlMinutes: 24 * 60,
      maxResults: 6000,
      fallbackEnabled: false,
      fallbackTo: [],
    },
  },
  {
    key: "osm_overpass",
    label: "OpenStreetMap — Overpass API",
    shortLabel: "OSM",
    kind: "discovery",
    cost: "FREE",
    purpose: "Descoberta geográfica por tags OSM (amenity/shop/...) dentro do limite do município, bbox ou raio. Principal fonte de coordenadas.",
    limits: "Servidores públicos com cota por IP; sobrecarga gera 429/504 ou HTTP 200 com 'remark' de timeout. Usamos 3 mirrors com circuit breaker por mirror.",
    storage: "Dados ODbL — podem ser armazenados com atribuição (© OpenStreetMap contributors).",
    requiresConfig: false,
    capabilities: caps({
      canSearch: true,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnSocials: true,
    }),
    defaults: {
      enabled: true,
      priority: 1,
      // Per mirror attempt; the QL [timeout:] is set 5s lower so the server
      // gives up (and says so in `remark`) before we do.
      timeoutMs: 25_000,
      retryCount: 1,
      rateLimitPerSec: 1,
      cacheTtlMinutes: 24 * 60,
      maxResults: 1000,
      fallbackEnabled: true,
      fallbackTo: ["osm_nominatim", "osm_photon"],
    },
  },
  {
    key: "osm_nominatim",
    label: "OpenStreetMap — Nominatim",
    shortLabel: "NOM",
    kind: "discovery",
    cost: "FREE",
    purpose: "Geocoding da cidade (bbox/centro) e busca textual de estabelecimentos dentro do bbox. Infraestrutura independente do Overpass — fallback natural.",
    limits: "Política de uso: ≤1 req/s, User-Agent identificável, sem uso massivo. Máx. 40 resultados por página; paginamos com exclude_place_ids (até 3 páginas por termo).",
    storage: "Dados OSM (ODbL). Geocodes ficam em cache (permitido pela política).",
    requiresConfig: false,
    capabilities: caps({
      canSearch: true,
      canGeocode: true,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      supportsPagination: "exclude_ids",
    }),
    defaults: {
      enabled: true,
      priority: 2,
      timeoutMs: 12_000,
      retryCount: 2,
      rateLimitPerSec: 1,
      cacheTtlMinutes: 24 * 60,
      maxResults: 200,
      fallbackEnabled: true,
      fallbackTo: ["osm_photon"],
    },
  },
  {
    key: "osm_photon",
    label: "OpenStreetMap — Photon (komoot)",
    shortLabel: "PHO",
    kind: "discovery",
    cost: "FREE",
    purpose: "Busca textual de POIs sobre dados OSM, com bbox. Terceira infraestrutura independente; também serve de geocoder reserva.",
    limits: "Uso justo (fair use), sem SLA. Até 50 resultados por termo, sem paginação.",
    storage: "Dados OSM (ODbL).",
    requiresConfig: false,
    capabilities: caps({ canSearch: true, canGeocode: true, canReturnAddress: true, canReturnCoordinates: true }),
    defaults: {
      enabled: true,
      priority: 3,
      timeoutMs: 10_000,
      retryCount: 2,
      rateLimitPerSec: 2,
      cacheTtlMinutes: 24 * 60,
      maxResults: 50,
      fallbackEnabled: false,
      fallbackTo: [],
    },
  },
  {
    key: "cnpj_brasilapi",
    label: "CNPJ — BrasilAPI (dados da Receita Federal)",
    shortLabel: "CNPJ",
    kind: "enrichment",
    cost: "FREE",
    purpose: "Enriquecimento por CNPJ: razão social, situação cadastral, CNAE, endereço, telefone e e-mail cadastrais, quadro societário (dados públicos). Não faz busca por cidade/nicho — a descoberta via CNPJ é a base importada (Banco local).",
    limits: "API pública gratuita, sem SLA; throttle de 3 req/s. Só consulta empresas que já têm CNPJ.",
    storage: "Dados públicos oficiais; armazenados com a fonte registrada por campo.",
    requiresConfig: false,
    capabilities: caps({
      canEnrich: true,
      canReturnPhone: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCnpj: true,
    }),
    defaults: {
      enabled: true,
      priority: 4,
      timeoutMs: 8_000,
      retryCount: 2,
      rateLimitPerSec: 3,
      cacheTtlMinutes: 7 * 24 * 60,
      maxResults: 1,
      fallbackEnabled: false,
      fallbackTo: [],
    },
  },
  {
    key: "website_discovery",
    label: "Website oficial (Website Analyzer)",
    shortLabel: "WEB",
    kind: "enrichment",
    cost: "FREE",
    purpose: "Lê apenas a homepage do site oficial já conhecido (respeitando robots.txt) e extrai telefone, e-mail, WhatsApp e links de redes sociais publicados pela própria empresa.",
    limits: "1 página por empresa, 8s de timeout, throttle de 2 req/s. Não procura sites por nome (sem buscador gratuito legítimo).",
    storage: "Somente metadados extraídos; nunca o HTML.",
    requiresConfig: false,
    capabilities: caps({
      canEnrich: true,
      canReturnPhone: true,
      canReturnEmail: true,
      canReturnWebsite: true,
      canReturnSocials: true,
    }),
    defaults: {
      enabled: true,
      priority: 5,
      timeoutMs: 9_000,
      retryCount: 0,
      rateLimitPerSec: 2,
      cacheTtlMinutes: 7 * 24 * 60,
      maxResults: 1,
      fallbackEnabled: false,
      fallbackTo: [],
    },
  },
  {
    key: "google_maps",
    label: "Google Maps (validação manual)",
    shortLabel: "MAPS",
    kind: "validation",
    cost: "FREE",
    purpose: "Links de pesquisa/localização gerados a partir dos nossos dados e validação manual (FOUND / NOT_FOUND / WRONG_RESULT / DUPLICATE / NEEDS_REVIEW). Nunca é consultado automaticamente.",
    limits: "Nenhuma chamada de API é feita — apenas URLs públicas do Maps abertas pelo usuário.",
    storage: "Guardamos apenas o status de validação, data e nota do usuário. Nenhum conteúdo do Maps.",
    requiresConfig: false,
    capabilities: caps({}),
    defaults: {
      enabled: true,
      priority: 9,
      timeoutMs: 0,
      retryCount: 0,
      rateLimitPerSec: 0,
      cacheTtlMinutes: 0,
      maxResults: 0,
      fallbackEnabled: false,
      fallbackTo: [],
    },
  },
];

export function getSourceDefinition(key: SourceKey): SourceDefinition {
  const def = SOURCE_DEFINITIONS.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown source ${key}`);
  return def;
}

export const DISCOVERY_SOURCE_KEYS: SourceKey[] = SOURCE_DEFINITIONS.filter((s) => s.kind === "discovery").map((s) => s.key);
export const ENRICHMENT_SOURCE_KEYS: SourceKey[] = SOURCE_DEFINITIONS.filter((s) => s.kind === "enrichment").map((s) => s.key);

/** FAST depth uses only primary sources; fallbacks still fire on failure. */
export const PRIMARY_DISCOVERY_SOURCES: SourceKey[] = ["local_db", "places_overture", "osm_overpass"];

export function sourceLabel(key: SourceKey): string {
  return SOURCE_DEFINITIONS.find((s) => s.key === key)?.shortLabel ?? key;
}

export type SourceConfigMap = Record<SourceKey, SourceConfig>;

export function defaultSourceConfigs(): SourceConfigMap {
  return Object.fromEntries(SOURCE_DEFINITIONS.map((s) => [s.key, { ...s.defaults }])) as SourceConfigMap;
}

/** Merge persisted overrides onto defaults, clamping to sane bounds. */
export function resolveSourceConfigs(overrides: Partial<Record<SourceKey, Partial<SourceConfig>>> | null | undefined): SourceConfigMap {
  const base = defaultSourceConfigs();
  if (!overrides) return base;
  for (const def of SOURCE_DEFINITIONS) {
    const o = overrides[def.key];
    if (!o) continue;
    const merged = { ...base[def.key], ...o };
    merged.timeoutMs = clamp(merged.timeoutMs, 1000, 60_000, def.defaults.timeoutMs);
    merged.retryCount = clamp(merged.retryCount, 0, 4, def.defaults.retryCount);
    merged.rateLimitPerSec = clamp(merged.rateLimitPerSec, 0.2, 20, def.defaults.rateLimitPerSec);
    merged.cacheTtlMinutes = clamp(merged.cacheTtlMinutes, 0, 30 * 24 * 60, def.defaults.cacheTtlMinutes);
    merged.maxResults = clamp(merged.maxResults, 1, 10_000, def.defaults.maxResults);
    merged.fallbackTo = (merged.fallbackTo ?? []).filter((k) => DISCOVERY_SOURCE_KEYS.includes(k) && k !== def.key);
    base[def.key] = merged;
  }
  // Nominatim's usage policy is a hard ceiling, not a preference.
  base.osm_nominatim.rateLimitPerSec = Math.min(1, base.osm_nominatim.rateLimitPerSec);
  return base;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Field-level source priority for the merge engine (configurable, §17). */
export type FieldPriority = Record<string, SourceKey[]>;

export const DEFAULT_FIELD_PRIORITY: FieldPriority = {
  // Cadastral identity: official registry first, then the user's own data.
  identity: ["cnpj_brasilapi", "local_db", "osm_overpass", "places_overture", "osm_nominatim", "osm_photon", "website_discovery"],
  // Contact: the company's own website > data we already hold > directories.
  phone: ["website_discovery", "local_db", "places_overture", "cnpj_brasilapi", "osm_overpass", "osm_nominatim", "osm_photon"],
  email: ["website_discovery", "local_db", "cnpj_brasilapi", "places_overture", "osm_overpass", "osm_nominatim"],
  website: ["website_discovery", "local_db", "places_overture", "osm_overpass", "osm_nominatim", "osm_photon"],
  social: ["website_discovery", "local_db", "places_overture", "osm_overpass", "osm_nominatim"],
  // Address: official registry + geographic sources.
  address: ["cnpj_brasilapi", "local_db", "osm_overpass", "osm_nominatim", "places_overture", "osm_photon"],
  // Coordinates: geographic sources first.
  coordinates: ["osm_overpass", "osm_nominatim", "places_overture", "osm_photon", "local_db"],
};
