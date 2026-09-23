/**
 * Overture Maps Places source: business places imported offline per city
 * by tools/places-importer/overture_sync.py into `places_pois` (open data,
 * CDLA-Permissive-2.0 — Meta business pages, Microsoft, Foursquare,
 * AllThePlaces). The free stand-in for a Google Maps listing: phone,
 * website, e-mail, socials, category and coordinates. No request leaves
 * the app at search time; a city that was never imported simply returns
 * NO_RESULTS with a hint on how to import it.
 *
 * Niche matching: Overture taxonomy categories (overture-categories.ts)
 * OR name contains one of the expansion's text terms.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { classifySocialUrl, normalizeSocial, normalizeWebsite } from "../normalize";
import { overtureCategoriesFor } from "../overture-categories";
import type { SocialMap, SourceCompany, SourceRunResult } from "../types";
import { emptyMetadata, finalizeRun, type DiscoverySource, type SourceEnv, type SourceSearchInput } from "./base";
import { buildCityOrFilter, sanitizeForPostgrest } from "./local-db";

const LABEL = "Overture Maps";
const PAGE = 1000;

export interface PoiRow {
  id: string;
  source_id: string;
  release: string | null;
  name: string;
  category: string | null;
  categories: string[] | null;
  confidence: number | null;
  phones: string[] | null;
  websites: string[] | null;
  emails: string[] | null;
  socials: string[] | null;
  street: string | null;
  postcode: string | null;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  imported_at: string;
}

/** "Rua X, 123" → street "Rua X", number "123". */
function splitStreet(freeform: string | null): { street: string | null; houseNumber: string | null } {
  if (!freeform) return { street: null, houseNumber: null };
  const m = /^(.*?),\s*(\d+[A-Za-z]?|s\/?n)\s*$/i.exec(freeform.trim());
  return m ? { street: m[1].trim(), houseNumber: m[2] } : { street: freeform.trim(), houseNumber: null };
}

/** "beauty_salon" → "Beauty salon" (UI label; the raw key stays in provenance). */
function categoryLabel(key: string | null): string | null {
  if (!key) return null;
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function poiRowToCompany(row: PoiRow, matchedBy: SourceCompany["matchedBy"]): SourceCompany {
  const socials: SocialMap = {};
  for (const url of row.socials ?? []) {
    const key = classifySocialUrl(url);
    if (key && !socials[key]) {
      const v = normalizeSocial(key, url);
      if (v) socials[key] = v;
    }
  }
  const website = (row.websites ?? []).map((w) => normalizeWebsite(w)).find(Boolean) ?? null;
  const phones = [...new Set(row.phones ?? [])];
  const { street, houseNumber } = splitStreet(row.street);
  const conf = row.confidence ?? 0;
  return {
    source: "places_overture",
    sourceRecordId: row.source_id,
    sourceUrl: null,
    collectedAt: row.imported_at,
    name: row.name,
    category: categoryLabel(row.category),
    street,
    houseNumber,
    city: row.city,
    state: row.state,
    postcode: row.postcode,
    phone: phones[0] ?? null,
    phones,
    email: row.emails?.[0] ?? null,
    website,
    lat: row.latitude,
    lon: row.longitude,
    socials,
    matchedBy,
    // Single aggregated record; corroboration by another source lifts it to HIGH in the merge.
    confidence: conf >= 0.6 ? "MEDIUM" : "LOW",
  };
}

export function createOvertureSource(deps: { supabase: SupabaseClient<Database>; workspaceId: string }): DiscoverySource {
  return {
    key: "places_overture",
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
      canReturnCnpj: false,
      canReturnSocials: true,
      supportsPagination: "range",
    },
    isConfigured: () => true,

    async search(input: SourceSearchInput, env: SourceEnv): Promise<SourceRunResult> {
      const startedAt = Date.now();
      const { context, expansion } = input;
      const metadata = emptyMetadata("places_overture", env.config.maxResults);
      metadata.strategy = "city+category";
      const everything = context.industryKey === "todas" && !context.keywords.length;
      const categories = everything ? null : overtureCategoriesFor(context.industryKey, context.mode);
      const terms = everything
        ? []
        : [...new Set([...expansion.textTerms, ...expansion.nameKeywords, ...context.keywords].map(sanitizeForPostgrest).filter((t) => t.length >= 3))].slice(0, 12);
      const nicheParts = [
        ...(categories?.length ? [`categories.ov.{${categories.map((c) => `"${c}"`).join(",")}}`] : []),
        ...terms.map((t) => `name.ilike.*${t}*`),
      ];
      const nicheFilter = nicheParts.length ? nicheParts.join(",") : null;
      const cityFilter = buildCityOrFilter(context.city);
      metadata.queries.push(`places_pois: state=${context.state} & (${cityFilter})${nicheFilter ? ` & (${nicheFilter})` : ""}`);

      const results: SourceCompany[] = [];
      const errors: SourceRunResult["errors"] = [];
      const warnings: string[] = [];
      let from = 0;
      while (results.length < env.config.maxResults) {
        if (env.signal.aborted) break;
        let query = deps.supabase
          .from("places_pois")
          .select("id, source_id, release, name, category, categories, confidence, phones, websites, emails, socials, street, postcode, city, state, latitude, longitude, imported_at")
          .eq("workspace_id", deps.workspaceId)
          .eq("state", context.state)
          .or(cityFilter);
        if (nicheFilter) query = query.or(nicheFilter);
        const { data, error } = await query.order("id").range(from, from + PAGE - 1);
        metadata.pages += 1;
        if (error) {
          // Migration 0012 not applied: behave as "no data" instead of failing the search.
          if (/places_pois/.test(error.message)) warnings.push("Tabela places_pois ausente — aplique a migration 0012.");
          else errors.push({ kind: "NETWORK", message: `Supabase: ${error.message}` });
          break;
        }
        const rows = (data ?? []) as PoiRow[];
        for (const row of rows) {
          const byCategory = Boolean(categories?.length && (row.categories ?? []).some((c) => categories.includes(c)));
          results.push(poiRowToCompany(row, nicheFilter ? (byCategory ? "tag" : "name_keyword") : "keyword"));
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      if (!results.length && !errors.length && from === 0) {
        const { count } = await deps.supabase
          .from("places_pois")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", deps.workspaceId)
          .eq("state", context.state)
          .or(cityFilter);
        if (!count) warnings.push(`${context.city}/${context.state} ainda não foi importada do Overture — rode: npm run places:sync -- --uf ${context.state} --municipio "${context.city}"`);
      }

      metadata.hasMore = results.length >= env.config.maxResults;
      metadata.sourceLimit = env.config.maxResults;
      return finalizeRun("places_overture", LABEL, {
        results: results.slice(0, env.config.maxResults),
        metadata,
        errors,
        warnings,
        logs: [
          {
            source: "places_overture",
            endpoint: "supabase:places_pois",
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
        coverage: `${context.city}/${context.state} (Overture importado)`,
      });
    },
  };
}
