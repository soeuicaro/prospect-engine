/**
 * Discovery Engine — shared contracts. See DISCOVERY.md for the full flow:
 *
 *   SearchContext → Orchestrator → [sources in parallel] → normalize →
 *   merge/dedup → filter (visible) → rank → SearchResponse → progressive
 *   enrichment (client-driven batches).
 *
 * Everything here is plain data (no server-only imports) so the client UI
 * can share the same types as the server.
 */

import type { Confidence, SocialChannel } from "@/types/database";

export type { Confidence };

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceKey =
  | "local_db"
  | "places_overture"
  | "osm_overpass"
  | "osm_nominatim"
  | "osm_photon"
  | "cnpj_brasilapi"
  | "website_discovery"
  | "google_maps";

export type SourceKind = "discovery" | "enrichment" | "geo" | "validation";

export type SourceCost = "FREE" | "PAID";

/**
 * Per-run outcome of ONE source. A failure here never means "no results" —
 * those are deliberately distinct states (NO_RESULTS_FROM_SOURCE vs
 * SOURCE_ERROR/TIMEOUT/RATE_LIMITED...).
 */
export type SourceRunStatus =
  | "SOURCE_SUCCESS"
  | "SOURCE_SUCCESS_WITH_WARNINGS"
  | "SOURCE_PARTIAL_RESULTS"
  | "NO_RESULTS_FROM_SOURCE"
  | "SOURCE_ERROR"
  | "SOURCE_TIMEOUT"
  | "SOURCE_RATE_LIMITED"
  | "SOURCE_BLOCKED"
  | "SOURCE_NOT_CONFIGURED"
  | "SOURCE_DISABLED"
  | "SOURCE_CIRCUIT_OPEN";

export const FAILED_RUN_STATUSES: SourceRunStatus[] = [
  "SOURCE_ERROR",
  "SOURCE_TIMEOUT",
  "SOURCE_RATE_LIMITED",
  "SOURCE_BLOCKED",
  "SOURCE_CIRCUIT_OPEN",
];

export function isFailedRun(status: SourceRunStatus): boolean {
  return FAILED_RUN_STATUSES.includes(status);
}

export type HealthStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "DISABLED" | "NOT_CONFIGURED";

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface SourceCapabilities {
  canSearch: boolean;
  canEnrich: boolean;
  canGeocode: boolean;
  canReturnPhone: boolean;
  canReturnWebsite: boolean;
  canReturnEmail: boolean;
  canReturnAddress: boolean;
  canReturnCoordinates: boolean;
  canReturnCnpj: boolean;
  canReturnSocials: boolean;
  supportsPagination: "none" | "offset" | "exclude_ids" | "range";
}

export interface SourceConfig {
  enabled: boolean;
  priority: number; // lower = earlier in fallback chains / UI order
  timeoutMs: number;
  retryCount: number; // retries AFTER the first attempt
  rateLimitPerSec: number; // requests per second, per host, per server instance
  cacheTtlMinutes: number;
  maxResults: number; // source-side cap (a source may return fewer)
  fallbackEnabled: boolean;
  fallbackTo: SourceKey[];
}

// ---------------------------------------------------------------------------
// Search context
// ---------------------------------------------------------------------------

export type SearchMode = "BROAD" | "BALANCED" | "PRECISE";
export type SearchDepth = "FAST" | "BALANCED" | "DEEP";

export interface SearchContext {
  city: string;
  state: string; // UF, 2 letters
  country: "BR";
  radiusKm: number | null; // null = municipality boundary
  neighborhoods: string[];
  keywords: string[]; // extra user terms
  industryKey: string | null; // catalog key (== industries.slug when seeded)
  industryId: string | null; // workspace industry row, for local DB match + import
  cnaes: string[];
  includeRelatedCnaes: boolean;
  companySize: string[];
  cnpjStatus: string[]; // [] = no filter
  limit: number; // quantity goal — a target, never a silent cap
  page: number;
  sort: "relevance" | "completeness" | "name";
  sourcesEnabled: SourceKey[];
  mode: SearchMode;
  depth: SearchDepth;
  autoEnrichTop: number;
  expandKeywords: boolean;
}

export interface ResolvedLocation {
  city: string; // canonical name as found by the geo source
  state: string;
  displayName: string;
  lat: number;
  lon: number;
  bbox: { south: number; west: number; north: number; east: number } | null;
  osmRelationId: number | null;
  source: SourceKey;
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type SocialMap = Partial<Record<Exclude<SocialChannel, "other" | "whatsapp">, string>>;

/** One record as returned by ONE source, already normalized to our shape. */
export interface SourceCompany {
  source: SourceKey;
  sourceRecordId: string;
  sourceUrl: string | null;
  collectedAt: string;
  verifiedAt?: string | null;
  companyId?: string | null; // set when the record is an existing DB company
  /** Existing DB company that already sits in a pipeline stage. */
  inPipeline?: boolean;
  originSourceTypes?: string[]; // company_sources.source_type for local records
  /** Cross-source identity keys, e.g. "osm:node/123" on a local record imported from OSM. */
  linkedRecordIds?: string[];
  hasDecisionMaker?: boolean;
  /** Named owners/partners/decision-makers already known for this record. */
  contacts?: { name: string; role: string | null }[];
  name: string;
  legalName?: string | null;
  tradeName?: string | null;
  cnpj?: string | null;
  cnpjStatus?: string | null;
  cnae?: string | null;
  category?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  phone?: string | null;
  phones?: string[];
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  lat?: number | null;
  lon?: number | null;
  socials?: SocialMap;
  openingHours?: string | null;
  matchedBy: "tag" | "name_keyword" | "text_search" | "industry" | "cnae" | "keyword";
  matchedTerm?: string | null;
  confidence: Confidence;
}

export type MergeField =
  | "name"
  | "legalName"
  | "cnpj"
  | "category"
  | "street"
  | "houseNumber"
  | "neighborhood"
  | "city"
  | "state"
  | "postcode"
  | "phone"
  | "whatsapp"
  | "email"
  | "website"
  | "coordinates"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "youtube";

export interface FieldValue<T = string> {
  value: T;
  source: SourceKey;
  confidence: Confidence;
  collectedAt: string;
  verifiedAt?: string | null;
}

export interface FieldConflict {
  field: MergeField;
  chosen: FieldValue<string>;
  alternatives: FieldValue<string>[];
}

export type DuplicateConfidence = "EXACT" | "HIGH" | "MEDIUM" | "LOW";

export interface PossibleDuplicate {
  key: string;
  name: string;
  confidence: DuplicateConfidence;
  reasons: string[];
}

export type CompletenessLabel = "COMPLETO" | "PARCIAL" | "FRACO";
export type QualityLabel = "COMPLETE" | "PARTIAL" | "NEEDS_REVIEW";

export type EnrichmentState = "PENDING" | "RUNNING" | "DONE" | "SKIPPED" | "FAILED";

export interface UnifiedCompany {
  key: string;
  companyId: string | null;
  name: string;
  legalName: string | null;
  cnpj: string | null;
  cnpjStatus: string | null;
  category: string | null;
  street: string | null;
  houseNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
  phones: string[];
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  lat: number | null;
  lon: number | null;
  socials: SocialMap;
  provenance: Partial<Record<MergeField, FieldValue<string>>>;
  conflicts: FieldConflict[];
  sources: { source: SourceKey; recordId: string; url: string | null; matchedBy: SourceCompany["matchedBy"] }[];
  sourceKeys: SourceKey[];
  mergeConfidence: DuplicateConfidence | null; // how confidently members were merged
  possibleDuplicates: PossibleDuplicate[];
  confidence: Confidence;
  completeness: number;
  completenessLabel: CompletenessLabel;
  qualityLabel: QualityLabel;
  discoveryStatus: "EXISTING" | "NEW";
  rankScore: number;
  hasDecisionMaker: boolean;
  /** In the DB AND in a pipeline stage (companyId alone = only in the prospecting base). */
  inPipeline?: boolean;
  /** Public registry partners (QSA) or other decision-maker hints, with source. */
  contacts?: { name: string; role: string | null; source: SourceKey }[];
  enrichment: { state: EnrichmentState; sources: SourceKey[]; message?: string | null };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Diagnostics / metrics
// ---------------------------------------------------------------------------

export type RequestErrorKind =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "HTTP_5XX"
  | "HTTP_4XX"
  | "BLOCKED"
  | "NETWORK"
  | "PARSE"
  | "ABORTED"
  | "PARTIAL_RESPONSE"
  | "NOT_CONFIGURED"
  | "CIRCUIT_OPEN";

export interface RequestLog {
  source: SourceKey;
  endpoint: string;
  query: string;
  httpStatus: number | null;
  latencyMs: number;
  attempt: number;
  maxAttempts: number;
  errorKind: RequestErrorKind | null;
  errorMessage: string | null;
  resultsCount: number | null;
  fallbackActivated: boolean;
  at: string;
}

export interface SourceRunMetadata {
  source: SourceKey;
  requested: number;
  returned: number;
  page: number;
  pages: number;
  hasMore: boolean;
  durationMs: number;
  attempts: number;
  status: SourceRunStatus;
  sourceLimit: number | null;
  strategy: string | null; // e.g. "area", "bbox", "radius"
  queries: string[];
  endpointsTried: string[];
  invalid: number; // records dropped by the source adapter itself (e.g. no name)
  invalidReasons: Record<string, number>;
}

export interface SourceRunResult {
  source: SourceKey;
  status: SourceRunStatus;
  results: SourceCompany[];
  metadata: SourceRunMetadata;
  warnings: string[];
  errors: { kind: RequestErrorKind; message: string; endpoint?: string; httpStatus?: number | null }[];
  logs: RequestLog[];
  coverage: string | null;
  isFallback: boolean;
  userMessage: string | null; // safe, non-technical
}

export interface SourceFunnelMetrics {
  source: SourceKey;
  status: SourceRunStatus;
  isFallback: boolean;
  requested: number;
  returned: number; // raw
  invalid: number;
  valid: number;
  duplicate: number; // merged into a record that another source/record also found
  filtered: number;
  accepted: number; // contributed to at least one final record
  enriched: number;
  durationMs: number;
  attempts: number;
  sourceLimit: number | null;
  strategy: string | null;
}

export interface FilterDiagnostic {
  key: string;
  label: string;
  removed: number;
  active: boolean;
}

export interface SearchCounts {
  raw: number;
  valid: number;
  normalized: number;
  duplicates: number;
  filtered: number;
  final: number;
}

export interface SearchSummary {
  found: number; // raw records across sources
  unique: number;
  withPhone: number;
  withWebsite: number;
  withEmail: number;
  withInstagram: number;
  withCnpj: number;
  existingInDb: number;
  newCompanies: number;
  needsReview: number;
}

export interface ExpansionSuggestion {
  kind: "radius" | "keywords" | "cnaes" | "nearby_cities" | "sources" | "mode";
  label: string;
  description: string;
  patch: Partial<SearchContext>;
}

export type SearchOutcome = "SUCCESS" | "SUCCESS_WITH_WARNINGS" | "PARTIAL" | "NO_RESULTS" | "FAILED";

export type SearchJobStatus =
  | "QUEUED"
  | "SEARCHING"
  | "MERGING"
  | "ENRICHING"
  | "SCORING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

export interface SearchDiagnostics {
  location: ResolvedLocation | null;
  locationStrategy: string[];
  appliedTerms: string[];
  appliedOsmTags: string[];
  appliedCnaes: string[];
  broadeningApplied: string[];
  filters: FilterDiagnostic[];
  limits: { requestedLimit: number; systemLimit: number; sourceLimits: Partial<Record<SourceKey, number>> };
  lowResultReasons: string[];
  deadlineHit: boolean;
  cancelled: boolean;
}

export interface SearchResponse {
  searchId: string | null;
  cacheKey: string;
  fromCache: boolean;
  outcome: SearchOutcome;
  status: SearchJobStatus;
  partialResults: boolean;
  context: SearchContext;
  results: UnifiedCompany[];
  counts: SearchCounts;
  summary: SearchSummary;
  sourceRuns: Omit<SourceRunResult, "results" | "logs">[];
  funnel: SourceFunnelMetrics[];
  diagnostics: SearchDiagnostics;
  suggestions: ExpansionSuggestion[];
  userMessages: string[];
  coverage: { requested: number; found: number; percent: number };
  qualityScore: number;
  durationMs: number;
  createdAt: string;
}

/** Streamed over NDJSON from /api/discovery/search. */
export type SearchStreamEvent =
  | { type: "phase"; status: SearchJobStatus; message: string }
  | { type: "source"; source: SourceKey; status: SourceRunStatus; returned: number; durationMs: number; isFallback: boolean; message: string | null }
  | { type: "progress"; found: number; unique: number; message: string }
  | { type: "done"; response: SearchResponse }
  | { type: "error"; message: string };
