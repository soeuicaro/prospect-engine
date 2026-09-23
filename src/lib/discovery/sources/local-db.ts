/**
 * Local database source: companies already in the workspace — including
 * the CNPJ base imported through tools/cnpj-importer, CSV imports, manual
 * entries and earlier OSM imports. Queried first and always (§61): we
 * never go to the internet for what we already hold.
 *
 * Joins are LEFT joins (PostgREST embeds without `!inner`): a company with
 * no sources/socials/contacts still comes back (§176-177). Missing
 * phone/website is never a filter here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { stripAccents } from "../normalize";
import type { SourceCompany, SourceRunResult } from "../types";
import { emptyMetadata, finalizeRun, type DiscoverySource, type SourceEnv, type SourceSearchInput } from "./base";

const LABEL = "Banco local";
const PAGE = 1000;

/** Only letters/digits/spaces survive — PostgREST or() syntax uses , ( ) . as operators. */
export function sanitizeForPostgrest(text: string): string {
  return text.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const CNAE_RE = /^\d{4}-\d\/\d{2}$/;

export function buildNicheOrFilter(opts: { industryId: string | null; cnaes: string[]; keywords: string[] }): string | null {
  const parts: string[] = [];
  if (opts.industryId && /^[0-9a-f-]{36}$/i.test(opts.industryId)) parts.push(`industry_id.eq.${opts.industryId}`);
  const cnaes = opts.cnaes.filter((c) => CNAE_RE.test(c));
  if (cnaes.length) {
    parts.push(`cnae_primary.in.(${cnaes.map((c) => `"${c}"`).join(",")})`);
    // Many businesses carry the niche as a SECONDARY activity (e.g. a bakery
    // that also runs a lanchonete) — the RFB base lists them all.
    parts.push(`cnae_secondary.ov.{${cnaes.map((c) => `"${c}"`).join(",")}}`);
  }
  for (const raw of opts.keywords.slice(0, 10)) {
    const kw = sanitizeForPostgrest(raw);
    if (kw.length < 3) continue;
    parts.push(`trade_name.ilike.*${kw}*`, `legal_name.ilike.*${kw}*`);
  }
  return parts.length ? parts.join(",") : null;
}

export function buildCityOrFilter(city: string): string {
  const variants = [...new Set([city, stripAccents(city)].map(sanitizeForPostgrest).filter(Boolean))];
  return variants.map((v) => `city.ilike.${v}`).join(",");
}

interface LocalRow {
  id: string;
  trade_name: string | null;
  legal_name: string | null;
  cnpj: string | null;
  cnpj_status: string | null;
  cnae_primary: string | null;
  cnae_secondary: string[] | null;
  industry_id: string | null;
  street: string | null;
  street_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  whatsapp: string | null;
  last_verified_at: string | null;
  updated_at: string;
  pipeline_stage_id: string | null;
  company_sources: { source_type: string; source_record_id: string | null }[] | null;
  company_social_profiles: { channel: string; handle_or_url: string | null; status: string }[] | null;
  company_contacts: { name: string | null; role: string | null; contact_type: string }[] | null;
}

const DECISION_MAKER_TYPES = ["SOCIO", "DECISOR_ESTIMADO", "RESPONSAVEL_CADASTRAL"];
const CONTACT_TYPE_ROLE: Record<string, string> = { SOCIO: "Sócio", DECISOR_ESTIMADO: "Decisor", RESPONSAVEL_CADASTRAL: "Responsável cadastral" };

export function localRowToCompany(row: LocalRow, matchedBy: SourceCompany["matchedBy"]): SourceCompany | null {
  const name = row.trade_name || row.legal_name;
  if (!name) return null;
  const origins = [...new Set((row.company_sources ?? []).map((s) => s.source_type))];
  const socials: SourceCompany["socials"] = {};
  for (const s of row.company_social_profiles ?? []) {
    if (s.status !== "FOUND" || !s.handle_or_url) continue;
    if (s.channel === "instagram" || s.channel === "facebook" || s.channel === "tiktok" || s.channel === "linkedin" || s.channel === "youtube") {
      socials[s.channel] = s.handle_or_url;
    }
  }
  const official = origins.some((o) => ["CNPJ", "MANUAL", "IMPORT_CSV", "IMPORT_XLSX"].includes(o)) || Boolean(row.cnpj);
  return {
    source: "local_db",
    sourceRecordId: row.id,
    sourceUrl: null,
    collectedAt: row.updated_at,
    verifiedAt: row.last_verified_at,
    companyId: row.id,
    inPipeline: Boolean(row.pipeline_stage_id),
    originSourceTypes: origins,
    linkedRecordIds: (row.company_sources ?? [])
      .filter((s) => s.source_type === "OSM" && s.source_record_id)
      // Pre-2.0 imports stored the bare numeric id and always linked /node/.
      .map((s) => `osm:${/^\d+$/.test(s.source_record_id!) ? `node/${s.source_record_id}` : s.source_record_id}`),
    name,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    cnpj: row.cnpj,
    cnpjStatus: row.cnpj_status,
    cnae: row.cnae_primary,
    street: row.street,
    houseNumber: row.street_number,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    postcode: row.postal_code,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    website: row.website,
    lat: row.latitude !== null ? Number(row.latitude) : null,
    lon: row.longitude !== null ? Number(row.longitude) : null,
    socials,
    hasDecisionMaker: (row.company_contacts ?? []).some((c) => DECISION_MAKER_TYPES.includes(c.contact_type)),
    contacts: (row.company_contacts ?? [])
      .filter((c) => c.name && DECISION_MAKER_TYPES.includes(c.contact_type))
      .map((c) => ({ name: c.name!, role: c.role ?? CONTACT_TYPE_ROLE[c.contact_type] ?? null })),
    matchedBy,
    confidence: official ? "HIGH" : "MEDIUM",
  };
}

export function createLocalDbSource(deps: { supabase: SupabaseClient<Database>; workspaceId: string }): DiscoverySource {
  return {
    key: "local_db",
    kind: "discovery",
    cost: "FREE",
    requiresLocation: false,
    capabilities: {
      canSearch: true,
      canEnrich: false,
      canGeocode: false,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: true,
      canReturnCoordinates: true,
      canReturnCnpj: true,
      canReturnSocials: true,
      supportsPagination: "range",
    },
    isConfigured: () => true,

    async search(input: SourceSearchInput, env: SourceEnv): Promise<SourceRunResult> {
      const startedAt = Date.now();
      const { context, expansion } = input;
      const metadata = emptyMetadata("local_db", env.config.maxResults);
      metadata.strategy = "city+niche";
      const everything = context.industryKey === "todas" && !context.keywords.length && !context.cnaes.length;
      const nicheFilter = everything ? null : buildNicheOrFilter({
        industryId: context.industryId,
        cnaes: expansion.cnaes,
        keywords: [...expansion.textTerms, ...expansion.nameKeywords],
      });
      const cityFilter = buildCityOrFilter(context.city);
      metadata.queries.push(`state=${context.state} & (${cityFilter})${nicheFilter ? ` & (${nicheFilter})` : ""}`);

      const results: SourceCompany[] = [];
      const errors: SourceRunResult["errors"] = [];
      let invalid = 0;
      let from = 0;

      while (results.length < env.config.maxResults) {
        if (env.signal.aborted) break;
        let query = deps.supabase
          .from("companies")
          .select(
            `id, trade_name, legal_name, cnpj, cnpj_status, cnae_primary, cnae_secondary, industry_id, street, street_number, neighborhood,
             city, state, postal_code, latitude, longitude, phone, email, website, whatsapp, last_verified_at, updated_at, pipeline_stage_id,
             company_sources(source_type, source_record_id), company_social_profiles(channel, handle_or_url, status),
             company_contacts(name, role, contact_type)`
          )
          .eq("workspace_id", deps.workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .eq("state", context.state)
          .or(cityFilter);
        if (nicheFilter) query = query.or(nicheFilter);
        const { data, error } = await query.order("created_at", { ascending: true }).range(from, from + PAGE - 1);
        metadata.pages += 1;
        if (error) {
          errors.push({ kind: "NETWORK", message: `Supabase: ${error.message}` });
          break;
        }
        const rows = (data ?? []) as unknown as LocalRow[];
        for (const row of rows) {
          const matchedBy: SourceCompany["matchedBy"] =
            context.industryId && row.industry_id === context.industryId
              ? "industry"
              : (row.cnae_primary && expansion.cnaes.includes(row.cnae_primary)) || (row.cnae_secondary ?? []).some((c) => expansion.cnaes.includes(c))
                ? "cnae"
                : "keyword";
          const company = localRowToCompany(row, nicheFilter ? matchedBy : "keyword");
          if (company) results.push(company);
          else invalid++;
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }

      metadata.invalid = invalid;
      metadata.invalidReasons = invalid ? { "sem nome fantasia nem razão social": invalid } : {};
      metadata.hasMore = results.length >= env.config.maxResults;
      metadata.sourceLimit = env.config.maxResults;
      return finalizeRun("local_db", LABEL, {
        results: results.slice(0, env.config.maxResults),
        metadata,
        errors,
        logs: [
          {
            source: "local_db",
            endpoint: "supabase:companies",
            query: metadata.queries[0] ?? "",
            httpStatus: errors.length ? null : 200,
            latencyMs: Date.now() - startedAt,
            attempt: 1,
            maxAttempts: 1,
            errorKind: errors.length ? "NETWORK" : null,
            errorMessage: errors[0]?.message ?? null,
            resultsCount: results.length,
            fallbackActivated: false,
            at: new Date(startedAt).toISOString(),
          },
        ],
        isFallback: env.isFallback,
        startedAt,
        coverage: `${context.city}/${context.state} no workspace`,
      });
    },
  };
}
