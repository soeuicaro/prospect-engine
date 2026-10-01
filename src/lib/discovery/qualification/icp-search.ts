/**
 * Composite "ICP" niche: one search over every prioritized segment
 * ("potenciais compradores de produção audiovisual") instead of one niche.
 *
 * Query budget: only each segment's PRIMARY tags/terms/CNAEs (+ related OSM
 * tags/Overture categories outside PRECISE). Text sources already cap how
 * many terms they send (Nominatim 8, Photon 10); terms are ordered by the
 * ICP's priority so the most valuable segments are the ones sent.
 */

import { getIndustry, type IndustryDefinition } from "../industries";
import { overtureCategoriesFor } from "../overture-categories";
import type { SearchMode } from "../types";
import { ICP_INDUSTRY_KEY, type IcpConfig } from "./icp";

export interface IcpSearchPlan {
  industry: IndustryDefinition;
  overtureCategories: string[];
  segments: string[];
}

export function buildIcpSearch(icp: IcpConfig, mode: SearchMode): IcpSearchPlan {
  const segments = icp.searchSegments.filter((k) => getIndustry(k) && !icp.excluded.segments.includes(k));
  const defs = segments.map((k) => getIndustry(k)!);
  const uniq = <T,>(xs: T[], key: (x: T) => string = String) => {
    const seen = new Set<string>();
    return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
  };
  const tagKey = (t: { key: string; value: string }) => `${t.key}=${t.value}`;
  const industry: IndustryDefinition = {
    key: ICP_INDUSTRY_KEY,
    label: `ICP: ${icp.name}`,
    primaryKeywords: uniq(defs.map((d) => d.primaryKeywords[0]).filter(Boolean)),
    secondaryKeywords: [],
    synonyms: [],
    cnaes: { primary: uniq(defs.flatMap((d) => d.cnaes.primary)), related: [] },
    osmTags: {
      primary: uniq(defs.flatMap((d) => d.osmTags.primary), tagKey),
      related: mode === "PRECISE" ? [] : uniq(defs.flatMap((d) => d.osmTags.related), tagKey),
      broad: [],
    },
    nameKeywords: [],
  };
  const overtureCategories = uniq(segments.flatMap((k) => overtureCategoriesFor(k, mode === "BROAD" ? "BALANCED" : mode) ?? []));
  return { industry, overtureCategories, segments };
}
