import { createClient } from "@/lib/supabase/server";
import { requireUser, requireWorkspace } from "@/lib/workspace";
import { executeSearch } from "@/lib/discovery/service";
import { importDiscoveryResultsAction } from "@/lib/actions/discovery";

export const maxDuration = 300;

/**
 * POST /api/maintenance/reconcile-osm — runs an "all businesses" discovery
 * for a city and persists what OpenStreetMap adds: coordinates, websites,
 * socials and phones onto the matching stored companies (gap-fill only),
 * plus OSM-only places as new companies. Body: { city, state }
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { city?: string; state?: string };
  const [workspace, user] = await Promise.all([requireWorkspace(), requireUser()]);
  const supabase = await createClient();
  const city = body.city ?? workspace.city;
  const state = body.state ?? workspace.state;
  if (!city || !state) return Response.json({ error: "Informe city/state" }, { status: 400 });

  const response = await executeSearch({
    supabase,
    workspace,
    userId: user.id,
    rawContext: { city, state, industryKey: "todas", mode: "BROAD", depth: "DEEP", limit: 6000, autoEnrichTop: 0 },
    refresh: "all",
    signal: request.signal,
  });
  const withOsm = response.results.filter((c) => c.sourceKeys.some((s) => s.startsWith("osm_")));
  let created = 0;
  let updated = 0;
  for (let i = 0; i < withOsm.length; i += 500) {
    const res = await importDiscoveryResultsAction(withOsm.slice(i, i + 500), null, response.searchId);
    created += res.created ?? 0;
    updated += res.updated ?? 0;
  }
  return Response.json({
    outcome: response.outcome,
    searchId: response.searchId,
    totalUnique: response.results.length,
    osmRecords: withOsm.length,
    matchedToStored: withOsm.filter((c) => c.companyId).length,
    created,
    updated,
    sources: response.funnel.map((f) => ({ source: f.source, status: f.status, valid: f.valid, accepted: f.accepted })),
  });
}
