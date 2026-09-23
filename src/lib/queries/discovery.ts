import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";
import { deriveHealth, successRate, DEFAULT_BREAKER_OPTIONS } from "@/lib/discovery/circuit-breaker";
import { SOURCE_DEFINITIONS, type SourceDefinition } from "@/lib/discovery/registry";
import { loadDiscoveryConfig, loadHealthRows, listSearchRows, rowToSnapshot } from "@/lib/discovery/store";
import type { HealthStatus, SourceConfig, SourceFunnelMetrics, SourceKey } from "@/lib/discovery/types";

export interface SourceHealthView {
  definition: SourceDefinition;
  config: SourceConfig;
  health: HealthStatus;
  breakerState: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastErrorKind: string | null;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  successRate: number | null;
  runs: number;
  lastCheckedAt: string | null;
  retryInMs: number;
  /** Sub-components: Overpass mirrors, geocoders. */
  components: { key: string; health: HealthStatus; breakerState: string; lastError: string | null; lastLatencyMs: number | null; successRate: number | null; lastCheckedAt: string | null }[];
}

const iso = (v: number | null) => (v ? new Date(v).toISOString() : null);

export async function getSourceHealthOverview(workspace: Workspace): Promise<SourceHealthView[]> {
  const supabase = await createClient();
  const [{ configs }, rows] = await Promise.all([loadDiscoveryConfig(supabase, workspace.id), loadHealthRows(supabase, workspace.id)]);
  const snapshots = rows.map(rowToSnapshot);
  const now = Date.now();
  const osmOff = workspace.feature_flags.OSM_DISCOVERY === false;

  return SOURCE_DEFINITIONS.map((definition) => {
    const config = { ...configs[definition.key] };
    if (osmOff && definition.key.startsWith("osm_")) config.enabled = false;
    const own = snapshots.find((s) => s.key === definition.key) ?? null;
    const components = snapshots
      .filter((s) => s.key !== definition.key && (s.key.startsWith(`${definition.key}@`) || s.key.startsWith(`${definition.key}:`)))
      .map((s) => ({
        key: s.key.replace(`${definition.key}@`, "mirror ").replace(`${definition.key}:`, ""),
        health: deriveHealth(s, { enabled: config.enabled, configured: true, now }),
        breakerState: s.state,
        lastError: s.lastError,
        lastLatencyMs: s.lastLatencyMs,
        successRate: successRate(s),
        lastCheckedAt: iso(s.lastCheckedAt),
      }));
    const retryInMs =
      own?.state === "OPEN" && own.openedAt ? Math.max(0, DEFAULT_BREAKER_OPTIONS.cooldownMs - (now - own.openedAt)) : 0;
    return {
      definition,
      config,
      health: definition.kind === "validation" ? (config.enabled ? "HEALTHY" : "DISABLED") : deriveHealth(own, { enabled: config.enabled, configured: true, now }),
      breakerState: own ? (own.state === "OPEN" && retryInMs === 0 ? "HALF_OPEN" : own.state) : "CLOSED",
      lastSuccessAt: iso(own?.lastSuccessAt ?? null),
      lastErrorAt: iso(own?.lastErrorAt ?? null),
      lastError: own?.lastError ?? null,
      lastErrorKind: own?.lastErrorKind ?? null,
      lastStatus: own?.lastStatus ?? null,
      lastLatencyMs: own?.lastLatencyMs ?? null,
      avgLatencyMs: own?.avgLatencyMs ?? null,
      successRate: own ? successRate(own) : null,
      runs: own?.runs ?? 0,
      lastCheckedAt: iso(own?.lastCheckedAt ?? null),
      retryInMs,
      components,
    };
  });
}

export async function listDiscoverySearches(workspaceId: string, opts: { savedOnly?: boolean; limit?: number | null } = {}) {
  const supabase = await createClient();
  return listSearchRows(supabase, workspaceId, opts);
}

export async function getSearchRequestLogs(workspaceId: string, searchId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("source_request_logs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("search_id", searchId)
    .order("created_at", { ascending: true })
    .limit(300);
  return data ?? [];
}

export async function getRecentRequestLogs(workspaceId: string, source?: SourceKey, limit = 50) {
  const supabase = await createClient();
  let q = supabase.from("source_request_logs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (source) q = q.eq("source_key", source);
  const { data } = await q;
  return data ?? [];
}

export interface SourcePerformance {
  source: SourceKey;
  searches: number;
  avgLatencyMs: number | null;
  successRate: number | null;
  failureRate: number | null;
  avgResults: number;
  duplicateRate: number | null;
  acceptedTotal: number;
  enrichedTotal: number;
}

/** Discovery Quality Dashboard aggregates over the last N searches (§82-83). */
export async function getDiscoveryQuality(workspaceId: string, limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("discovery_searches")
    .select("id, query_text, status, outcome, funnel, counts, summary, final_count, quality_score, duration_ms, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const searches = data ?? [];
  const perSource = new Map<SourceKey, { n: number; latency: number[]; ok: number; results: number; dup: number; valid: number; accepted: number; enriched: number }>();
  let totalFinal = 0;
  let totalRaw = 0;
  let totalDup = 0;
  let withPhone = 0;
  let withWebsite = 0;
  let quality: number[] = [];
  for (const s of searches) {
    const counts = (s.counts ?? {}) as Record<string, number>;
    const summary = (s.summary ?? {}) as Record<string, number>;
    totalFinal += s.final_count ?? 0;
    totalRaw += counts.valid ?? 0;
    totalDup += counts.duplicates ?? 0;
    withPhone += summary.withPhone ?? 0;
    withWebsite += summary.withWebsite ?? 0;
    if (s.quality_score != null) quality.push(s.quality_score);
    for (const f of (s.funnel ?? []) as SourceFunnelMetrics[]) {
      const agg = perSource.get(f.source) ?? { n: 0, latency: [], ok: 0, results: 0, dup: 0, valid: 0, accepted: 0, enriched: 0 };
      agg.n += 1;
      agg.latency.push(f.durationMs);
      if (!/ERROR|TIMEOUT|RATE_LIMITED|BLOCKED|CIRCUIT/.test(f.status)) agg.ok += 1;
      agg.results += f.valid;
      agg.dup += f.duplicate;
      agg.valid += f.valid;
      agg.accepted += f.accepted;
      agg.enriched += f.enriched ?? 0;
      perSource.set(f.source, agg);
    }
  }
  quality = quality.slice(0, 50);
  const performance: SourcePerformance[] = [...perSource.entries()].map(([source, a]) => ({
    source,
    searches: a.n,
    avgLatencyMs: a.latency.length ? Math.round(a.latency.reduce((x, y) => x + y, 0) / a.latency.length) : null,
    successRate: a.n ? a.ok / a.n : null,
    failureRate: a.n ? 1 - a.ok / a.n : null,
    avgResults: a.n ? Math.round(a.results / a.n) : 0,
    duplicateRate: a.valid ? a.dup / a.valid : null,
    acceptedTotal: a.accepted,
    enrichedTotal: a.enriched,
  }));
  return {
    searches,
    performance: performance.sort((a, b) => b.acceptedTotal - a.acceptedTotal),
    totals: {
      searches: searches.length,
      finalCompanies: totalFinal,
      duplicateRate: totalRaw ? totalDup / totalRaw : null,
      phoneRate: totalFinal ? withPhone / totalFinal : null,
      websiteRate: totalFinal ? withWebsite / totalFinal : null,
      avgQuality: quality.length ? Math.round(quality.reduce((x, y) => x + y, 0) / quality.length) : null,
    },
  };
}
