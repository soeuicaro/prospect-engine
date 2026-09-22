import "server-only";

/**
 * Discovery persistence: source config overrides (settings table), circuit
 * breaker/health state (source_health), geocode cache, search log/cache
 * (discovery_searches) and per-attempt request logs (source_request_logs).
 * Every function degrades gracefully: if a table is missing (migration
 * 0011 not applied yet) discovery still runs, just without persistence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DiscoverySearchRow, SourceHealthRow } from "@/types/database";
import { BreakerRegistry, type BreakerSnapshot } from "./circuit-breaker";
import type { GeocodeCache } from "./orchestrator";
import { DEFAULT_FIELD_PRIORITY, resolveSourceConfigs, type FieldPriority, type SourceConfigMap } from "./registry";
import type { RequestLog, ResolvedLocation, SearchResponse, SourceConfig, SourceKey } from "./types";

type Client = SupabaseClient<Database>;

export const SOURCES_SETTING_KEY = "discovery.sources";
export const FIELD_PRIORITY_SETTING_KEY = "discovery.field_priority";
const GEOCODE_TTL_DAYS = 30;
const LOG_RETENTION_DAYS = 30;
const MAX_LOGS_PER_SEARCH = 300;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function loadDiscoveryConfig(supabase: Client, workspaceId: string): Promise<{ configs: SourceConfigMap; fieldPriority: FieldPriority }> {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .eq("workspace_id", workspaceId)
    .in("key", [SOURCES_SETTING_KEY, FIELD_PRIORITY_SETTING_KEY]);
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    configs: resolveSourceConfigs(byKey.get(SOURCES_SETTING_KEY) as Partial<Record<SourceKey, Partial<SourceConfig>>> | undefined),
    fieldPriority: { ...DEFAULT_FIELD_PRIORITY, ...((byKey.get(FIELD_PRIORITY_SETTING_KEY) as FieldPriority | undefined) ?? {}) },
  };
}

export async function saveSourceOverrides(supabase: Client, workspaceId: string, overrides: Record<string, unknown>) {
  return supabase
    .from("settings")
    .upsert({ workspace_id: workspaceId, key: SOURCES_SETTING_KEY, value: overrides, updated_at: new Date().toISOString() });
}

export async function loadSourceOverrides(supabase: Client, workspaceId: string): Promise<Record<string, Partial<SourceConfig>>> {
  const { data } = await supabase.from("settings").select("value").eq("workspace_id", workspaceId).eq("key", SOURCES_SETTING_KEY).maybeSingle();
  return (data?.value as Record<string, Partial<SourceConfig>> | undefined) ?? {};
}

export async function saveFieldPriority(supabase: Client, workspaceId: string, priority: FieldPriority) {
  return supabase
    .from("settings")
    .upsert({ workspace_id: workspaceId, key: FIELD_PRIORITY_SETTING_KEY, value: priority as unknown as Record<string, unknown>, updated_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Health / circuit breakers
// ---------------------------------------------------------------------------

const ts = (v: string | null) => (v ? Date.parse(v) : null);
const iso = (v: number | null) => (v ? new Date(v).toISOString() : null);

export function rowToSnapshot(r: SourceHealthRow): BreakerSnapshot {
  return {
    key: r.source_key,
    state: r.breaker_state,
    consecutiveFailures: r.consecutive_failures,
    openedAt: ts(r.opened_at),
    lastSuccessAt: ts(r.last_success_at),
    lastErrorAt: ts(r.last_error_at),
    lastError: r.last_error,
    lastErrorKind: r.last_error_kind,
    lastStatus: r.last_status,
    lastLatencyMs: r.last_latency_ms,
    avgLatencyMs: r.avg_latency_ms,
    successCount: r.success_count,
    failureCount: r.failure_count,
    recentOutcomes: Array.isArray(r.recent_outcomes) ? r.recent_outcomes : [],
    totalResults: Number(r.total_results ?? 0),
    runs: r.runs,
    lastCheckedAt: ts(r.last_checked_at),
  };
}

export async function loadHealthRows(supabase: Client, workspaceId: string): Promise<SourceHealthRow[]> {
  const { data } = await supabase.from("source_health").select("*").eq("workspace_id", workspaceId);
  return data ?? [];
}

export async function loadBreakers(supabase: Client, workspaceId: string): Promise<BreakerRegistry> {
  return new BreakerRegistry((await loadHealthRows(supabase, workspaceId)).map(rowToSnapshot));
}

export async function persistBreakers(supabase: Client, workspaceId: string, registry: BreakerRegistry): Promise<void> {
  const dirty = registry.dirtySnapshots();
  if (!dirty.length) return;
  await supabase.from("source_health").upsert(
    dirty.map((s) => ({
      workspace_id: workspaceId,
      source_key: s.key,
      breaker_state: s.state,
      consecutive_failures: s.consecutiveFailures,
      opened_at: iso(s.openedAt),
      last_success_at: iso(s.lastSuccessAt),
      last_error_at: iso(s.lastErrorAt),
      last_error: s.lastError,
      last_error_kind: s.lastErrorKind,
      last_status: s.lastStatus,
      last_latency_ms: s.lastLatencyMs,
      avg_latency_ms: s.avgLatencyMs,
      success_count: s.successCount,
      failure_count: s.failureCount,
      recent_outcomes: s.recentOutcomes,
      total_results: s.totalResults,
      runs: s.runs,
      last_checked_at: iso(s.lastCheckedAt),
      updated_at: new Date().toISOString(),
    }))
  );
}

// ---------------------------------------------------------------------------
// Geocode cache
// ---------------------------------------------------------------------------

export function geocodeCacheFor(supabase: Client): GeocodeCache {
  return {
    async get(key) {
      const { data } = await supabase
        .from("geocode_cache")
        .select("result, expires_at")
        .eq("cache_key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      return (data?.result as unknown as ResolvedLocation | undefined) ?? undefined;
    },
    async set(key, value) {
      await supabase.from("geocode_cache").upsert({
        cache_key: key,
        result: value as unknown as Record<string, unknown>,
        source: value.source,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + GEOCODE_TTL_DAYS * 86_400_000).toISOString(),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Search log / cache
// ---------------------------------------------------------------------------

export function queryText(ctx: SearchResponse["context"]): string {
  return [ctx.industryKey ?? (ctx.keywords.length ? ctx.keywords.join(", ") : "todas as categorias"), `${ctx.city}/${ctx.state}`, ctx.radiusKm ? `${ctx.radiusKm}km` : null]
    .filter(Boolean)
    .join(" · ");
}

export async function createSearchRow(supabase: Client, input: { workspaceId: string; userId: string | null; cacheKey: string; context: SearchResponse["context"] }) {
  const { data } = await supabase
    .from("discovery_searches")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      cache_key: input.cacheKey,
      context: input.context as unknown as Record<string, unknown>,
      query_text: queryText(input.context),
      status: "SEARCHING",
    })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

/** Stored snapshots above this size keep the full list but drop per-field provenance. */
const MAX_SNAPSHOT_BYTES = 8_000_000;

function snapshotResults(results: SearchResponse["results"]): unknown[] {
  const size = JSON.stringify(results).length;
  if (size <= MAX_SNAPSHOT_BYTES) return results;
  return results.map((r) => ({ ...r, provenance: {}, sources: r.sources.slice(0, 5) }));
}

export async function completeSearchRow(supabase: Client, id: string, response: SearchResponse, ttlMinutes: number) {
  const { error } = await supabase
    .from("discovery_searches")
    .update({
      status: response.status,
      outcome: response.outcome,
      sources_used: response.sourceRuns.map((r) => r.source),
      sources_failed: response.sourceRuns.filter((r) => /ERROR|TIMEOUT|RATE_LIMITED|BLOCKED|CIRCUIT/.test(r.status)).map((r) => r.source),
      counts: response.counts as unknown as Record<string, number>,
      summary: response.summary as unknown as Record<string, number>,
      funnel: response.funnel,
      source_runs: response.sourceRuns,
      diagnostics: { ...response.diagnostics, suggestions: response.suggestions, userMessages: response.userMessages, coverage: response.coverage } as unknown as Record<string, unknown>,
      results: snapshotResults(response.results),
      final_count: response.results.length,
      quality_score: response.qualityScore,
      duration_ms: response.durationMs,
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + Math.max(0, ttlMinutes) * 60_000).toISOString(),
    })
    .eq("id", id);
  if (error) {
    // Very large result sets: keep the search log/metrics even if the snapshot doesn't fit.
    await supabase
      .from("discovery_searches")
      .update({
        status: response.status,
        outcome: response.outcome,
        counts: response.counts as unknown as Record<string, number>,
        funnel: response.funnel,
        final_count: response.results.length,
        results: response.results.slice(0, 1000).map((r) => ({ ...r, provenance: {} })),
        error: `Snapshot reduzido a 1000 resultados (${error.message.slice(0, 120)})`,
        duration_ms: response.durationMs,
        completed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + Math.max(0, ttlMinutes) * 60_000).toISOString(),
      })
      .eq("id", id);
  }
}

export async function failSearchRow(supabase: Client, id: string, status: "FAILED" | "CANCELLED", error: string) {
  await supabase.from("discovery_searches").update({ status, error: error.slice(0, 500), completed_at: new Date().toISOString() }).eq("id", id);
}

export async function updateSearchResults(supabase: Client, id: string, results: unknown[], extra: Partial<DiscoverySearchRow> = {}) {
  await supabase.from("discovery_searches").update({ results, ...extra }).eq("id", id);
}

export async function findCachedSearch(supabase: Client, workspaceId: string, cacheKey: string): Promise<DiscoverySearchRow | null> {
  const { data } = await supabase
    .from("discovery_searches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("cache_key", cacheKey)
    .in("status", ["COMPLETED", "PARTIAL"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function getSearchRow(supabase: Client, workspaceId: string, id: string): Promise<DiscoverySearchRow | null> {
  const { data } = await supabase.from("discovery_searches").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  return data ?? null;
}

export async function listSearchRows(supabase: Client, workspaceId: string, opts: { savedOnly?: boolean; limit?: number } = {}) {
  let q = supabase
    .from("discovery_searches")
    .select("id, name, saved, query_text, context, status, outcome, sources_used, sources_failed, counts, final_count, quality_score, duration_ms, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.savedOnly) q = q.eq("saved", true);
  const { data } = await q;
  return data ?? [];
}

/** Rebuild a SearchResponse from a stored row (cache hit / reopen). */
export function rowToResponse(row: DiscoverySearchRow): SearchResponse {
  const diag = row.diagnostics as unknown as SearchResponse["diagnostics"] & {
    suggestions?: SearchResponse["suggestions"];
    userMessages?: string[];
    coverage?: SearchResponse["coverage"];
  };
  const results = row.results as unknown as SearchResponse["results"];
  const context = row.context as unknown as SearchResponse["context"];
  return {
    searchId: row.id,
    cacheKey: row.cache_key,
    fromCache: true,
    outcome: row.outcome ?? "SUCCESS",
    status: row.status,
    partialResults: row.outcome === "PARTIAL",
    context,
    results,
    counts: row.counts as unknown as SearchResponse["counts"],
    summary: row.summary as unknown as SearchResponse["summary"],
    sourceRuns: row.source_runs as unknown as SearchResponse["sourceRuns"],
    funnel: row.funnel as unknown as SearchResponse["funnel"],
    diagnostics: diag,
    suggestions: diag.suggestions ?? [],
    userMessages: diag.userMessages ?? [],
    coverage: diag.coverage ?? { requested: context.limit, found: results.length, percent: 0 },
    qualityScore: row.quality_score ?? 0,
    durationMs: row.duration_ms ?? 0,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Request logs + retention
// ---------------------------------------------------------------------------

export async function insertRequestLogs(supabase: Client, workspaceId: string, searchId: string | null, logs: RequestLog[]) {
  if (!logs.length) return;
  const rows = logs.slice(0, MAX_LOGS_PER_SEARCH).map((l) => ({
    workspace_id: workspaceId,
    search_id: searchId,
    source_key: l.source,
    endpoint: l.endpoint,
    query: l.query,
    http_status: l.httpStatus,
    latency_ms: l.latencyMs,
    attempt: l.attempt,
    max_attempts: l.maxAttempts,
    error_kind: l.errorKind,
    error_message: l.errorMessage,
    results_count: l.resultsCount,
    fallback_activated: l.fallbackActivated,
    created_at: l.at,
  }));
  await supabase.from("source_request_logs").insert(rows);
}

/** Cheap housekeeping on each search (free-plan storage economy). */
export async function pruneDiscoveryData(supabase: Client, workspaceId: string) {
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000).toISOString();
  await Promise.all([
    supabase.from("source_request_logs").delete().eq("workspace_id", workspaceId).lt("created_at", cutoff),
    supabase
      .from("discovery_searches")
      .update({ results: [] })
      .eq("workspace_id", workspaceId)
      .eq("saved", false)
      .lt("expires_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ]);
}
