"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PlayCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  resetBreakerAction,
  testAllSourcesAction,
  updateFieldPriorityAction,
  updateSourceConfigAction,
} from "@/lib/actions/discovery";
import type { SourceTestResult } from "@/lib/discovery/diagnostics";
import type { FieldPriority } from "@/lib/discovery/registry";
import type { SourceConfig, SourceKey } from "@/lib/discovery/types";
import type { SourceHealthView } from "@/lib/queries/discovery";
import type { SourceRequestLogRow } from "@/types/database";
import { HealthIndicator, RunStatusBadge } from "./badges";

function ago(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export function SourcesPanel({
  health,
  logs,
  fieldPriority,
  defaultCity,
  defaultState,
}: {
  health: SourceHealthView[];
  logs: SourceRequestLogRow[];
  fieldPriority: FieldPriority;
  defaultCity: string;
  defaultState: string;
}) {
  const [pending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState<SourceTestResult[] | null>(null);
  const [testCity, setTestCity] = useState(defaultCity);
  const [testState, setTestState] = useState(defaultState);

  const degraded = health.filter((h) => h.health === "DOWN" || h.health === "DEGRADED" || h.components.some((c) => c.health === "DOWN"));

  function save(source: SourceKey, patch: Partial<SourceConfig>) {
    startTransition(async () => {
      const res = await updateSourceConfigAction(source, patch);
      if (res.error) toast.error(res.error);
      else toast.success("Configuração salva.");
    });
  }

  async function testAll() {
    setTesting(true);
    try {
      setTests(await testAllSourcesAction({ city: testCity, state: testState }));
    } catch {
      toast.error("Falha ao executar os testes.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      {degraded.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {degraded.map((h) => (
            <p key={h.definition.key} className="flex items-center gap-2">
              <AlertTriangle className="size-4" /> {h.definition.label} está apresentando {h.health === "DOWN" ? "indisponibilidade (circuit breaker aberto)" : "degradação"}.
              {h.lastError && <span className="text-xs opacity-80">Último erro: {h.lastError}</span>}
            </p>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Diagnóstico — testar todas as fontes</CardTitle>
          <div className="flex items-center gap-2">
            <Input value={testCity} onChange={(e) => setTestCity(e.target.value)} className="h-8 w-36" placeholder="Cidade" />
            <Input value={testState} onChange={(e) => setTestState(e.target.value)} className="h-8 w-16" placeholder="UF" />
            <Button size="sm" onClick={() => void testAll()} disabled={testing}>
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />} TEST ALL SOURCES
            </Button>
          </div>
        </CardHeader>
        {tests && (
          <CardContent>
            <div className="grid gap-2 md:grid-cols-3">
              {tests.map((t) => (
                <div key={t.source} className="rounded-md border p-2 text-xs">
                  <p className="flex items-center justify-between font-medium">
                    <span>
                      {t.ok ? "✅" : t.status === "SKIPPED" ? "➖" : /PARTIAL|WARNINGS|NO_RESULTS/.test(t.status) ? "⚠️" : "❌"}{" "}
                      {health.find((h) => h.definition.key === t.source)?.definition.label ?? t.source}
                    </span>
                    {t.status !== "SKIPPED" && <RunStatusBadge status={t.status} />}
                  </p>
                  <p className="text-muted-foreground">
                    {(t.latencyMs / 1000).toFixed(1)}s · {t.count} resultado(s) · {t.endpoints.join(", ") || "—"}
                  </p>
                  {t.sample.length > 0 && <p className="truncate">{t.sample.join(" · ")}</p>}
                  {t.error && <p className={t.ok ? "text-amber-700" : "text-red-700"}>{t.error}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saúde e configuração</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Breaker</TableHead>
                <TableHead>Último sucesso</TableHead>
                <TableHead>Último erro</TableHead>
                <TableHead>Latência (últ./média)</TableHead>
                <TableHead>Taxa de sucesso</TableHead>
                <TableHead>Última verificação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.map((h) => (
                <SourceRow key={h.definition.key} h={h} pending={pending} onSave={save} onReset={(key) => startTransition(async () => {
                  await resetBreakerAction(key);
                  toast.success("Circuit breaker resetado.");
                })} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FieldPriorityCard initial={fieldPriority} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matriz de fontes</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>Tipo / custo</TableHead>
                <TableHead>Objetivo</TableHead>
                <TableHead>Limites</TableHead>
                <TableHead>Dados</TableHead>
                <TableHead>Armazenamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.map(({ definition: d }) => (
                <TableRow key={d.key} className="align-top text-xs">
                  <TableCell className="font-medium">{d.label}</TableCell>
                  <TableCell>
                    {d.kind} · {d.cost}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">{d.purpose}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal">{d.limits}</TableCell>
                  <TableCell className="max-w-48 whitespace-normal">
                    {Object.entries(d.capabilities)
                      .filter(([k, v]) => v === true && k.startsWith("canReturn"))
                      .map(([k]) => k.replace("canReturn", ""))
                      .join(", ") || "—"}
                    {d.capabilities.supportsPagination !== "none" && ` · paginação: ${d.capabilities.supportsPagination}`}
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">{d.storage}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas requisições externas</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Latência</TableHead>
                <TableHead>Tentativa</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead>Resultados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id} className="text-xs">
                  <TableCell>{ago(l.created_at)}</TableCell>
                  <TableCell>
                    {l.source_key}
                    {l.fallback_activated && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">fallback</span>}
                  </TableCell>
                  <TableCell className="max-w-48 truncate" title={l.query ?? ""}>
                    {l.endpoint}
                  </TableCell>
                  <TableCell>{l.http_status ?? "—"}</TableCell>
                  <TableCell>{l.latency_ms ?? "—"}ms</TableCell>
                  <TableCell>
                    {l.attempt}/{l.max_attempts}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-red-700" title={l.error_message ?? ""}>
                    {l.error_kind ? `${l.error_kind}: ${l.error_message ?? ""}` : ""}
                  </TableCell>
                  <TableCell>{l.results_count ?? "—"}</TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-xs text-muted-foreground">
                    Nenhuma requisição registrada ainda (ou a migration 0011 ainda não foi aplicada).
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceRow({
  h,
  pending,
  onSave,
  onReset,
}: {
  h: SourceHealthView;
  pending: boolean;
  onSave: (source: SourceKey, patch: Partial<SourceConfig>) => void;
  onReset: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<SourceConfig>(h.config);
  const key = h.definition.key;
  const configurable = h.definition.kind !== "validation";
  const num = (field: keyof SourceConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [field]: Number(e.target.value) });

  return (
    <>
      <TableRow className="text-xs">
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {configurable && (
              <Switch
                checked={cfg.enabled}
                disabled={pending}
                onCheckedChange={(v) => {
                  setCfg({ ...cfg, enabled: v });
                  onSave(key, { enabled: v });
                }}
              />
            )}
            {h.definition.label}
          </div>
        </TableCell>
        <TableCell>
          <HealthIndicator health={h.health} />
        </TableCell>
        <TableCell>
          {h.breakerState}
          {h.retryInMs > 0 && <span className="text-muted-foreground"> · ~{Math.ceil(h.retryInMs / 1000)}s</span>}
        </TableCell>
        <TableCell>{ago(h.lastSuccessAt)}</TableCell>
        <TableCell className="max-w-56 truncate text-red-700" title={h.lastError ?? ""}>
          {h.lastErrorAt ? `${ago(h.lastErrorAt)} · ${h.lastErrorKind ?? ""}` : "—"}
        </TableCell>
        <TableCell>{h.lastLatencyMs != null ? `${h.lastLatencyMs}ms / ${h.avgLatencyMs ?? "—"}ms` : "—"}</TableCell>
        <TableCell>{h.successRate != null ? `${Math.round(h.successRate * 100)}% (${h.runs})` : "—"}</TableCell>
        <TableCell>{ago(h.lastCheckedAt)}</TableCell>
        <TableCell className="whitespace-nowrap">
          {configurable && (
            <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)}>
              Configurar
            </Button>
          )}
          {h.breakerState !== "CLOSED" && (
            <Button size="xs" variant="ghost" onClick={() => onReset(key)}>
              <RotateCcw className="size-3" /> Reset
            </Button>
          )}
        </TableCell>
      </TableRow>
      {h.components.map((c) => (
        <TableRow key={c.key} className="text-[11px] text-muted-foreground">
          <TableCell className="pl-10">↳ {c.key}</TableCell>
          <TableCell>
            <HealthIndicator health={c.health} />
          </TableCell>
          <TableCell>{c.breakerState}</TableCell>
          <TableCell colSpan={2} className="max-w-72 truncate" title={c.lastError ?? ""}>
            {c.lastError ?? "—"}
          </TableCell>
          <TableCell>{c.lastLatencyMs != null ? `${c.lastLatencyMs}ms` : "—"}</TableCell>
          <TableCell>{c.successRate != null ? `${Math.round(c.successRate * 100)}%` : "—"}</TableCell>
          <TableCell>{ago(c.lastCheckedAt)}</TableCell>
          <TableCell>
            {c.breakerState !== "CLOSED" && (
              <Button size="xs" variant="ghost" onClick={() => onReset(`${key}${c.key.startsWith("mirror ") ? `@${c.key.slice(7)}` : `:${c.key}`}`)}>
                <RotateCcw className="size-3" />
              </Button>
            )}
          </TableCell>
        </TableRow>
      ))}
      {open && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/20">
            <div className="grid gap-2 py-2 text-xs md:grid-cols-7">
              <Num label="Prioridade" value={cfg.priority} onChange={num("priority")} />
              <Num label="Timeout (ms)" value={cfg.timeoutMs} onChange={num("timeoutMs")} />
              <Num label="Retries" value={cfg.retryCount} onChange={num("retryCount")} />
              <Num label="Rate limit (req/s)" value={cfg.rateLimitPerSec} onChange={num("rateLimitPerSec")} step={0.1} />
              <Num label="Cache (min)" value={cfg.cacheTtlMinutes} onChange={num("cacheTtlMinutes")} />
              <Num label="Máx. resultados" value={cfg.maxResults} onChange={num("maxResults")} />
              <div className="space-y-1">
                <label className="text-muted-foreground">Fallback</label>
                <div className="flex items-center gap-2">
                  <Switch checked={cfg.fallbackEnabled} onCheckedChange={(v) => setCfg({ ...cfg, fallbackEnabled: v })} />
                  <span>{cfg.fallbackTo.join(" → ") || "—"}</span>
                </div>
              </div>
              <div className="md:col-span-7">
                <Button size="xs" disabled={pending} onClick={() => onSave(key, cfg)}>
                  Salvar configuração
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Num({ label, value, onChange, step }: { label: string; value: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground">{label}</label>
      <Input type="number" value={value} onChange={onChange} step={step} className="h-7" />
    </div>
  );
}

const GROUP_LABEL: Record<string, string> = {
  identity: "Dados cadastrais (nome, CNPJ, razão social)",
  phone: "Telefone / WhatsApp",
  email: "E-mail",
  website: "Website",
  social: "Redes sociais",
  address: "Endereço",
  coordinates: "Coordenadas",
};

function FieldPriorityCard({ initial }: { initial: FieldPriority }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.join(", ")])));
  const [pending, startTransition] = useTransition();
  function save() {
    const priority = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.split(",").map((x) => x.trim()).filter(Boolean) as SourceKey[]])
    );
    startTransition(async () => {
      const res = await updateFieldPriorityAction(priority);
      if (res.error) toast.error(res.error);
      else toast.success("Prioridade por campo salva.");
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prioridade de fonte por campo (merge)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          Quando duas fontes discordam, vence a primeira da lista (depois confiança e recência). O valor perdedor fica registrado como
          conflito para você escolher. Chaves: local_db, cnpj_brasilapi, website_discovery, osm_overpass, osm_nominatim, osm_photon.
        </p>
        {Object.keys(values).map((group) => (
          <div key={group} className="grid items-center gap-2 md:grid-cols-4">
            <label className="text-muted-foreground">{GROUP_LABEL[group] ?? group}</label>
            <Input value={values[group]} onChange={(e) => setValues({ ...values, [group]: e.target.value })} className="h-7 md:col-span-3" />
          </div>
        ))}
        <Button size="xs" onClick={save} disabled={pending}>
          Salvar prioridades
        </Button>
      </CardContent>
    </Card>
  );
}
