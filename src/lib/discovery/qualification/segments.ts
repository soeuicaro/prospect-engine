/**
 * Segment resolution: which ICP segment (industry catalog key) a record
 * belongs to, and HOW we know it.
 *
 *   CONFIRMED — a source classified it: CNAE from the registry, an OSM tag,
 *               an Overture category.
 *   INFERRED  — only the business name suggests it ("Pizzaria X").
 *   UNKNOWN   — nothing matched; the ICP's `unknownSegment` rule applies.
 *
 * Also hosts the exclusion checks (public bodies, ATMs, excluded segments)
 * because they read the same taxonomy keys.
 */

import { INDUSTRY_CATALOG, type IndustryDefinition } from "../industries";
import { foldText, GENERIC_NAME_TOKENS } from "../normalize";
import { OVERTURE_CATEGORIES } from "../overture-categories";
import type { DataStatus, UnifiedCompany } from "../types";
import { compiledIcp, type IcpConfig, type SegmentRule, type SubsegmentRule } from "./icp";

interface IndexEntry {
  key: string;
  level: number; // 3 primary, 2 related, 1 broad
}

interface CatalogIndex {
  osm: Map<string, IndexEntry[]>;
  ovt: Map<string, IndexEntry[]>;
  cnae: Map<string, IndexEntry[]>;
  names: { key: string; fragment: string; re: RegExp }[];
}

let cachedIndex: CatalogIndex | null = null;

function push(map: Map<string, IndexEntry[]>, k: string, e: IndexEntry) {
  const list = map.get(k);
  if (list) list.push(e);
  else map.set(k, [e]);
}

function buildIndex(catalog: IndustryDefinition[]): CatalogIndex {
  const idx: CatalogIndex = { osm: new Map(), ovt: new Map(), cnae: new Map(), names: [] };
  for (const ind of catalog) {
    const levels: [IndustryDefinition["osmTags"][keyof IndustryDefinition["osmTags"]], number][] = [
      [ind.osmTags.primary, 3],
      [ind.osmTags.related, 2],
      [ind.osmTags.broad, 1],
    ];
    for (const [tags, level] of levels) for (const t of tags) if (t.value !== "*") push(idx.osm, `${t.key}=${t.value}`, { key: ind.key, level });
    for (const c of ind.cnaes.primary) push(idx.cnae, c, { key: ind.key, level: 3 });
    for (const c of ind.cnaes.related) push(idx.cnae, c, { key: ind.key, level: 1 });
    const ovt = OVERTURE_CATEGORIES[ind.key];
    if (ovt) {
      for (const c of ovt.primary) push(idx.ovt, c, { key: ind.key, level: 3 });
      for (const c of ovt.related) push(idx.ovt, c, { key: ind.key, level: 2 });
    }
    for (const kw of [...ind.nameKeywords, ...ind.primaryKeywords]) {
      const fragment = foldText(kw);
      if (fragment.length >= 4) idx.names.push({ key: ind.key, fragment, re: new RegExp(`(^| )${fragment}`) });
    }
  }
  // Longer fragments first: "estetica automotiva" must beat "estetica".
  idx.names.sort((a, b) => b.fragment.length - a.fragment.length);
  return idx;
}

function catalogIndex(): CatalogIndex {
  cachedIndex ??= buildIndex(INDUSTRY_CATALOG);
  return cachedIndex;
}

export interface SegmentMatch {
  segment: string | null;
  status: DataStatus;
  evidence: string | null;
  rule: Omit<SegmentRule, "subsegments">;
  label: string;
  subcategory: string | null;
  tags: string[];
}

type SegmentInput = Pick<UnifiedCompany, "name" | "category" | "cnae" | "categoryKeys" | "description">;

function osmKeyOf(raw: string): string {
  // "amenity=restaurant (pizza)" → "amenity=restaurant"
  return raw.replace(/\s*\(.*\)$/, "").trim();
}

function labelOf(key: string): string {
  return INDUSTRY_CATALOG.find((i) => i.key === key)?.label ?? key;
}

/** Text used by name/subsegment patterns — folded name + category + description. */
export function searchableText(c: Pick<UnifiedCompany, "name" | "category" | "description" | "legalName">): string {
  return foldText([c.name, c.legalName, c.category, c.description].filter(Boolean).join(" "));
}

/**
 * Resolve the segment. `searchIndustry` (the niche the user searched)
 * breaks ties — a pizzeria tagged amenity=fast_food in a "restaurantes"
 * search stays a restaurant lead.
 */
export function resolveSegment(c: SegmentInput, icp: IcpConfig, searchIndustry?: string | null): SegmentMatch {
  const idx = catalogIndex();
  const scores = new Map<string, { score: number; status: DataStatus; evidence: string }>();
  const consider = (key: string, score: number, status: DataStatus, evidence: string) => {
    const cur = scores.get(key);
    const s = score + (searchIndustry && key === searchIndustry ? 5 : 0);
    if (!cur || s > cur.score) scores.set(key, { score: s, status, evidence });
  };

  if (c.cnae) for (const e of idx.cnae.get(c.cnae) ?? []) consider(e.key, 30 + e.level * 3, "CONFIRMED", `CNAE ${c.cnae}`);
  for (const raw of c.categoryKeys ?? []) {
    if (raw.startsWith("osm:")) {
      const k = osmKeyOf(raw.slice(4));
      for (const e of idx.osm.get(k) ?? []) consider(e.key, 20 + e.level * 3, "CONFIRMED", `OSM ${k}`);
    } else if (raw.startsWith("ovt:")) {
      const k = raw.slice(4);
      for (const e of idx.ovt.get(k) ?? []) consider(e.key, 20 + e.level * 3, "CONFIRMED", `Overture ${k}`);
    }
  }
  // Older cached records have only the display category ("amenity=restaurant", "Beauty salon").
  if (!c.categoryKeys?.length && c.category) {
    const k = osmKeyOf(c.category);
    for (const e of idx.osm.get(k) ?? []) consider(e.key, 20 + e.level * 3, "CONFIRMED", `OSM ${k}`);
    const ovtKey = c.category.toLowerCase().replace(/\s+/g, "_");
    for (const e of idx.ovt.get(ovtKey) ?? []) consider(e.key, 20 + e.level * 3, "CONFIRMED", `Overture ${ovtKey}`);
  }
  const name = foldText(c.name);
  if (name) {
    for (const n of idx.names) {
      if (n.re.test(name)) {
        consider(n.key, 10, "INFERRED", `nome contém "${n.fragment}"`);
        break;
      }
    }
  }

  const best = [...scores.entries()].sort((a, b) => b[1].score - a[1].score)[0];
  if (!best) {
    return { segment: null, status: "UNKNOWN", evidence: null, rule: icp.unknownSegment, label: icp.unknownSegment.label ?? "Não identificado", subcategory: null, tags: [] };
  }
  const [key, info] = best;
  const base = icp.segments[key] ?? { ...icp.unknownSegment, tags: [] };
  const sub = pickSubsegment(base, searchableText({ name: c.name, category: c.category, description: c.description, legalName: null }), icp);
  const rule = {
    label: base.label,
    fit: sub?.fit ?? base.fit,
    visualNeed: sub?.visualNeed ?? base.visualNeed,
    ticket: sub?.ticket ?? base.ticket,
    recurring: base.recurring,
    tags: [...new Set([...base.tags, ...(sub?.tags ?? [])])],
    pitch: base.pitch,
  };
  return {
    segment: key,
    status: info.status,
    evidence: info.evidence,
    rule,
    label: base.label ?? labelOf(key),
    subcategory: sub?.label ?? null,
    tags: rule.tags,
  };
}

function pickSubsegment(rule: SegmentRule, text: string, icp: IcpConfig): SubsegmentRule | null {
  if (!rule.subsegments?.length || !text) return null;
  const { sub } = compiledIcp(icp);
  return rule.subsegments.find((s) => (sub.get(s) ?? []).some((re) => re.test(text))) ?? null;
}

// ---------------------------------------------------------------------------
// Exclusions / junk
// ---------------------------------------------------------------------------

export function exclusionReason(c: SegmentInput, icp: IcpConfig, segment: string | null): string | null {
  if (segment && icp.excluded.segments.includes(segment)) return `segmento excluído no ICP (${labelOf(segment)})`;
  const osmExcl = new Set(icp.excluded.osmTags);
  const ovtExcl = new Set(icp.excluded.overtureCategories);
  const keys = c.categoryKeys?.length ? c.categoryKeys : c.category ? [`osm:${c.category}`] : [];
  for (const raw of keys) {
    if (raw.startsWith("osm:")) {
      const k = osmKeyOf(raw.slice(4));
      const wildcard = `${k.split("=")[0]}=*`;
      if (osmExcl.has(k) || osmExcl.has(wildcard)) return `categoria excluída (OSM ${k})`;
    } else if (raw.startsWith("ovt:") && ovtExcl.has(raw.slice(4))) {
      return `categoria excluída (Overture ${raw.slice(4)})`;
    }
  }
  if (c.cnae) {
    const digits = c.cnae.replace(/\D/g, "");
    const prefix = icp.excluded.cnaePrefixes.find((p) => digits.startsWith(p));
    if (prefix) return `CNAE ${c.cnae} excluído (prefixo ${prefix})`;
  }
  const name = foldText(c.name);
  const hit = compiledIcp(icp).names.find((re) => re.test(name));
  if (hit) return `nome indica órgão público/serviço sem potencial comercial (${hit.source})`;
  return null;
}

const NAME_STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "the", "and", "&"]);
const JUNK_NAME = /^(sem nome|nome|desconhecido|unknown|teste?|test|xxx+|n\/?a|null|undefined)$/;

/** "Restaurante", "Bar", "Lanchonete", "123", "Sem nome" — not an identifiable business. */
export function isGenericName(name: string | null | undefined): boolean {
  const n = foldText(name);
  if (!n || n.length < 3 || /^\d+$/.test(n.replace(/\s/g, "")) || JUNK_NAME.test(n)) return true;
  const tokens = n.split(" ").filter((t) => !NAME_STOPWORDS.has(t));
  return tokens.length > 0 && tokens.length <= 2 && tokens.every((t) => GENERIC_NAME_TOKENS.has(t));
}
