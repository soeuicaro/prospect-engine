/**
 * Progressive enrichment (§42-45, §165-167). Runs AFTER discovery results
 * are on screen, in small batches the client requests (top-ranked first),
 * so the user never waits for it and resource use stays bounded.
 *
 * Order per company (§43): CNPJ registry → official website. Patches only
 * complement: an empty field is filled; a different value on a field that
 * already has one goes through the same priority rules as the merge and
 * the loser is kept as a conflict alternative — never silently replaced.
 */

import type { BreakerRegistry } from "./circuit-breaker";
import type { HttpDeps } from "./http";
import { CONFLICT_FIELDS, chooseValue, compareKey, refreshDerived } from "./merge";
import { normalizeSocial } from "./normalize";
import { DEFAULT_FIELD_PRIORITY, type FieldPriority, type SourceConfigMap } from "./registry";
import type { EnrichmentPatch, EnrichmentSource } from "./sources/base";
import { isFailedRun, type FieldValue, type MergeField, type RequestLog, type SocialMap, type UnifiedCompany } from "./types";

const PATCH_TO_FIELD: Partial<Record<keyof EnrichmentPatch["fields"], MergeField>> = {
  legalName: "legalName",
  street: "street",
  houseNumber: "houseNumber",
  neighborhood: "neighborhood",
  city: "city",
  state: "state",
  postcode: "postcode",
  phone: "phone",
  whatsapp: "whatsapp",
  email: "email",
  website: "website",
};

type Writable = "legalName" | "street" | "houseNumber" | "neighborhood" | "city" | "state" | "postcode" | "phone" | "whatsapp" | "email" | "website";

export function applyEnrichment(company: UnifiedCompany, patch: EnrichmentPatch, priority: FieldPriority = DEFAULT_FIELD_PRIORITY, now = Date.now()): UnifiedCompany {
  const collectedAt = new Date(now).toISOString();
  const confidence = patch.source === "cnpj_brasilapi" ? "HIGH" : patch.status === "SOURCE_SUCCESS_WITH_WARNINGS" ? "LOW" : "HIGH";

  const setField = (field: MergeField, prop: Writable, value: string | null | undefined) => {
    if (!value || !value.trim()) return;
    const incoming: FieldValue = { value: value.trim(), source: patch.source, confidence, collectedAt };
    const current = company.provenance[field];
    const currentValue = company[prop];
    if (!currentValue) {
      company[prop] = incoming.value;
      company.provenance[field] = incoming;
      return;
    }
    if (compareKey(field, currentValue) === compareKey(field, incoming.value)) return;
    const existing: FieldValue = current ?? { value: currentValue, source: company.sourceKeys[0], confidence: "MEDIUM", collectedAt };
    const winner = chooseValue(field, [existing, incoming], priority, now);
    const loser = winner === existing ? incoming : existing;
    company[prop] = winner.value;
    company.provenance[field] = winner;
    if (CONFLICT_FIELDS.includes(field)) {
      const conflict = company.conflicts.find((c) => c.field === field);
      if (conflict) {
        conflict.chosen = winner;
        if (!conflict.alternatives.some((a) => compareKey(field, a.value) === compareKey(field, loser.value))) conflict.alternatives.push(loser);
        conflict.alternatives = conflict.alternatives.filter((a) => compareKey(field, a.value) !== compareKey(field, winner.value));
      } else {
        company.conflicts.push({ field, chosen: winner, alternatives: [loser] });
      }
    }
  };

  for (const [key, field] of Object.entries(PATCH_TO_FIELD) as [Writable, MergeField][]) {
    setField(field, key, patch.fields[key] as string | null | undefined);
  }
  if (patch.fields.phone && !company.phones.includes(patch.fields.phone)) company.phones.push(patch.fields.phone);
  if (patch.fields.cnpjStatus && !company.cnpjStatus) company.cnpjStatus = patch.fields.cnpjStatus;
  if (patch.fields.cnpjStatus && patch.fields.cnpjStatus !== "ATIVA" && !company.warnings.some((w) => w.startsWith("Situação cadastral"))) {
    company.warnings.push(`Situação cadastral: ${patch.fields.cnpjStatus}`);
  }

  const socials: SocialMap = patch.fields.socials ?? {};
  for (const [net, url] of Object.entries(socials) as [keyof SocialMap, string][]) {
    const v = normalizeSocial(net, url);
    if (!v || company.socials[net]) continue;
    company.socials[net] = v;
    company.provenance[net] = { value: v, source: patch.source, confidence, collectedAt };
  }

  if (patch.partners?.length) {
    company.contacts = [
      ...(company.contacts ?? []),
      ...patch.partners
        .filter((p) => !(company.contacts ?? []).some((c) => c.name === p.name))
        .map((p) => ({ ...p, source: patch.source })),
    ];
    company.hasDecisionMaker = true;
  }
  if (patch.message && patch.status === "SOURCE_SUCCESS_WITH_WARNINGS") company.warnings.push(patch.message);
  if (!company.sourceKeys.includes(patch.source) && !isFailedRun(patch.status) && patch.status !== "NO_RESULTS_FROM_SOURCE") {
    company.sourceKeys.push(patch.source);
  }
  return refreshDerived(company);
}

export interface EnrichDeps {
  sources: EnrichmentSource[];
  configs: SourceConfigMap;
  breakers: BreakerRegistry;
  http?: HttpDeps;
  fieldPriority?: FieldPriority;
  signal?: AbortSignal;
  deadlineMs?: number;
  concurrency?: number;
}

export interface EnrichOutput {
  companies: UnifiedCompany[];
  patches: { key: string; source: string; status: string; message: string | null; durationMs: number }[];
  logs: RequestLog[];
}

export async function enrichCompanies(input: UnifiedCompany[], deps: EnrichDeps): Promise<EnrichOutput> {
  const deadline = Date.now() + (deps.deadlineMs ?? 25_000);
  const controller = new AbortController();
  deps.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  const companies = input.map((c) => structuredClone(c));
  const patches: EnrichOutput["patches"] = [];
  const logs: RequestLog[] = [];
  const priority = { ...DEFAULT_FIELD_PRIORITY, ...(deps.fieldPriority ?? {}) };
  const active = deps.sources.filter((s) => deps.configs[s.key]?.enabled);

  let cursor = 0;
  const worker = async () => {
    while (cursor < companies.length && !controller.signal.aborted) {
      const company = companies[cursor++];
      company.enrichment = { state: "RUNNING", sources: [] };
      let anyRan = false;
      let anyFailed = false;
      for (const source of active) {
        if (!source.appliesTo(company)) continue;
        if (!deps.breakers.canRequest(source.key)) {
          patches.push({ key: company.key, source: source.key, status: "SOURCE_CIRCUIT_OPEN", message: "Fonte pausada (circuit breaker)", durationMs: 0 });
          continue;
        }
        anyRan = true;
        const patch = await source.enrich(company, {
          signal: controller.signal,
          deadline,
          config: deps.configs[source.key],
          breakers: deps.breakers,
          http: deps.http ?? {},
          isFallback: false,
        });
        logs.push(...patch.logs);
        patches.push({ key: company.key, source: source.key, status: patch.status, message: patch.message, durationMs: patch.durationMs });
        if (isFailedRun(patch.status)) {
          anyFailed = true;
          deps.breakers.recordFailure(source.key, { latencyMs: patch.durationMs, error: patch.message ?? patch.status, kind: patch.status, status: patch.status });
        } else {
          deps.breakers.recordSuccess(source.key, { latencyMs: patch.durationMs, results: 1, status: patch.status });
          applyEnrichment(company, patch, priority);
        }
        company.enrichment.sources.push(source.key);
      }
      company.enrichment = {
        state: !anyRan ? "SKIPPED" : anyFailed && company.enrichment.sources.length <= 1 ? "FAILED" : "DONE",
        sources: company.enrichment.sources,
        message: !anyRan ? "Sem CNPJ nem website para enriquecer" : anyFailed ? "Uma fonte de enriquecimento falhou" : null,
      };
      refreshDerived(company);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 3) }, worker));
  } finally {
    clearTimeout(timer);
  }
  for (const c of companies) {
    if (c.enrichment.state === "RUNNING" || c.enrichment.state === "PENDING") {
      c.enrichment = { state: "FAILED", sources: c.enrichment.sources, message: "Tempo limite do lote de enriquecimento" };
    }
  }
  return { companies, patches, logs };
}
