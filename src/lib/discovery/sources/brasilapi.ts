/**
 * CNPJ enrichment via BrasilAPI (public mirror of Receita Federal open
 * data). Enrichment only — BrasilAPI has no search-by-city/CNAE endpoint,
 * so CNPJ-based DISCOVERY comes from the imported base (local_db). Only
 * called for companies that already carry a CNPJ.
 */

import { normalizeCnpj } from "@/lib/domain/cnpj";
import { requestWithPolicy, jsonParser } from "../http";
import { throttleFor } from "../rate-limit";
import type { UnifiedCompany } from "../types";
import { errorEntry, statusFromErrorKind, type EnrichmentPatch, type EnrichmentSource, type SourceEnv } from "./base";

export const BRASILAPI_BASE = "https://brasilapi.com.br/api/cnpj/v1/";

interface BrasilApiCnpj {
  cnpj: string;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string | null;
  cnae_fiscal?: number | string | null;
  logradouro?: string | null;
  descricao_tipo_de_logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  ddd_telefone_1?: string | null;
  ddd_telefone_2?: string | null;
  email?: string | null;
  qsa?: { nome_socio?: string | null; qualificacao_socio?: string | null }[] | null;
}

export function formatCnae(raw: number | string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length !== 7) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
}

const STATUS = new Set(["ATIVA", "SUSPENSA", "INAPTA", "BAIXADA", "NULA"]);

export function brasilApiToPatch(data: BrasilApiCnpj): EnrichmentPatch["fields"] & { partners: { name: string; role: string | null }[] } {
  const status = (data.descricao_situacao_cadastral ?? "").toUpperCase();
  const street = [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(" ").trim() || null;
  const phone = (data.ddd_telefone_1 ?? "").replace(/\D/g, "") || (data.ddd_telefone_2 ?? "").replace(/\D/g, "") || null;
  return {
    legalName: data.razao_social ?? null,
    tradeName: data.nome_fantasia || null,
    cnpjStatus: STATUS.has(status) ? status : null,
    cnae: formatCnae(data.cnae_fiscal),
    street,
    houseNumber: data.numero && data.numero !== "S/N" ? data.numero : null,
    neighborhood: data.bairro ?? null,
    city: data.municipio ?? null,
    state: data.uf ?? null,
    postcode: data.cep ?? null,
    phone: phone && phone.length >= 10 ? phone : null,
    email: data.email ? data.email.toLowerCase() : null,
    partners: (data.qsa ?? [])
      .filter((p) => p.nome_socio)
      .slice(0, 10)
      .map((p) => ({ name: p.nome_socio!, role: p.qualificacao_socio ?? null })),
  };
}

export function createBrasilApiSource(): EnrichmentSource {
  return {
    key: "cnpj_brasilapi",
    kind: "enrichment",
    cost: "FREE",
    capabilities: {
      canSearch: false,
      canEnrich: true,
      canGeocode: false,
      canReturnPhone: true,
      canReturnWebsite: false,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: false,
      canReturnCnpj: true,
      canReturnSocials: false,
      supportsPagination: "none",
    },
    isConfigured: () => true,
    // Companies synced from the RFB base already carry razão social + situação.
    appliesTo: (c: UnifiedCompany) => Boolean(normalizeCnpj(c.cnpj)) && (!c.legalName || !c.cnpjStatus),

    async enrich(company: UnifiedCompany, env: SourceEnv): Promise<EnrichmentPatch> {
      const started = Date.now();
      const cnpj = normalizeCnpj(company.cnpj);
      if (!cnpj) {
        return { source: "cnpj_brasilapi", status: "NO_RESULTS_FROM_SOURCE", fields: {}, message: "Sem CNPJ", logs: [], durationMs: 0 };
      }
      try {
        const out = await requestWithPolicy<BrasilApiCnpj>(
          {
            source: "cnpj_brasilapi",
            url: `${BRASILAPI_BASE}${cnpj}`,
            queryForLog: `cnpj=${cnpj}`,
            timeoutMs: env.config.timeoutMs,
            retries: env.config.retryCount,
            signal: env.signal,
            deadline: env.deadline,
            throttle: throttleFor("brasilapi.com.br", env.config.rateLimitPerSec),
            parse: (text) => jsonParser<BrasilApiCnpj>(text),
            countResults: () => 1,
          },
          env.http
        );
        const { partners, ...fields } = brasilApiToPatch(out.data);
        return { source: "cnpj_brasilapi", status: "SOURCE_SUCCESS", fields, partners, message: null, logs: out.logs, durationMs: Date.now() - started };
      } catch (err) {
        const { entry, logs } = errorEntry(err);
        const notFound = entry.httpStatus === 404;
        return {
          source: "cnpj_brasilapi",
          status: notFound ? "NO_RESULTS_FROM_SOURCE" : statusFromErrorKind(entry.kind),
          fields: {},
          message: notFound ? "CNPJ não encontrado na BrasilAPI" : entry.message,
          logs,
          durationMs: Date.now() - started,
        };
      }
    },
  };
}
