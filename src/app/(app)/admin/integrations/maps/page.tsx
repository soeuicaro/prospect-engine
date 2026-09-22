import { MapsTestPanel } from "@/components/admin/maps-test-panel";

export default function MapsIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integração Google Maps</h1>
        <p className="text-sm text-muted-foreground">
          Teste da URL de pesquisa gerada para cada empresa (nome + endereço + cidade/UF, ou coordenadas). Ver MAPS.md.
        </p>
      </div>
      <MapsTestPanel />
    </div>
  );
}
