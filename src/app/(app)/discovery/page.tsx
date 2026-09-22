import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { listIndustries } from "@/lib/queries/industries";
import { getSourceHealthOverview, listDiscoverySearches } from "@/lib/queries/discovery";
import { getSearchRow, rowToResponse } from "@/lib/discovery/store";
import { INDUSTRY_CATALOG } from "@/lib/discovery/industries";
import { DiscoveryWorkbench, type NicheOption, type SourceOption } from "@/components/discovery/discovery-workbench";
import type { SearchResponse } from "@/lib/discovery/types";

export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const workspace = await requireWorkspace();
  const params = await searchParams;
  const supabase = await createClient();

  const [industries, health, history, saved, reopened] = await Promise.all([
    listIndustries(workspace.id),
    getSourceHealthOverview(workspace),
    listDiscoverySearches(workspace.id, { limit: 10 }),
    listDiscoverySearches(workspace.id, { savedOnly: true, limit: 20 }),
    params.search ? getSearchRow(supabase, workspace.id, params.search) : Promise.resolve(null),
  ]);

  // Workspace niches first (they carry the DB id used for local matching +
  // import), then catalog niches that have no DB row yet.
  const niches: NicheOption[] = [{ value: "key:todas", label: "★ Todas as empresas da cidade (todas as atividades)", industryId: null, industryKey: "todas" }];
  niches.push(...industries.map((i) => ({
    value: `id:${i.id}`,
    label: i.name,
    industryId: i.id,
    industryKey: INDUSTRY_CATALOG.some((c) => c.key === i.slug) ? i.slug : null,
  })));
  for (const c of INDUSTRY_CATALOG) {
    if (!niches.some((n) => n.industryKey === c.key)) niches.push({ value: `key:${c.key}`, label: c.label, industryId: null, industryKey: c.key });
  }

  const sources: SourceOption[] = health
    .filter((h) => h.definition.kind === "discovery")
    .map((h) => ({ key: h.definition.key, label: h.definition.label, shortLabel: h.definition.shortLabel, enabled: h.config.enabled, health: h.health }));

  let initial: SearchResponse | null = null;
  if (reopened) initial = rowToResponse(reopened);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discovery Engine</h1>
        <p className="text-sm text-muted-foreground">
          Busca multi-fonte: banco local (inclui a base CNPJ importada) + OpenStreetMap (Overpass, Nominatim, Photon), com
          deduplicação, procedência por campo e enriquecimento progressivo (CNPJ e site oficial). Google Maps é usado para
          abrir e validar cada empresa.
        </p>
      </div>
      <DiscoveryWorkbench
        niches={niches}
        sources={sources}
        defaultCity={workspace.city}
        defaultState={workspace.state}
        history={history.map((h) => ({ ...h, context: h.context as Record<string, unknown> }))}
        saved={saved.map((h) => ({ ...h, context: h.context as Record<string, unknown> }))}
        initial={initial}
      />
    </div>
  );
}
