import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { getSearchRow, rowToResponse } from "@/lib/discovery/store";
import { getSearchRequestLogs } from "@/lib/queries/discovery";
import { getSourceDefinition } from "@/lib/discovery/registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunStatusBadge } from "@/components/discovery/badges";

/** DEBUG SEARCH (§52, §146): input → source query → raw → normalized → duplicates → filtered → final. */
export default async function SearchDebugPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const [row, logs] = await Promise.all([getSearchRow(supabase, workspace.id, id), getSearchRequestLogs(workspace.id, id)]);
  if (!row) notFound();
  const r = rowToResponse(row);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Debug da busca</h1>
          <p className="font-mono text-xs text-muted-foreground">
            Search ID {row.id} · cache key {row.cache_key}
          </p>
          <p className="text-sm">
            {row.query_text} · {row.status} / {row.outcome ?? "—"} · {row.duration_ms ? `${(row.duration_ms / 1000).toFixed(1)}s` : "—"}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href={`/discovery?search=${row.id}`} className="underline">
            Abrir resultados
          </Link>
          <a href={`/api/discovery/searches/${row.id}/export`} className="underline">
            Exportar CSV
          </a>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-sm">
            raw {r.counts?.raw ?? "—"} → valid {r.counts?.valid ?? "—"} → normalized {r.counts?.normalized ?? "—"} → duplicates −{r.counts?.duplicates ?? 0} → filtered −
            {r.counts?.filtered ?? 0} → <strong>final {row.final_count}</strong>
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Brutos</TableHead>
                <TableHead>Inválidos</TableHead>
                <TableHead>Válidos</TableHead>
                <TableHead>Duplicados</TableHead>
                <TableHead>Filtrados</TableHead>
                <TableHead>Aceitos</TableHead>
                <TableHead>Enriquecidos</TableHead>
                <TableHead>Limite da fonte</TableHead>
                <TableHead>Tentativas</TableHead>
                <TableHead>Tempo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(r.funnel ?? []).map((f) => (
                <TableRow key={f.source} className="text-xs">
                  <TableCell className="font-medium">
                    {getSourceDefinition(f.source).label}
                    {f.isFallback && " (fallback)"}
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={f.status} />
                  </TableCell>
                  <TableCell>{f.requested}</TableCell>
                  <TableCell>{f.returned}</TableCell>
                  <TableCell>{f.invalid}</TableCell>
                  <TableCell>{f.valid}</TableCell>
                  <TableCell>{f.duplicate}</TableCell>
                  <TableCell>{f.filtered}</TableCell>
                  <TableCell className="font-semibold">{f.accepted}</TableCell>
                  <TableCell>{f.enriched}</TableCell>
                  <TableCell>{f.sourceLimit ?? "—"}</TableCell>
                  <TableCell>{f.attempts}</TableCell>
                  <TableCell>{(f.durationMs / 1000).toFixed(1)}s</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Input (SearchContext)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(row.context, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Diagnóstico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p>Localização: {r.diagnostics?.location?.displayName ?? "—"} ({r.diagnostics?.locationStrategy?.join(" → ") || "—"})</p>
            <p>Termos: {r.diagnostics?.appliedTerms?.join(", ") || "—"}</p>
            <p>Tags OSM: {r.diagnostics?.appliedOsmTags?.join(", ") || "—"}</p>
            <p>CNAEs: {r.diagnostics?.appliedCnaes?.join(", ") || "—"}</p>
            <p>Variações automáticas: {r.diagnostics?.broadeningApplied?.join(" · ") || "nenhuma"}</p>
            <p>
              Limites: pedido {r.diagnostics?.limits?.requestedLimit} · sistema {r.diagnostics?.limits?.systemLimit} · fontes{" "}
              {Object.entries(r.diagnostics?.limits?.sourceLimits ?? {})
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}
            </p>
            <p>Deadline atingido: {r.diagnostics?.deadlineHit ? "sim" : "não"} · cancelada: {r.diagnostics?.cancelled ? "sim" : "não"}</p>
            <p className="font-medium">Filtros</p>
            {(r.diagnostics?.filters ?? []).map((f) => (
              <p key={f.key}>
                {f.active ? "●" : "○"} {f.label}: −{f.removed}
              </p>
            ))}
            <p className="font-medium">Por que esse número?</p>
            <ul className="list-disc pl-4">
              {(r.diagnostics?.lowResultReasons ?? []).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consultas por fonte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {(r.sourceRuns ?? []).map((run) => (
            <div key={run.source} className="space-y-1">
              <p className="font-medium">
                {getSourceDefinition(run.source).label} · estratégia {run.metadata.strategy ?? "—"} · páginas {run.metadata.pages} · hasMore{" "}
                {String(run.metadata.hasMore)} · endpoints {run.metadata.endpointsTried.join(", ") || "—"}
              </p>
              {run.errors.map((e, i) => (
                <p key={i} className="text-red-700">
                  {e.kind}
                  {e.httpStatus ? ` ${e.httpStatus}` : ""} {e.endpoint ? `@${e.endpoint}` : ""}: {e.message}
                </p>
              ))}
              {Object.entries(run.metadata.invalidReasons ?? {}).map(([k, v]) => (
                <p key={k} className="text-muted-foreground">
                  descartados: {v} × {k}
                </p>
              ))}
              {run.metadata.queries.map((q, i) => (
                <pre key={i} className="overflow-x-auto rounded bg-muted p-2 text-[11px]">
                  {q}
                </pre>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requisições (cada tentativa)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Query</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Latência</TableHead>
                <TableHead>Tentativa</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead>Resultados</TableHead>
                <TableHead>Fallback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id} className="text-xs">
                  <TableCell>{l.source_key}</TableCell>
                  <TableCell>{l.endpoint}</TableCell>
                  <TableCell className="max-w-72 truncate font-mono" title={l.query ?? ""}>
                    {l.query}
                  </TableCell>
                  <TableCell>{l.http_status ?? "—"}</TableCell>
                  <TableCell>{l.latency_ms}ms</TableCell>
                  <TableCell>
                    {l.attempt}/{l.max_attempts}
                  </TableCell>
                  <TableCell className="text-red-700">{l.error_kind ? `${l.error_kind}: ${l.error_message}` : ""}</TableCell>
                  <TableCell>{l.results_count ?? "—"}</TableCell>
                  <TableCell>{l.fallback_activated ? "sim" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
