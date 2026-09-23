"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import { Download, History, Info, Loader2, RefreshCw, Save, Search, Square, Star, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChoiceSelect } from "@/components/shared/choice-select";
import { importDiscoveryResultsAction, saveSearchAction } from "@/lib/actions/discovery";
import { discoveryCsvRows } from "@/lib/discovery/export";
import { foldText } from "@/lib/discovery/normalize";
import { formatSeconds } from "@/lib/utils-date";
import type {
  HealthStatus,
  SearchContext,
  SearchResponse,
  SearchStreamEvent,
  SourceKey,
  SourceRunStatus,
  UnifiedCompany,
} from "@/lib/discovery/types";
import { HealthIndicator, RunStatusBadge } from "./badges";
import { DiscoveryResults } from "./discovery-results";
import { DiscoverySummary, type EnrichProgress } from "./discovery-summary";
import { CityAutocomplete, StateAutocomplete } from "./location-autocomplete";

export interface NicheOption {
  value: string;
  label: string;
  industryId: string | null;
  industryKey: string | null;
}

export interface SourceOption {
  key: SourceKey;
  label: string;
  shortLabel: string;
  enabled: boolean;
  health: HealthStatus;
}

interface HistoryItem {
  id: string;
  name: string | null;
  saved: boolean;
  query_text: string | null;
  context: Record<string, unknown>;
  status: string;
  outcome: string | null;
  final_count: number;
  duration_ms: number | null;
  created_at: string;
}

type SourceProgress = { status: SourceRunStatus; returned: number; durationMs: number; isFallback: boolean; message: string | null };

const ENRICH_BATCH = 5;

/** Mirrors DEPTH_DEADLINE_MS in lib/discovery/orchestrator.ts (hard ceiling per depth). */
const DEPTH_DEADLINE_S: Record<SearchContext["depth"], number> = { FAST: 20, BALANCED: 40, DEEP: 55 };

/** Expected search time: median of this workspace's past searches at the same depth, else ~60% of the ceiling. */
function estimateSearchSeconds(history: HistoryItem[], depth: SearchContext["depth"]): number {
  const durations = history
    .filter((h) => h.duration_ms && (h.context as { depth?: string }).depth === depth)
    .slice(0, 20)
    .map((h) => h.duration_ms! / 1000)
    .sort((a, b) => a - b);
  if (!durations.length) return Math.round(DEPTH_DEADLINE_S[depth] * 0.6);
  return Math.max(3, Math.round(durations[Math.floor(durations.length / 2)]));
}

export function DiscoveryWorkbench({
  niches,
  sources,
  defaultCity,
  defaultState,
  history,
  saved,
  initial,
}: {
  niches: NicheOption[];
  sources: SourceOption[];
  defaultCity: string | null;
  defaultState: string | null;
  history: HistoryItem[];
  saved: HistoryItem[];
  initial: SearchResponse | null;
}) {
  // A reopened search (/discovery?search=<id>) pre-fills the form with its context.
  const init = initial?.context;
  const initialNiche =
    niches.find((n) => (init?.industryId && n.industryId === init.industryId) || (!init?.industryId && init?.industryKey && n.industryKey === init.industryKey))?.value ??
    (init ? "" : undefined);
  const defaultNiche = initialNiche ?? niches.find((n) => n.industryKey === "restaurante")?.value ?? niches[0]?.value ?? "";
  const [city, setCity] = useState(init?.city ?? defaultCity ?? "");
  const [state, setState] = useState(init?.state ?? defaultState ?? "");
  const [niche, setNiche] = useState(defaultNiche);
  const [keywordsText, setKeywordsText] = useState(init?.keywords?.join(", ") ?? "");
  // Defaults tuned for coverage: broad mode + related CNAEs, goal 500.
  const [limit, setLimit] = useState(init?.limit ?? 500);
  const [mode, setMode] = useState<SearchContext["mode"]>(init?.mode ?? "BROAD");
  const [depth, setDepth] = useState<SearchContext["depth"]>(init?.depth ?? "BALANCED");
  const [radius, setRadius] = useState(init?.radiusKm ? String(init.radiusKm) : "");
  const [includeRelatedCnaes, setIncludeRelatedCnaes] = useState(init?.includeRelatedCnaes ?? true);
  const [activeOnly, setActiveOnly] = useState(Boolean(init?.cnpjStatus?.includes("ATIVA")));
  const [enabledSources, setEnabledSources] = useState<Set<SourceKey>>(
    new Set(init?.sourcesEnabled ?? sources.filter((s) => s.enabled).map((s) => s.key))
  );
  const [autoEnrich, setAutoEnrich] = useState(init ? init.autoEnrichTop > 0 : true);
  const [autoEnrichTop, setAutoEnrichTop] = useState(init?.autoEnrichTop || 50);

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [sourceProgress, setSourceProgress] = useState<Partial<Record<SourceKey, SourceProgress>>>({});
  const [liveCount, setLiveCount] = useState<{ found: number; unique: number } | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(initial);
  const [results, setResults] = useState<UnifiedCompany[]>(initial?.results ?? []);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrich, setEnrich] = useState<EnrichProgress>({ done: 0, running: 0, total: 0, failed: 0, startedAt: null });
  const [enriching, setEnriching] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [saveName, setSaveName] = useState("");
  const [importing, startImport] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const enrichAbortRef = useRef<AbortController | null>(null);

  const nicheOption = niches.find((n) => n.value === niche) ?? null;
  const router = useRouter();

  // Ticks the elapsed/remaining time while a search runs.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const applyContextToForm = useCallback(
    (ctx: Partial<SearchContext>) => {
      if (ctx.city) setCity(ctx.city);
      if (ctx.state) setState(ctx.state);
      const n = niches.find((x) => (ctx.industryId && x.industryId === ctx.industryId) || (!ctx.industryId && ctx.industryKey && x.industryKey === ctx.industryKey));
      if (n) setNiche(n.value);
      else if (ctx.industryKey === null && ctx.industryId === null) setNiche("");
      if (ctx.keywords) setKeywordsText(ctx.keywords.join(", "));
      if (ctx.limit) setLimit(ctx.limit);
      if (ctx.mode) setMode(ctx.mode);
      if (ctx.depth) setDepth(ctx.depth);
      if (ctx.radiusKm !== undefined) setRadius(ctx.radiusKm ? String(ctx.radiusKm) : "");
      if (ctx.includeRelatedCnaes !== undefined) setIncludeRelatedCnaes(ctx.includeRelatedCnaes);
      if (ctx.cnpjStatus) setActiveOnly(ctx.cnpjStatus.includes("ATIVA") && ctx.cnpjStatus.length <= 2);
      if (ctx.sourcesEnabled) setEnabledSources(new Set(ctx.sourcesEnabled));
      if (ctx.autoEnrichTop !== undefined) {
        setAutoEnrich(ctx.autoEnrichTop > 0);
        if (ctx.autoEnrichTop > 0) setAutoEnrichTop(ctx.autoEnrichTop);
      }
    },
    [niches]
  );

  function buildContext(patch: Partial<SearchContext> = {}): Partial<SearchContext> {
    const keywords = keywordsText
      .split(/[,;\n]/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2);
    const base: Partial<SearchContext> = {
      city,
      state,
      industryId: nicheOption?.industryId ?? null,
      industryKey: nicheOption?.industryKey ?? null,
      keywords,
      limit,
      mode,
      depth,
      radiusKm: radius ? Number(radius) : null,
      includeRelatedCnaes,
      cnpjStatus: activeOnly ? ["ATIVA"] : [],
      sourcesEnabled: [...enabledSources],
      autoEnrichTop: autoEnrich ? autoEnrichTop : 0,
      expandKeywords: true,
    };
    return { ...base, ...patch };
  }

  const runEnrichment = useCallback(async (resp: SearchResponse, list: UnifiedCompany[], manual = false) => {
    enrichAbortRef.current?.abort();
    // Automatic run: the top-ranked PENDING batch. Manual run: everything not enriched yet.
    const pendingList = list
      .filter((c) => c.enrichment.state === "PENDING" || (manual && c.enrichment.state === "SKIPPED"))
      .map((c) => (c.enrichment.state === "SKIPPED" ? { ...c, enrichment: { ...c.enrichment, state: "PENDING" as const } } : c));
    if (!pendingList.length || (!manual && (resp.context.depth === "FAST" || resp.context.autoEnrichTop === 0))) return;
    const controller = new AbortController();
    enrichAbortRef.current = controller;
    let done = 0;
    let failed = 0;
    const t0 = Date.now();
    setEnriching(true);
    setEnrich({ done: 0, running: pendingList.length, total: pendingList.length, failed: 0, startedAt: t0 });
    for (let i = 0; i < pendingList.length; i += ENRICH_BATCH) {
      if (controller.signal.aborted) break;
      const batch = pendingList.slice(i, i + ENRICH_BATCH);
      const keys = new Set(batch.map((c) => c.key));
      setResults((prev) => prev.map((c) => (keys.has(c.key) ? { ...c, enrichment: { ...c.enrichment, state: "RUNNING" } } : c)));
      try {
        const res = await fetch("/api/discovery/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchId: resp.searchId, companies: batch }),
          signal: controller.signal,
        });
        const data = (await res.json()) as { companies?: UnifiedCompany[]; error?: string };
        if (!res.ok || !data.companies) throw new Error(data.error ?? "falha");
        const byKey = new Map(data.companies.map((c) => [c.key, c]));
        setResults((prev) => prev.map((c) => byKey.get(c.key) ?? c));
        done += data.companies.filter((c) => c.enrichment.state === "DONE" || c.enrichment.state === "SKIPPED").length;
        failed += data.companies.filter((c) => c.enrichment.state === "FAILED").length;
      } catch {
        if (controller.signal.aborted) break;
        failed += batch.length;
        setResults((prev) =>
          prev.map((c) => (keys.has(c.key) ? { ...c, enrichment: { state: "FAILED", sources: [], message: "Lote de enriquecimento falhou" } } : c))
        );
      }
      setEnrich({ done, failed, running: Math.max(0, pendingList.length - done - failed), total: pendingList.length, startedAt: t0, updatedAt: Date.now() });
    }
    if (enrichAbortRef.current === controller) setEnriching(false);
  }, []);

  async function runSearch(patch: Partial<SearchContext> = {}, refresh: "none" | "all" | { source: SourceKey; searchId: string } = "none") {
    if (running) return;
    if (!city.trim() || !state.trim()) {
      toast.error("Informe cidade e UF.");
      return;
    }
    if (patch && Object.keys(patch).length) applyContextToForm(patch);
    abortRef.current?.abort();
    enrichAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    setFatalError(null);
    setPhase("Buscando empresas...");
    setSourceProgress({});
    setLiveCount(null);
    setSelected(new Set());
    setEnrich({ done: 0, running: 0, total: 0, failed: 0, startedAt: null });

    try {
      const res = await fetch("/api/discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: buildContext(patch), refresh }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: SearchResponse | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as SearchStreamEvent;
          if (event.type === "phase") setPhase(event.message);
          else if (event.type === "source")
            setSourceProgress((prev) => ({
              ...prev,
              [event.source]: { status: event.status, returned: event.returned, durationMs: event.durationMs, isFallback: event.isFallback, message: event.message },
            }));
          else if (event.type === "progress") setLiveCount({ found: event.found, unique: event.unique });
          else if (event.type === "error") setFatalError(event.message);
          else if (event.type === "done") finalResponse = event.response;
        }
      }
      if (finalResponse) {
        setResponse(finalResponse);
        setResults(finalResponse.results);
        if (finalResponse.searchId) window.history.replaceState(null, "", `/discovery?search=${finalResponse.searchId}`);
        if (finalResponse.outcome === "FAILED") setFatalError(finalResponse.userMessages[0] ?? "Todas as fontes configuradas falharam.");
        else toast.success(`${finalResponse.results.length} empresa(s) únicas encontradas${finalResponse.fromCache ? " (cache)" : ""}.`);
        if (autoEnrich) void runEnrichment(finalResponse, finalResponse.results);
      }
    } catch (err) {
      if (controller.signal.aborted) toast.message("Busca cancelada. Resultados parciais (se houver) ficam no histórico.");
      else setFatalError(`Não foi possível realizar a busca agora (${err instanceof Error ? err.message : "erro"}).`);
    } finally {
      setRunning(false);
      setPhase(null);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    enrichAbortRef.current?.abort();
  }

  function stopEnrichment() {
    enrichAbortRef.current?.abort();
    setEnriching(false);
    setResults((prev) => prev.map((c) => (c.enrichment.state === "RUNNING" ? { ...c, enrichment: { ...c.enrichment, state: "PENDING" } } : c)));
  }

  async function enrichOne(company: UnifiedCompany) {
    if (!response) return;
    const target = { ...company, enrichment: { ...company.enrichment, state: "PENDING" as const } };
    setResults((prev) => prev.map((c) => (c.key === company.key ? { ...c, enrichment: { ...c.enrichment, state: "RUNNING" } } : c)));
    try {
      const res = await fetch("/api/discovery/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId: response.searchId, companies: [target] }),
      });
      const data = (await res.json()) as { companies?: UnifiedCompany[] };
      const updated = data.companies?.[0];
      if (updated) setResults((prev) => prev.map((c) => (c.key === updated.key ? updated : c)));
    } catch {
      toast.error("Falha ao enriquecer esta empresa.");
    }
  }

  function importSelected() {
    const chosen = results.filter((c) => selected.has(c.key));
    if (!chosen.length) return;
    startImport(async () => {
      const res = await importDiscoveryResultsAction(chosen, nicheOption?.industryId ?? null, response?.searchId ?? null);
      if (res.error) toast.error(res.error);
      else {
        const linked = new Map((res.linked ?? []).map((l) => [l.key, l.companyId]));
        setResults((prev) =>
          prev.map((c) => (linked.has(c.key) ? { ...c, companyId: linked.get(c.key)!, inPipeline: true, discoveryStatus: "EXISTING" } : c))
        );
        setSelected(new Set());
        toast.success(
          `${res.created ?? 0} nova(s) no pipeline (etapa “Novo”), ${res.updated ?? 0} já existente(s) complementada(s)${res.possibleDuplicates ? `, ${res.possibleDuplicates} marcada(s) como possível duplicata` : ""}.`,
          { action: { label: "Abrir pipeline", onClick: () => router.push("/pipeline") } }
        );
      }
    });
  }

  function exportCsv(rows: UnifiedCompany[]) {
    const csv = Papa.unparse(discoveryCsvRows(rows), { delimiter: ";" });
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discovery-${(response?.context.city ?? "busca").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveSearch() {
    if (!response?.searchId) return;
    const res = await saveSearchAction(response.searchId, saveName || `${nicheOption?.label ?? "Busca"} ${response.context.city}`);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Busca salva.");
      setSaveName("");
    }
  }

  const selectedCount = selected.size;
  const notEnriched = results.filter((c) => c.enrichment.state === "SKIPPED" || c.enrichment.state === "PENDING").length;

  // Search progress: sources that answered + elapsed vs. expected time.
  const expectedS = estimateSearchSeconds(history, depth);
  const elapsedS = startedAt ? (now - startedAt) / 1000 : 0;
  const sourcesDone = Object.keys(sourceProgress).length;
  const sourcesTotal = Math.max(1, enabledSources.size);
  const progressPct = Math.min(97, Math.max((sourcesDone / sourcesTotal) * 90, (elapsedS / expectedS) * 100));
  const remainingS = expectedS - elapsedS;
  const breadcrumb = useMemo(() => {
    if (!response) return [];
    const ctx = response.context;
    return [
      `${ctx.city}/${ctx.state}`,
      niches.find((n) => n.industryId === ctx.industryId || (!ctx.industryId && n.industryKey === ctx.industryKey))?.label ?? (ctx.keywords.join(", ") || "Todas as categorias"),
      { BROAD: "Modo amplo", BALANCED: "Modo balanceado", PRECISE: "Modo preciso" }[ctx.mode],
      ctx.radiusKm ? `Raio ${ctx.radiusKm} km` : "Limite do município",
    ];
  }, [response, niches]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar empresas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 md:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <Field label="Cidade" className="md:col-span-2">
              <CityAutocomplete
                value={city}
                state={state}
                onChange={setCity}
                onPick={(name, uf) => {
                  setCity(name);
                  setState(uf);
                }}
              />
            </Field>
            <Field label="UF">
              <StateAutocomplete value={state} onChange={setState} />
            </Field>
            <Field label="Nicho" className="md:col-span-2">
              <ChoiceSelect
                value={niche}
                onValueChange={setNiche}
                options={[{ value: "", label: "Somente palavras-chave" }, ...niches.map((n) => ({ value: n.value, label: n.label }))]}
              />
            </Field>
            <Field label="Meta de quantidade">
              <Input type="number" min={1} max={6000} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 500)} />
            </Field>
            <Field label="Palavras-chave extras (separe por vírgula)" className="md:col-span-3">
              <Input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="ex.: açaí, marmitaria" />
            </Field>
            <Field label="Modo">
              <ChoiceSelect
                value={mode}
                onValueChange={(v) => setMode(v as SearchContext["mode"])}
                options={[
                  { value: "BROAD", label: "Amplo — máximo de resultados (padrão)" },
                  { value: "BALANCED", label: "Balanceado" },
                  { value: "PRECISE", label: "Preciso — menos, mais qualidade" },
                ]}
              />
            </Field>
            <Field label="Profundidade">
              <ChoiceSelect
                value={depth}
                onValueChange={(v) => setDepth(v as SearchContext["depth"])}
                options={[
                  { value: "FAST", label: "Rápida — fontes primárias" },
                  { value: "BALANCED", label: "Balanceada (padrão)" },
                  { value: "DEEP", label: "Profunda — enriquecimento amplo" },
                ]}
              />
            </Field>
            <Field label="Raio (km, opcional)">
              <Input type="number" min={1} max={100} value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="limite do município" />
            </Field>

            <div className="space-y-2 md:col-span-6">
              <p className="text-xs text-muted-foreground">Fontes</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {sources.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm" title={s.label}>
                    <Checkbox
                      checked={enabledSources.has(s.key)}
                      disabled={!s.enabled}
                      onCheckedChange={(v) =>
                        setEnabledSources((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(s.key);
                          else next.delete(s.key);
                          return next;
                        })
                      }
                    />
                    <span>{s.label.split(" (")[0]}</span>
                    <HealthIndicator health={s.health} className="text-muted-foreground" />
                  </label>
                ))}
                <span className="text-xs text-muted-foreground">
                  Enriquecimento: CNPJ (BrasilAPI) + site oficial · Google Maps: validação ·{" "}
                  <Link href="/settings/sources" className="underline">
                    status das fontes
                  </Link>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:col-span-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={autoEnrich} onCheckedChange={(v) => setAutoEnrich(Boolean(v))} />
                Enriquecer automaticamente os primeiros
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={autoEnrichTop}
                  onChange={(e) => setAutoEnrichTop(Number(e.target.value) || 50)}
                  className="h-7 w-16"
                  disabled={!autoEnrich}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={includeRelatedCnaes} onCheckedChange={(v) => setIncludeRelatedCnaes(Boolean(v))} />
                Incluir CNAEs correlatos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={activeOnly} onCheckedChange={(v) => setActiveOnly(Boolean(v))} />
                Somente CNPJ ativo (empresas sem CNPJ continuam)
              </label>
              <div className="ml-auto flex gap-2">
                {running ? (
                  <Button type="button" variant="destructive" onClick={cancel}>
                    <Square className="size-3.5" /> Cancelar
                  </Button>
                ) : (
                  <>
                    {response && (
                      <Button type="button" variant="outline" onClick={() => void runSearch({}, "all")} title="Ignora o cache e consulta as fontes de novo">
                        <RefreshCw className="size-3.5" /> Refresh
                      </Button>
                    )}
                    <Button type="submit">
                      <Search className="size-3.5" /> Buscar empresas
                    </Button>
                  </>
                )}
              </div>
            </div>
          </form>

          {running && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Loader2 className="size-4 animate-spin" /> {phase}
                {liveCount && (
                  <span className="text-muted-foreground">
                    {liveCount.found} encontradas · {liveCount.unique} únicas
                  </span>
                )}
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {formatSeconds(elapsedS)} decorridos ·{" "}
                  {remainingS > 1
                    ? `~${formatSeconds(remainingS)} restantes`
                    : `finalizando (no máximo mais ${formatSeconds(Math.max(0, DEPTH_DEADLINE_S[depth] - elapsedS) + 2)})`}
                </span>
              </p>
              <Progress value={progressPct} />
              <p className="text-xs text-muted-foreground">
                {sourcesDone}/{enabledSources.size} fontes responderam · tempo típico nesta profundidade: ~{formatSeconds(expectedS)} (limite{" "}
                {DEPTH_DEADLINE_S[depth]}s)
              </p>
              <div className="flex flex-wrap gap-2">
                {[...enabledSources].map((key) => {
                  const p = sourceProgress[key];
                  const s = sources.find((x) => x.key === key);
                  return (
                    <span key={key} className="inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs">
                      {s?.shortLabel ?? key}
                      {p ? (
                        <>
                          <RunStatusBadge status={p.status} /> {p.returned} · {(p.durationMs / 1000).toFixed(1)}s{p.isFallback ? " · fallback" : ""}
                        </>
                      ) : (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {fatalError && !running && (
        <Card className="border-red-300">
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium text-red-700">{fatalError}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void runSearch()}>
                Tentar novamente
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/settings/sources">Ver status das fontes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {response && !running && (
        <>
          <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="Busca atual">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>›</span>}
                <span className={i === 0 ? "font-medium text-foreground" : undefined}>{b}</span>
              </span>
            ))}
            {response.fromCache && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">cache de {new Date(response.createdAt).toLocaleString("pt-BR")}</span>}
          </nav>

          <DiscoverySummary
            response={response}
            results={results}
            enrich={enrich}
            onSuggestion={(patch) => void runSearch(patch)}
            onRetry={() => void runSearch({}, "all")}
            onRefreshSource={(source) => response.searchId && void runSearch({}, { source, searchId: response.searchId })}
          />

          <p className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Encontrar uma empresa <strong>não</strong> a coloca no pipeline. Marque as que interessam e clique em{" "}
              <strong>Enviar para o pipeline</strong>: as novas entram na etapa “Novo”; as que já estão no banco são só complementadas (nada é
              sobrescrito). “no pipeline” = já está lá; “na base” = está no banco (ex.: importada da Receita) mas ainda não foi enviada.
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={importing || selectedCount === 0} onClick={importSelected}>
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Enviar para o pipeline {selectedCount ? `(${selectedCount})` : ""}
            </Button>
            {enriching ? (
              <Button size="sm" variant="outline" onClick={stopEnrichment}>
                <Square className="size-3.5" /> Parar enriquecimento
              </Button>
            ) : (
              notEnriched > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runEnrichment(response, results, true)}
                  title="Consulta CNPJ (Receita, com sócios) e site oficial de todas as empresas ainda não enriquecidas"
                >
                  <Wand2 className="size-3.5" /> Enriquecer todas as restantes ({notEnriched})
                </Button>
              )
            )}
            <Button size="sm" variant="outline" onClick={() => exportCsv(selectedCount ? results.filter((r) => selected.has(r.key)) : results)}>
              <Download className="size-3.5" /> Exportar CSV {selectedCount ? "(selecionadas)" : "(todas)"}
            </Button>
            {response.searchId && (
              <>
                <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Nome para salvar a busca" className="h-7 w-56" />
                <Button size="sm" variant="outline" onClick={() => void saveSearch()}>
                  <Save className="size-3.5" /> Salvar busca
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/admin/discovery/searches/${response.searchId}`}>Debug da busca</Link>
                </Button>
              </>
            )}
          </div>

          <DiscoveryResults
            results={results}
            limit={response.context.limit}
            selected={selected}
            onToggle={(key) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onSelectMany={(keys, value) =>
              setSelected((prev) => {
                const next = new Set(prev);
                for (const k of keys) {
                  if (value) next.add(k);
                  else next.delete(k);
                }
                return next;
              })
            }
            onEnrichOne={(c) => void enrichOne(c)}
          />
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <HistoryCard title="Buscas salvas" icon={<Star className="size-4" />} items={saved} empty="Nenhuma busca salva ainda." onRerun={(ctx) => void runSearch(ctx)} />
        <HistoryCard title="Histórico completo" icon={<History className="size-4" />} items={history} empty="Nenhuma busca realizada ainda." onRerun={(ctx) => void runSearch(ctx)} />
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function HistoryCard({
  title,
  icon,
  items,
  empty,
  onRerun,
}: {
  title: string;
  icon: React.ReactNode;
  items: HistoryItem[];
  empty: string;
  onRerun: (ctx: Partial<SearchContext>) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const f = foldText(q);
    return f ? items.filter((h) => foldText(`${h.name ?? ""} ${h.query_text ?? ""}`).includes(f)) : items;
  }, [items, q]);
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon} {title} <span className="font-normal text-muted-foreground">({items.length})</span>
        </CardTitle>
        {items.length > 5 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar histórico..." className="h-7" />}
      </CardHeader>
      <CardContent className="max-h-[28rem] space-y-2 overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
        {shown.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-2 border-b pb-2 text-xs last:border-0">
            <div className="min-w-0">
              <Link href={`/discovery?search=${h.id}`} className="block truncate font-medium hover:underline">
                {h.name ?? h.query_text ?? "Busca"}
              </Link>
              <p className="text-muted-foreground">
                {h.final_count} empresas · {h.outcome ?? h.status} · {h.duration_ms ? `${(h.duration_ms / 1000).toFixed(1)}s` : "—"} ·{" "}
                {new Date(h.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
            <Button size="xs" variant="outline" onClick={() => onRerun(h.context as Partial<SearchContext>)}>
              Repetir
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
