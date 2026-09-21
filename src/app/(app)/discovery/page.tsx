import { requireWorkspace } from "@/lib/workspace";
import { listIndustries } from "@/lib/queries/industries";
import { OSM_CATEGORIES } from "@/lib/providers/osm";
import { DiscoveryForm } from "@/components/discovery/discovery-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DiscoveryPage() {
  const workspace = await requireWorkspace();
  const industries = await listIndustries(workspace.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discovery Engine</h1>
        <p className="text-sm text-muted-foreground">
          Cidade + categoria → descoberta de empresas via OpenStreetMap (fonte gratuita e pública).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova busca</CardTitle>
        </CardHeader>
        <CardContent>
          <DiscoveryForm categories={OSM_CATEGORIES} industries={industries} defaultCity={workspace.city} defaultState={workspace.state} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Outras fontes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            <strong>CNPJ:</strong> importe dados oficiais da Receita Federal em{" "}
            <a href="/imports" className="underline">
              Imports
            </a>{" "}
            — veja CNPJ_IMPORT.md para o pipeline completo.
          </p>
          <p>
            <strong>Google Maps:</strong> usado apenas como validação/consulta na página de cada empresa —
            nunca como fonte de descoberta em massa (ver MAPS_USAGE.md).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
