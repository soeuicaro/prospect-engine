/**
 * SearchContext validation/normalization + deterministic cache key (§63).
 */

import { z } from "zod";
import { foldText, normalizeLocation } from "./normalize";
import { DISCOVERY_SOURCE_KEYS } from "./registry";
import type { SearchContext, SourceKey } from "./types";

/** Hard ceiling on unique results one search returns (documented, shown in debug). */
export const SYSTEM_RESULT_LIMIT = 6000;

const sourceKeySchema = z.enum(["local_db", "osm_overpass", "osm_nominatim", "osm_photon", "cnpj_brasilapi", "website_discovery", "google_maps"]);

export const searchContextSchema = z.object({
  city: z.string().trim().min(2, "Informe a cidade").max(80),
  state: z.string().trim().max(40).optional().default(""),
  country: z.literal("BR").optional().default("BR"),
  radiusKm: z.coerce.number().min(1).max(100).nullable().optional().default(null),
  neighborhoods: z.array(z.string().trim().max(60)).max(20).optional().default([]),
  keywords: z.array(z.string().trim().min(2).max(60)).max(20).optional().default([]),
  industryKey: z.string().trim().max(60).nullable().optional().default(null),
  industryId: z.string().uuid().nullable().optional().default(null),
  cnaes: z.array(z.string().regex(/^\d{4}-\d\/\d{2}$/)).max(30).optional().default([]),
  includeRelatedCnaes: z.boolean().optional().default(false),
  companySize: z.array(z.string()).max(10).optional().default([]),
  cnpjStatus: z.array(z.enum(["ATIVA", "SUSPENSA", "INAPTA", "BAIXADA", "NULA"])).max(5).optional().default([]),
  limit: z.coerce.number().int().min(1).max(SYSTEM_RESULT_LIMIT).optional().default(100),
  page: z.coerce.number().int().min(1).optional().default(1),
  sort: z.enum(["relevance", "completeness", "name"]).optional().default("relevance"),
  sourcesEnabled: z.array(sourceKeySchema).optional().default(DISCOVERY_SOURCE_KEYS),
  mode: z.enum(["BROAD", "BALANCED", "PRECISE"]).optional().default("BALANCED"),
  depth: z.enum(["FAST", "BALANCED", "DEEP"]).optional().default("BALANCED"),
  autoEnrichTop: z.coerce.number().int().min(0).max(200).optional().default(20),
  expandKeywords: z.boolean().optional().default(true),
});

export class SearchValidationError extends Error {}

export function normalizeSearchContext(input: unknown): SearchContext {
  const parsed = searchContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new SearchValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const raw = parsed.data;
  const loc = normalizeLocation(raw.city, raw.state);
  if (!loc.state) throw new SearchValidationError("UF inválida — use a sigla (ex.: CE) ou o nome do estado.");
  return {
    ...raw,
    city: loc.city,
    state: loc.state,
    country: "BR",
    keywords: [...new Set(raw.keywords.map((k) => k.trim()).filter(Boolean))],
    sourcesEnabled: [...new Set(raw.sourcesEnabled.filter((s): s is SourceKey => DISCOVERY_SOURCE_KEYS.includes(s as SourceKey)))],
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Only the fields that change WHAT is searched — not limit/page/sort/enrichment. */
export function cacheKeyMaterial(ctx: SearchContext): Record<string, unknown> {
  const sorted = (xs: string[]) => [...xs].map((x) => x.toLowerCase()).sort();
  return {
    v: 2,
    city: foldText(ctx.city),
    state: ctx.state,
    radiusKm: ctx.radiusKm,
    neighborhoods: sorted(ctx.neighborhoods),
    industryKey: ctx.industryKey,
    industryId: ctx.industryId,
    keywords: sorted(ctx.keywords),
    cnaes: sorted(ctx.cnaes),
    includeRelatedCnaes: ctx.includeRelatedCnaes,
    cnpjStatus: sorted(ctx.cnpjStatus),
    mode: ctx.mode,
    depth: ctx.depth,
    expandKeywords: ctx.expandKeywords,
    sources: sorted(ctx.sourcesEnabled),
  };
}

export async function computeCacheKey(ctx: SearchContext): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(cacheKeyMaterial(ctx)));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
