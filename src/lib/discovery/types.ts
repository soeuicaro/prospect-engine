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
  /** Raw source taxonomy keys, prefixed: "osm:amenity=restaurant", "ovt:beauty_salon" — used for segment matching. */
  categoryKeys?: string[];
  /** Business opening date (CNPJ registry). Never estimated. */
  openedAt?: string | null;
  /** Registry size class ("MEI", "ME", "EPP", "DEMAIS") or the workspace's estimated_size. */
  companySize?: string | null;
  /** "open" | "closed" | "temporarily_closed" when the source states it (Overture). */
  operatingStatus?: string | null;
  description?: string | null;
  /** When WE first saw this record (local DB: created_at). Defaults to collectedAt. */
  firstSeenAt?: string | null;
  /**
   * Age of the underlying data, when the source states it (Overture import
   * date, local updated_at). Live OSM answers have none: the fetch time
   * (collectedAt) says nothing about when the map was last edited.
   */
  dataAsOf?: string | null;
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
  /** Age of the underlying data when the source states it (see SourceCompany.dataAsOf). */
  dataAsOf?: string | null;
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
  // ---- lead-qualification inputs (optional: older cached searches lack them) ----
  cnae?: string | null;
  categoryKeys?: string[];
  openedAt?: string | null;
  companySize?: string | null;
  operatingStatus?: string | null;
  description?: string | null;
  openingHours?: string | null;
  /** Homepage analysis (website_discovery enrichment) — only what the page itself showed. */
  web?: WebPresence | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  lastVerifiedAt?: string | null;
  dataAsOf?: string | null;
  /** Lead qualification (ICP fit, explainable score, confidence, tags, why). */
  lead?: LeadQualification | null;
}

export interface WebPresence {
  status: string; // ACTIVE | INACTIVE | TIMEOUT | ...
  analyzedAt: string;
  title: string | null;
  description: string | null;
  /** Video found ON the homepage: YouTube/Vimeo embeds, <video> tags, links to a channel. */
  hasVideo: boolean;
  videoPlatforms: string[];
  hasBlog: boolean;
  hasContactPage: boolean;
  hasCta: boolean;
  /** Words on the page that hint at launches, events, new units, booking. */
  opportunityHints: string[];
}

// ---------------------------------------------------------------------------
// Lead qualification (see LEAD_QUALIFICATION.md)
// ---------------------------------------------------------------------------

export type LeadConfidence = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

/** CONFIRMED = a source published it; INFERRED = derived by a rule; UNKNOWN = not found (null). */
export type DataStatus = "CONFIRMED" | "INFERRED" | "UNKNOWN";

export type ScoreDimension = "fit" | "visual_need" | "digital_presence" | "opportunity" | "contactability" | "data_quality" | "recency";

export interface ScoreItem {
  key: string;
  label: string;
  points: number; // may be negative (penalties)
  status: Exclude<DataStatus, "UNKNOWN">;
  evidence: string;
}

export interface ScoreDimensionResult {
  dimension: ScoreDimension;
  label: string;
  points: number; // 0..max after clamping
  max: number;
  items: ScoreItem[];
}

export interface LeadSignal {
  key: string;
  label: string;
  status: Exclude<DataStatus, "UNKNOWN">;
  evidence: string;
  source: SourceKey | "rule" | null;
}

export interface LeadQualification {
  version: number;
  segment: string | null; // ICP segment key (catalog key) or null when unknown
  segmentLabel: string | null;
  segmentStatus: DataStatus; // how the segment was determined
  segmentEvidence: string | null;
  subcategory: string | null;
  leadScore: number; // 0..100
  scoreBreakdown: ScoreDimensionResult[];
  confidence: LeadConfidence;
  confidenceFactors: string[];
  tags: string[];
  signals: LeadSignal[];
  /** Positive reasons, strongest first. */
  qualificationReasons: string[];
  /** Weaknesses/risks the prospector should know about. */
  alerts: string[];
  whyThisLead: string;
  qualified: boolean;
  /** Set when the validation step rejected the record (it is then filtered out, visibly). */
  disqualified: { rule: string; reason: string } | null;
  fieldStatus: Record<"phone" | "whatsapp" | "email" | "website" | "instagram" | "address" | "contactName", { status: DataStatus; source: SourceKey | null; note?: string }>;
  /** Units of the same brand seen in this search (name/domain match at different addresses). */
  locationCount: number;
  computedAt: string;
}

export interface QualificationSummary {
  icpName: string;
  evaluated: number;
  qualified: number;
  disqualified: number;
  avgScore: number;
  avgConfidence: number; // 1..5
  byConfidence: Record<LeadConfidence, number>;
  bySegment: { segment: string; label: string; count: number; qualified: number; avgScore: number }[];
  byNeighborhood: { neighborhood: string; count: number; qualified: number }[];
  bySource: { source: SourceKey; leads: number; qualified: number; avgScore: number }[];
  discardedByRule: Record<string, number>;
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
  qualified?: number; // contributed to a final record that passed the ICP qualification
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
  /** Records the validation step removed, with the rule — sample, so bad data stays inspectable. */
  discardedSample?: { name: string; sources: SourceKey[]; rule: string; reason: string }[];
  /** Neighborhood areas resolved for the neighborhood filter. */
  neighborhoodAreas?: { name: string; resolved: boolean; source: string | null }[];
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
  /** Lead-qualification metrics (absent on searches cached before qualification existed). */
  qualification?: QualificationSummary;
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
