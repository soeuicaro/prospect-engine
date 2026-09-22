import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { getRecentRequestLogs, getSourceHealthOverview } from "@/lib/queries/discovery";
import { loadDiscoveryConfig } from "@/lib/discovery/store";
import { SourcesPanel } from "@/components/discovery/sources-panel";

export default async function SourcesSettingsPage() {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const [health, logs, { fieldPriority }] = await Promise.all([
    getSourceHealthOverview(workspace),
    getRecentRequestLogs(workspace.id, undefined, 40),
    loadDiscoveryConfig(supabase, workspace.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fontes de dados</h1>
          <p className="text-sm text-muted-foreground">
            Saúde, circuit breaker, limites e configuração de cada fonte do Discovery Engine. Uma fonte com falha nunca
            derruba a busca — as outras continuam.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/admin/integrations/osm" className="underline">
            Teste OSM
          </Link>
          <Link href="/admin/integrations/maps" className="underline">
            Teste Maps
          </Link>
          <Link href="/admin/discovery" className="underline">
            Qualidade do Discovery
          </Link>
        </div>
      </div>
      <SourcesPanel
        health={health}
        logs={logs}
        fieldPriority={fieldPriority}
        defaultCity={workspace.city ?? "Sobral"}
        defaultState={workspace.state ?? "CE"}
      />
    </div>
  );
}
