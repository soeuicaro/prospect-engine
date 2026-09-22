import { Badge } from "@/components/ui/badge";
import { sourceLabel } from "@/lib/discovery/registry";
import type { CompletenessLabel, Confidence, HealthStatus, QualityLabel, SourceKey, SourceRunStatus } from "@/lib/discovery/types";
import { cn } from "@/lib/utils";

const SOURCE_STYLE: Partial<Record<SourceKey, string>> = {
  local_db: "border-sky-300 text-sky-700 dark:text-sky-300",
  osm_overpass: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  osm_nominatim: "border-teal-300 text-teal-700 dark:text-teal-300",
  osm_photon: "border-lime-300 text-lime-700 dark:text-lime-300",
  cnpj_brasilapi: "border-indigo-300 text-indigo-700 dark:text-indigo-300",
  website_discovery: "border-fuchsia-300 text-fuchsia-700 dark:text-fuchsia-300",
};

export function SourceBadges({ sources, className }: { sources: SourceKey[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {sources.map((s) => (
        <Badge key={s} variant="outline" className={cn("px-1.5 py-0 text-[10px] font-semibold", SOURCE_STYLE[s])}>
          {sourceLabel(s)}
        </Badge>
      ))}
    </div>
  );
}

const COMPLETENESS: Record<CompletenessLabel, { dot: string; label: string }> = {
  COMPLETO: { dot: "bg-emerald-500", label: "Completo" },
  PARCIAL: { dot: "bg-amber-400", label: "Parcial" },
  FRACO: { dot: "bg-red-500", label: "Fraco" },
};

export function CompletenessBadge({ label, score }: { label: CompletenessLabel; score: number }) {
  const c = COMPLETENESS[label];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={`Completude dos dados: ${score}%`}>
      <span className={cn("size-2 rounded-full", c.dot)} aria-hidden />
      {c.label} <span className="text-muted-foreground">{score}%</span>
    </span>
  );
}

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  const style = confidence === "HIGH" ? "text-emerald-700 dark:text-emerald-300" : confidence === "MEDIUM" ? "text-amber-700 dark:text-amber-300" : "text-zinc-500";
  const label = confidence === "HIGH" ? "Alta" : confidence === "MEDIUM" ? "Média" : "Baixa";
  return <span className={cn("text-xs font-medium", style)}>{label}</span>;
}

export function QualityBadge({ label }: { label: QualityLabel }) {
  if (label === "COMPLETE") return <Badge variant="outline" className="border-emerald-300 px-1.5 py-0 text-[10px] text-emerald-700">COMPLETE</Badge>;
  if (label === "NEEDS_REVIEW") return <Badge variant="outline" className="border-amber-300 px-1.5 py-0 text-[10px] text-amber-700">NEEDS_REVIEW</Badge>;
  return <Badge variant="outline" className="px-1.5 py-0 text-[10px]">PARTIAL</Badge>;
}

const HEALTH: Record<HealthStatus, { dot: string; label: string }> = {
  HEALTHY: { dot: "bg-emerald-500", label: "Healthy" },
  DEGRADED: { dot: "bg-amber-400", label: "Degraded" },
  DOWN: { dot: "bg-red-500", label: "Down" },
  DISABLED: { dot: "bg-zinc-400", label: "Disabled" },
  NOT_CONFIGURED: { dot: "bg-zinc-300", label: "Not configured" },
};

export function HealthIndicator({ health, className }: { health: HealthStatus; className?: string }) {
  const h = HEALTH[health];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <span className={cn("size-2 rounded-full", h.dot)} aria-hidden />
      {h.label}
    </span>
  );
}

const RUN_LABEL: Record<SourceRunStatus, string> = {
  SOURCE_SUCCESS: "OK",
  SOURCE_SUCCESS_WITH_WARNINGS: "OK c/ avisos",
  SOURCE_PARTIAL_RESULTS: "Parcial",
  NO_RESULTS_FROM_SOURCE: "Sem resultados",
  SOURCE_ERROR: "Erro",
  SOURCE_TIMEOUT: "Timeout",
  SOURCE_RATE_LIMITED: "Rate limited",
  SOURCE_BLOCKED: "Bloqueada",
  SOURCE_NOT_CONFIGURED: "Não configurada",
  SOURCE_DISABLED: "Desativada",
  SOURCE_CIRCUIT_OPEN: "Pausada (breaker)",
};

export function RunStatusBadge({ status }: { status: SourceRunStatus }) {
  const bad = /ERROR|TIMEOUT|RATE_LIMITED|BLOCKED|CIRCUIT/.test(status);
  const warn = status === "SOURCE_PARTIAL_RESULTS" || status === "SOURCE_SUCCESS_WITH_WARNINGS" || status === "NO_RESULTS_FROM_SOURCE";
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-[10px]",
        bad ? "border-red-300 text-red-700" : warn ? "border-amber-300 text-amber-700" : "border-emerald-300 text-emerald-700"
      )}
    >
      {RUN_LABEL[status] ?? status}
    </Badge>
  );
}
