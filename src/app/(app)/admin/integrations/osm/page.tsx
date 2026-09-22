import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { OsmTestPanel } from "@/components/admin/osm-test-panel";

export default async function OsmIntegrationPage() {
  const workspace = await requireWorkspace();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integração OpenStreetMap</h1>
        <p className="text-sm text-muted-foreground">
          Teste de conexão com Overpass (mirrors), Nominatim e Photon. Detalhes em OSM.md ·{" "}
          <Link href="/settings/sources" className="underline">
            saúde das fontes
          </Link>
        </p>
      </div>
      <OsmTestPanel defaultCity={workspace.city ?? "Sobral"} defaultState={workspace.state ?? "CE"} />
    </div>
  );
}
