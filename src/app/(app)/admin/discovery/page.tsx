import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getDiscoveryQuality, getSourceHealthOverview } from "@/lib/queries/discovery";
import { getSourceDefinition } from "@/lib/discovery/registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HealthIndicator } from "@/components/discovery/badges";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default async function DiscoveryQualityPage() {
  const workspace = await requireWorkspace();
  const [{ searches, performance, totals }, health] = await Promise.all([getDiscoveryQuality(workspace.id), getSourceHealthOverview(workspace)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Qualidade do Discovery</h1>
        <p className="text-sm text-muted-foreground">
          Últimas {totals.searches} buscas · onde os leads são encontrados, perdidos (duplicados/filtrados) e enriquecidos.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="Buscas" value={String(totals.searches)} />
        <Tile label="Empresas únicas (soma)" value={String(totals.finalCompanies)} />
        <Tile label="Taxa de duplicação" value={pct(totals.duplicateRate)} />
        <Tile label="Com telefone" value={pct(totals.phoneRate)} />
        <Tile label="Com website" value={pct(totals.websiteRate)} />
        <Tile label="Quality score médio" value={totals.avgQuality == null ? "—" : `${totals.avgQuality}/100`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance por fonte</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Saúde</TableHead>
                <TableHead>Buscas</TableHead>
                <TableHead>Latência média</TableHead>
                <TableHead>Sucesso</TableHead>
                <TableHead>Falha</TableHead>
                <TableHead>Resultados médios</TableHead>
                <TableHead>Duplicação</TableHead>
                <TableHead>Leads aceitos</TableHead>
                <TableHead>Enriquecidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {performance.map((p) => (
                <TableRow key={p.source} className="text-xs">
                  <TableCell className="font-medium">{getSourceDefinition(p.source).label}</TableCell>
                  <TableCell>
                    <HealthIndicator health={health.find((h) => h.definition.key === p.source)?.health ?? "HEALTHY"} />
                  </TableCell>
                  <TableCell>{p.searches}</TableCell>
                  <TableCell>{p.avgLatencyMs != null ? `${(p.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                  <TableCell>{pct(p.successRate)}</TableCell>
                  <TableCell>{pct(p.failureRate)}</TableCell>
                  <TableCell>{p.avgResults}</TableCell>
                  <TableCell>{pct(p.duplicateRate)}</TableCell>
                  <TableCell className="font-semibold">{p.acceptedTotal}</TableCell>
                  <TableCell>{p.enrichedTotal}</TableCell>
                </TableRow>
              ))}
              {performance.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-xs text-muted-foreground">
                    Nenhuma busca registrada ainda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscas recentes (DEBUG SEARCH)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Busca</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Brutos → válidos → dup. → filtrados → final</TableHead>
                <TableHead>Qualidade</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {searches.map((s) => {
                const c = (s.counts ?? {}) as Record<string, number>;
                return (
                  <TableRow key={s.id} className="text-xs">
                    <TableCell>{new Date(s.created_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>{s.query_text}</TableCell>
                    <TableCell>{s.outcome ?? s.status}</TableCell>
                    <TableCell className="font-mono">
                      {c.raw ?? "—"} → {c.valid ?? "—"} → −{c.duplicates ?? 0} → −{c.filtered ?? 0} → {s.final_count}
                    </TableCell>
                    <TableCell>{s.quality_score ?? "—"}</TableCell>
                    <TableCell>{s.duration_ms ? `${(s.duration_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                    <TableCell>
                      <Link href={`/admin/discovery/searches/${s.id}`} className="underline">
                        Debug
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
