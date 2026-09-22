/**
 * Source adapter contracts. Every provider implements one of these
 * independently; the orchestrator only ever talks to the interfaces.
 */

import type { BreakerRegistry } from "../circuit-breaker";
import type { HttpDeps } from "../http";
import { SourceRequestError, logsFromError } from "../http";
import type { IndustryExpansion } from "../industries";
import type {
  RequestErrorKind,
  RequestLog,
  ResolvedLocation,
  SearchContext,
  SourceCapabilities,
  SourceCompany,
  SourceConfig,
  SourceCost,
  SourceKey,
  SourceRunMetadata,
  SourceRunResult,
  SourceRunStatus,
  UnifiedCompany,
} from "../types";

export interface SourceEnv {
  signal: AbortSignal;
  deadline: number;
  config: SourceConfig;
  breakers: BreakerRegistry;
  http: HttpDeps;
  isFallback: boolean;
}

export interface SourceSearchInput {
  context: SearchContext;
  expansion: IndustryExpansion;
  location: ResolvedLocation | null;
  /** Lazy geocode for sources that only sometimes need it (Overpass bbox fallback). */
  resolveLocation?: () => Promise<ResolvedLocation | null>;
}

interface SourceBase {
  key: SourceKey;
  cost: SourceCost;
  capabilities: SourceCapabilities;
  isConfigured(): boolean;
}

export interface DiscoverySource extends SourceBase {
  kind: "discovery";
  /** True when the source cannot run without a geocoded location (bbox/center). */
  requiresLocation: boolean;
  search(input: SourceSearchInput, env: SourceEnv): Promise<SourceRunResult>;
}

export interface EnrichmentPatch {
  source: SourceKey;
  status: SourceRunStatus;
  fields: Partial<Pick<SourceCompany, "legalName" | "tradeName" | "cnpjStatus" | "cnae" | "street" | "houseNumber" | "neighborhood" | "city" | "state" | "postcode" | "phone" | "email" | "website" | "whatsapp" | "socials">>;
  partners?: { name: string; role: string | null }[];
  message: string | null;
  logs: RequestLog[];
  durationMs: number;
}

export interface EnrichmentSource extends SourceBase {
  kind: "enrichment";
  appliesTo(company: UnifiedCompany): boolean;
  enrich(company: UnifiedCompany, env: SourceEnv): Promise<EnrichmentPatch>;
}

export interface GeoSource {
  key: SourceKey;
  geocodeCity(city: string, state: string, env: SourceEnv): Promise<{ location: ResolvedLocation | null; logs: RequestLog[]; error: SourceRequestError | null }>;
}

// ---------------------------------------------------------------------------
// Helpers shared by adapters
// ---------------------------------------------------------------------------

export function statusFromErrorKind(kind: RequestErrorKind): SourceRunStatus {
  switch (kind) {
    case "TIMEOUT":
    case "ABORTED":
      return "SOURCE_TIMEOUT";
    case "RATE_LIMITED":
      return "SOURCE_RATE_LIMITED";
    case "BLOCKED":
      return "SOURCE_BLOCKED";
    case "NOT_CONFIGURED":
      return "SOURCE_NOT_CONFIGURED";
    case "CIRCUIT_OPEN":
      return "SOURCE_CIRCUIT_OPEN";
    case "PARTIAL_RESPONSE":
      return "SOURCE_PARTIAL_RESULTS";
    default:
      return "SOURCE_ERROR";
  }
}

/** Safe, non-technical message for the end user (§48, §115). */
export function userMessageFor(status: SourceRunStatus, label: string): string | null {
  switch (status) {
    case "SOURCE_TIMEOUT":
      return `${label} demorou demais para responder. Os resultados das outras fontes foram mantidos.`;
    case "SOURCE_RATE_LIMITED":
      return `${label} limitou temporariamente as consultas. Usamos fontes alternativas.`;
    case "SOURCE_BLOCKED":
      return `${label} recusou a consulta. Os resultados das outras fontes foram mantidos.`;
    case "SOURCE_ERROR":
      return `${label} apresentou instabilidade. Os resultados das outras fontes foram mantidos.`;
    case "SOURCE_CIRCUIT_OPEN":
      return `${label} está temporariamente pausada após falhas repetidas. Outras fontes continuam sendo utilizadas.`;
    case "SOURCE_PARTIAL_RESULTS":
      return `${label} retornou resultados parciais.`;
    case "SOURCE_NOT_CONFIGURED":
      return `${label} não está configurada.`;
    default:
      return null;
  }
}

export function emptyMetadata(source: SourceKey, requested: number): SourceRunMetadata {
  return {
    source,
    requested,
    returned: 0,
    page: 1,
    pages: 0,
    hasMore: false,
    durationMs: 0,
    attempts: 0,
    status: "NO_RESULTS_FROM_SOURCE",
    sourceLimit: null,
    strategy: null,
    queries: [],
    endpointsTried: [],
    invalid: 0,
    invalidReasons: {},
  };
}

export function finalizeRun(
  source: SourceKey,
  label: string,
  parts: {
    status?: SourceRunStatus;
    results: SourceCompany[];
    metadata: SourceRunMetadata;
    warnings?: string[];
    errors?: SourceRunResult["errors"];
    logs: RequestLog[];
    coverage?: string | null;
    isFallback: boolean;
    startedAt: number;
  }
): SourceRunResult {
  const errors = parts.errors ?? [];
  const warnings = parts.warnings ?? [];
  let status = parts.status;
  if (!status) {
    if (parts.results.length === 0) status = errors.length ? statusFromErrorKind(errors[errors.length - 1].kind) : "NO_RESULTS_FROM_SOURCE";
    else if (errors.length) status = "SOURCE_PARTIAL_RESULTS";
    else if (warnings.length) status = "SOURCE_SUCCESS_WITH_WARNINGS";
    else status = "SOURCE_SUCCESS";
  }
  const metadata: SourceRunMetadata = {
    ...parts.metadata,
    returned: parts.results.length,
    status,
    durationMs: Date.now() - parts.startedAt,
    attempts: parts.logs.length,
  };
  return {
    source,
    status,
    results: parts.results,
    metadata,
    warnings,
    errors,
    logs: parts.logs,
    coverage: parts.coverage ?? null,
    isFallback: parts.isFallback,
    userMessage: userMessageFor(status, label),
  };
}

export function errorEntry(err: unknown): { entry: SourceRunResult["errors"][number]; logs: RequestLog[] } {
  if (err instanceof SourceRequestError) {
    return {
      entry: { kind: err.kind, message: err.message, endpoint: err.endpoint, httpStatus: err.httpStatus },
      logs: logsFromError(err),
    };
  }
  return { entry: { kind: "NETWORK", message: err instanceof Error ? err.message : String(err) }, logs: [] };
}
