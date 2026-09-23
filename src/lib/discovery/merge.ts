/**
 * Data Merging Engine: Array<SourceCompany> → Array<UnifiedCompany>.
 *
 * 1. Identity keys (EXACT): same OSM element across Overpass/Nominatim/
 *    Photon, a local company already linked to that element, same CNPJ.
 * 2. Candidate pairs by blocking (CNPJ, domain, phone, significant name
 *    token, ~200m geo cell) — never "name only".
 * 3. Pair confidence EXACT/HIGH/MEDIUM/LOW. Only EXACT and HIGH auto-merge;
 *    MEDIUM/LOW become `possibleDuplicates` for the user to review.
 * 4. Guards against false positives: different CNPJs or different cities
 *    never merge (§75), also transitively (cluster-level check).
 * 5. Field-level merge: every value is kept with its provenance; the
 *    chosen one follows source priority → confidence → recency; distinct
 *    values on contact/identity fields are surfaced as conflicts (§16).
 *    Merge only complements — nothing a member had is dropped (§21).
 */

import { normalizeCnpj } from "@/lib/domain/cnpj";
import { computeCompleteness, completenessLabel, confidenceWeight, rankScore } from "./completeness";
import {
  foldText,
  haversineMeters,
  nameSimilarity,
  normalizeBusinessName,
  phoneKey,
  significantTokens,
  websiteDomain,
} from "./normalize";
import { DEFAULT_FIELD_PRIORITY, type FieldPriority } from "./registry";
import type {
  Confidence,
  DuplicateConfidence,
  FieldConflict,
  FieldValue,
  MergeField,
  PossibleDuplicate,
  SocialMap,
  SourceCompany,
  SourceKey,
  UnifiedCompany,
} from "./types";

const OSM_SOURCES: SourceKey[] = ["osm_overpass", "osm_nominatim", "osm_photon"];

interface Prepared {
  idx: number;
  rec: SourceCompany;
  name: string;
  tokens: string[];
  cnpj: string | null;
  domain: string | null;
  phones: string[];
  city: string;
  street: string;
  identity: string[];
}

export interface PairEvaluation {
  confidence: DuplicateConfidence | null;
  reasons: string[];
}

function prepare(rec: SourceCompany, idx: number, targetCity: string | null, stop: Set<string>): Prepared {
  const name = normalizeBusinessName(rec.tradeName || rec.name, rec.city ?? targetCity);
  const identity: string[] = [`src:${rec.source}:${rec.sourceRecordId}`];
  if (OSM_SOURCES.includes(rec.source)) identity.push(`osm:${rec.sourceRecordId}`);
  if (rec.companyId) identity.push(`db:${rec.companyId}`);
  for (const l of rec.linkedRecordIds ?? []) identity.push(l);
  const phones = [rec.phone, ...(rec.phones ?? []), rec.whatsapp].map(phoneKey).filter((p): p is string => Boolean(p));
  return {
    idx,
    rec,
    name,
    tokens: significantTokens(name, stop),
    cnpj: normalizeCnpj(rec.cnpj),
    domain: websiteDomain(rec.website),
    phones: [...new Set(phones)],
    city: foldText(rec.city),
    street: foldText(rec.street),
    identity,
  };
}

/** Pairwise duplicate evaluation. Exported for tests and the review UI. */
export function evaluatePair(a: Prepared, b: Prepared): PairEvaluation {
  if (a.identity.some((k) => b.identity.includes(k))) return { confidence: "EXACT", reasons: ["mesmo registro de origem"] };
  if (a.cnpj && b.cnpj) {
    return a.cnpj === b.cnpj ? { confidence: "EXACT", reasons: ["CNPJ idêntico"] } : { confidence: null, reasons: ["CNPJs diferentes"] };
  }
  if (!citiesCompatible(a.city, b.city)) return { confidence: null, reasons: ["cidades diferentes"] };

  const sim = nameSimilarity(a.name, b.name);
  const tokenOverlap = a.tokens.some((t) => b.tokens.includes(t));
  const dist =
    a.rec.lat != null && a.rec.lon != null && b.rec.lat != null && b.rec.lon != null
      ? haversineMeters({ lat: a.rec.lat, lon: a.rec.lon }, { lat: b.rec.lat, lon: b.rec.lon })
      : null;
  const sameStreet = Boolean(a.street && b.street && a.street === b.street);
  const reasons: string[] = [];

  if (a.domain && b.domain && a.domain === b.domain) {
    reasons.push(`domínio ${a.domain}`);
    return { confidence: sim >= 0.3 || tokenOverlap ? "HIGH" : "MEDIUM", reasons };
  }
  const sharedPhone = a.phones.find((p) => b.phones.includes(p));
  if (sharedPhone) {
    reasons.push("telefone idêntico");
    // A shared phone alone can be an accountant's number on CNPJ records.
    return { confidence: sim >= 0.35 || tokenOverlap ? "HIGH" : "MEDIUM", reasons };
  }
  if (a.name && a.name === b.name && a.tokens.length > 0) {
    reasons.push("nome normalizado idêntico");
    if (dist !== null && dist > 1500) return { confidence: "LOW", reasons: [...reasons, `distância ${Math.round(dist)}m`] };
    if (sameStreet) reasons.push("mesmo logradouro");
    if (dist !== null) reasons.push(`distância ${Math.round(dist)}m`);
    else reasons.push("mesma cidade");
    return { confidence: "HIGH", reasons };
  }
  if (!tokenOverlap) return { confidence: null, reasons: [] };
  // Fuzzy auto-merge only when the names differ by generic words/spelling —
  // never by a distinguishing word or a number ("Farmácia X 1" vs "X 2",
  // "Lanches Dona Maria" vs "Lanches Dona Ana").
  const numbersA = a.name.match(/\d+/g)?.join(",") ?? "";
  const numbersB = b.name.match(/\d+/g)?.join(",") ?? "";
  const sameTokenSet = a.tokens.length === b.tokens.length && a.tokens.every((t) => b.tokens.includes(t)) && numbersA === numbersB;
  if (numbersA !== numbersB) return { confidence: "LOW", reasons: [`nome ${Math.round(sim * 100)}% similar, números diferentes`] };
  if (sameTokenSet && sim >= 0.8 && ((dist !== null && dist <= 150) || sameStreet)) {
    return { confidence: "HIGH", reasons: [`nome ${Math.round(sim * 100)}% similar`, dist !== null ? `distância ${Math.round(dist)}m` : "mesmo logradouro"] };
  }
  if (sim >= 0.6 && ((dist !== null && dist <= 300) || sameStreet)) {
    return { confidence: "MEDIUM", reasons: [`nome ${Math.round(sim * 100)}% similar`, dist !== null ? `distância ${Math.round(dist)}m` : "mesmo logradouro"] };
  }
  if (sim >= 0.7) return { confidence: "LOW", reasons: [`nome ${Math.round(sim * 100)}% similar`] };
  return { confidence: null, reasons: [] };
}

/** "sobral" vs "municipio de sobral" are compatible; "sobral" vs "fortaleza" are not. */
export function citiesCompatible(a: string, b: string): boolean {
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

class Clusters {
  parent: number[];
  cnpjs: Map<number, Set<string>>;
  cities: Map<number, Set<string>>;
  weakest: Map<number, DuplicateConfidence | null>;

  constructor(items: Prepared[]) {
    this.parent = items.map((_, i) => i);
    this.cnpjs = new Map(items.map((p, i) => [i, new Set(p.cnpj ? [p.cnpj] : [])]));
    this.cities = new Map(items.map((p, i) => [i, new Set(p.city ? [p.city] : [])]));
    this.weakest = new Map(items.map((_, i) => [i, null]));
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  /** Union unless it would put two different CNPJs / cities in one cluster. */
  union(a: number, b: number, confidence: DuplicateConfidence, sameRecord = false): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return true;
    const cnpjs = new Set([...this.cnpjs.get(ra)!, ...this.cnpjs.get(rb)!]);
    const cities = new Set([...this.cities.get(ra)!, ...this.cities.get(rb)!]);
    if (cnpjs.size > 1) return false;
    // The same source record seen twice is the same place regardless of how its city was spelled.
    if (!sameRecord) {
      const list = [...cities];
      if (list.some((x) => list.some((y) => !citiesCompatible(x, y)))) return false;
    }
    this.parent[rb] = ra;
    this.cnpjs.set(ra, cnpjs);
    this.cities.set(ra, cities);
    const rank: Record<DuplicateConfidence, number> = { EXACT: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
    const current = [this.weakest.get(ra), this.weakest.get(rb), confidence].filter((c): c is DuplicateConfidence => Boolean(c));
    this.weakest.set(ra, current.sort((x, y) => rank[x] - rank[y])[0] ?? confidence);
    return true;
  }
}

function candidatePairs(items: Prepared[]): [number, number][] {
  const blocks = new Map<string, number[]>();
  const add = (key: string, i: number) => {
    const list = blocks.get(key);
    if (list) list.push(i);
    else blocks.set(key, [i]);
  };
  for (const p of items) {
    for (const k of p.identity) add(`id:${k}`, p.idx);
    if (p.cnpj) add(`cnpj:${p.cnpj}`, p.idx);
    if (p.domain) add(`dom:${p.domain}`, p.idx);
    for (const ph of p.phones) add(`ph:${ph}`, p.idx);
    for (const t of p.tokens) add(`tok:${t}`, p.idx);
    if (p.rec.lat != null && p.rec.lon != null) {
      add(`geo:${Math.round(p.rec.lat / 0.002)}:${Math.round(p.rec.lon / 0.002)}:${p.name.charAt(0)}`, p.idx);
    }
  }
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (const list of blocks.values()) {
    if (list.length < 2 || list.length > 400) continue; // an over-common token is not a signal
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i], list[j]);
        const b = Math.max(list[i], list[j]);
        const key = `${a}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Field-level merge
// ---------------------------------------------------------------------------

const FIELD_GROUP: Record<MergeField, keyof typeof DEFAULT_FIELD_PRIORITY> = {
  name: "identity",
  legalName: "identity",
  cnpj: "identity",
  category: "identity",
  street: "address",
  houseNumber: "address",
  neighborhood: "address",
  city: "address",
  state: "address",
  postcode: "address",
  phone: "phone",
  whatsapp: "phone",
  email: "email",
  website: "website",
  coordinates: "coordinates",
  instagram: "social",
  facebook: "social",
  tiktok: "social",
  linkedin: "social",
  youtube: "social",
};

/** Fields where two different values mean "conflicting data" (§16). */
export const CONFLICT_FIELDS: MergeField[] = ["cnpj", "phone", "email", "website", "street", "houseNumber", "postcode", "instagram"];

export function compareKey(field: MergeField, value: string): string {
  switch (field) {
    case "phone":
    case "whatsapp":
      return phoneKey(value) ?? value.replace(/\D/g, "");
    case "cnpj":
      return normalizeCnpj(value) ?? value;
    case "website":
      return websiteDomain(value) ?? foldText(value);
    case "email":
      return value.trim().toLowerCase();
    default:
      return foldText(value);
  }
}

function recencyBonus(v: FieldValue, now: number): number {
  const at = Date.parse(v.verifiedAt ?? v.collectedAt);
  if (!Number.isFinite(at)) return 0;
  const days = (now - at) / 86_400_000;
  if (days <= 30) return 2;
  if (days <= 180) return 1;
  if (days > 365) return -2;
  return 0;
}

export function chooseValue(field: MergeField, values: FieldValue[], priority: FieldPriority, now: number): FieldValue {
  const order = priority[FIELD_GROUP[field]] ?? DEFAULT_FIELD_PRIORITY[FIELD_GROUP[field]];
  const score = (v: FieldValue) => {
    const idx = order.indexOf(v.source);
    const prio = idx === -1 ? 0 : (order.length - idx) * 10;
    return prio + confidenceWeight(v.confidence) * 3 + recencyBonus(v, now);
  };
  return [...values].sort((a, b) => score(b) - score(a))[0];
}

function fieldValuesOf(rec: SourceCompany): Partial<Record<MergeField, string>> {
  const out: Partial<Record<MergeField, string>> = {
    name: rec.tradeName || rec.name,
    legalName: rec.legalName ?? undefined,
    cnpj: rec.cnpj ?? undefined,
    category: rec.category ?? undefined,
    street: rec.street ?? undefined,
    houseNumber: rec.houseNumber ?? undefined,
    neighborhood: rec.neighborhood ?? undefined,
    city: rec.city ?? undefined,
    state: rec.state ?? undefined,
    postcode: rec.postcode ?? undefined,
    phone: rec.phone ?? undefined,
    whatsapp: rec.whatsapp ?? undefined,
    email: rec.email ?? undefined,
    website: rec.website ?? undefined,
    coordinates: rec.lat != null && rec.lon != null ? `${rec.lat},${rec.lon}` : undefined,
  };
  for (const [k, v] of Object.entries(rec.socials ?? {})) if (v) out[k as MergeField] = v;
  return out;
}

export interface MergeOptions {
  targetCity?: string | null;
  fieldPriority?: FieldPriority;
  now?: number;
}

export interface MergeResult {
  companies: UnifiedCompany[];
  duplicateRecords: number;
  perSource: Partial<Record<SourceKey, { members: number; primary: number }>>;
  clusterOf: Map<number, string>; // record index → unified key
}

const SOURCE_ORDER: SourceKey[] = ["local_db", "places_overture", "osm_overpass", "osm_nominatim", "osm_photon", "cnpj_brasilapi", "website_discovery"];

export function mergeSourceCompanies(records: SourceCompany[], opts: MergeOptions = {}): MergeResult {
  const now = opts.now ?? Date.now();
  const priority = { ...DEFAULT_FIELD_PRIORITY, ...(opts.fieldPriority ?? {}) };
  const stop = new Set(foldText(opts.targetCity ?? "").split(" ").filter(Boolean));
  const items = records.map((r, i) => prepare(r, i, opts.targetCity ?? null, stop));
  const clusters = new Clusters(items);

  const evaluated = candidatePairs(items).map(([a, b]) => ({ a, b, ev: evaluatePair(items[a], items[b]) }));
  const rank = (c: DuplicateConfidence | null) => (c === "EXACT" ? 3 : c === "HIGH" ? 2 : c === "MEDIUM" ? 1 : c === "LOW" ? 0 : -1);
  evaluated.sort((x, y) => rank(y.ev.confidence) - rank(x.ev.confidence));

  const weakPairs: { a: number; b: number; confidence: DuplicateConfidence; reasons: string[] }[] = [];
  for (const { a, b, ev } of evaluated) {
    if (!ev.confidence) continue;
    if (ev.confidence === "EXACT" || ev.confidence === "HIGH") {
      const sameRecord = items[a].identity.some((k) => items[b].identity.includes(k));
      if (!clusters.union(a, b, ev.confidence, sameRecord)) weakPairs.push({ a, b, confidence: "MEDIUM", reasons: [...ev.reasons, "merge bloqueado (CNPJ/cidade divergentes no grupo)"] });
    } else {
      weakPairs.push({ a, b, confidence: ev.confidence, reasons: ev.reasons });
    }
  }

  const groups = new Map<number, Prepared[]>();
  for (const p of items) {
    const root = clusters.find(p.idx);
    const list = groups.get(root);
    if (list) list.push(p);
    else groups.set(root, [p]);
  }

  const companies: UnifiedCompany[] = [];
  const keyByRoot = new Map<number, string>();
  const perSource: MergeResult["perSource"] = {};
  const clusterOf = new Map<number, string>();
  let duplicateRecords = 0;

  for (const [root, members] of groups) {
    members.sort((x, y) => SOURCE_ORDER.indexOf(x.rec.source) - SOURCE_ORDER.indexOf(y.rec.source));
    const unified = buildUnified(members, priority, now, clusters.weakest.get(root) ?? null);
    keyByRoot.set(root, unified.key);
    for (const m of members) clusterOf.set(m.idx, unified.key);
    duplicateRecords += members.length - 1;
    const primarySource = members[0].rec.source;
    const seenInCluster = new Set<SourceKey>();
    for (const m of members) {
      const s = (perSource[m.rec.source] ??= { members: 0, primary: 0 });
      s.members += 1;
      if (!seenInCluster.has(m.rec.source) && m.rec.source === primarySource) s.primary += 1;
      seenInCluster.add(m.rec.source);
    }
    companies.push(unified);
  }

  // Attach possible duplicates (cluster ↔ cluster) for review.
  const byKey = new Map(companies.map((c) => [c.key, c]));
  for (const w of weakPairs) {
    const ka = keyByRoot.get(clusters.find(w.a))!;
    const kb = keyByRoot.get(clusters.find(w.b))!;
    if (ka === kb) continue;
    const ca = byKey.get(ka)!;
    const cb = byKey.get(kb)!;
    if (!ca.possibleDuplicates.some((d) => d.key === kb)) ca.possibleDuplicates.push({ key: kb, name: cb.name, confidence: w.confidence, reasons: w.reasons });
    if (!cb.possibleDuplicates.some((d) => d.key === ka)) cb.possibleDuplicates.push({ key: ka, name: ca.name, confidence: w.confidence, reasons: w.reasons });
  }
  for (const c of companies) {
    if (c.possibleDuplicates.some((d) => d.confidence === "MEDIUM")) c.qualityLabel = "NEEDS_REVIEW";
  }

  return { companies, duplicateRecords, perSource, clusterOf };
}

function buildUnified(members: Prepared[], priority: FieldPriority, now: number, weakest: DuplicateConfidence | null): UnifiedCompany {
  const candidates = new Map<MergeField, FieldValue[]>();
  for (const m of members) {
    for (const [field, value] of Object.entries(fieldValuesOf(m.rec)) as [MergeField, string | undefined][]) {
      if (!value || !String(value).trim()) continue;
      const list = candidates.get(field) ?? [];
      list.push({ value: String(value).trim(), source: m.rec.source, confidence: m.rec.confidence, collectedAt: m.rec.collectedAt, verifiedAt: m.rec.verifiedAt ?? null });
      candidates.set(field, list);
    }
  }

  const provenance: UnifiedCompany["provenance"] = {};
  const conflicts: FieldConflict[] = [];
  for (const [field, values] of candidates) {
    const chosen = chooseValue(field, values, priority, now);
    provenance[field] = chosen;
    if (!CONFLICT_FIELDS.includes(field)) continue;
    const chosenKey = compareKey(field, chosen.value);
    const alternatives: FieldValue[] = [];
    const seenKeys = new Set([chosenKey]);
    for (const v of values) {
      const k = compareKey(field, v.value);
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      alternatives.push(v);
    }
    if (alternatives.length) conflicts.push({ field, chosen, alternatives });
  }

  const get = (f: MergeField) => provenance[f]?.value ?? null;
  const coords = get("coordinates")?.split(",").map(Number) ?? null;

  // Keep every distinct phone any member had (§21).
  const phones: string[] = [];
  const phoneKeys = new Set<string>();
  const chosenPhone = get("phone");
  for (const raw of [chosenPhone, ...members.flatMap((m) => [m.rec.phone, ...(m.rec.phones ?? [])])]) {
    if (!raw) continue;
    const k = phoneKey(raw) ?? raw;
    if (phoneKeys.has(k)) continue;
    phoneKeys.add(k);
    phones.push(raw);
  }

  const socials: SocialMap = {};
  for (const net of ["instagram", "facebook", "tiktok", "linkedin", "youtube"] as const) {
    const v = get(net);
    if (v) socials[net] = v;
  }

  const companyIds = [...new Set(members.map((m) => m.rec.companyId).filter((id): id is string => Boolean(id)))];
  const sourceKeys = [...new Set(members.map((m) => m.rec.source))];
  const warnings: string[] = [];
  if (companyIds.length > 1) warnings.push(`${companyIds.length} empresas do banco parecem ser a mesma — revise duplicatas no cadastro.`);

  const allTextOnly = members.every((m) => m.rec.matchedBy === "text_search" || m.rec.matchedBy === "name_keyword");
  let confidence: Confidence = "MEDIUM";
  if (sourceKeys.length >= 2 || members.some((m) => m.rec.confidence === "HIGH") || get("cnpj")) confidence = "HIGH";
  else if (allTextOnly && sourceKeys.length === 1) confidence = "LOW";

  const cnpjStatus = members.map((m) => m.rec.cnpjStatus).find(Boolean) ?? null;
  const first = members[0].rec;
  const key = companyIds[0] ? `db:${companyIds[0]}` : `u:${members[0].identity.find((k) => k.startsWith("osm:")) ?? members[0].identity[0]}`;

  const unified: UnifiedCompany = {
    key,
    companyId: companyIds[0] ?? null,
    name: get("name") ?? first.name,
    legalName: get("legalName"),
    cnpj: get("cnpj"),
    cnpjStatus,
    category: get("category"),
    street: get("street"),
    houseNumber: get("houseNumber"),
    neighborhood: get("neighborhood"),
    city: get("city"),
    state: get("state"),
    postcode: get("postcode"),
    phone: chosenPhone,
    phones,
    whatsapp: get("whatsapp"),
    email: get("email"),
    website: get("website"),
    lat: coords && Number.isFinite(coords[0]) ? coords[0] : null,
    lon: coords && Number.isFinite(coords[1]) ? coords[1] : null,
    socials,
    provenance,
    conflicts,
    sources: members.map((m) => ({ source: m.rec.source, recordId: m.rec.sourceRecordId, url: m.rec.sourceUrl, matchedBy: m.rec.matchedBy })),
    sourceKeys,
    mergeConfidence: members.length > 1 ? weakest : null,
    possibleDuplicates: [] as PossibleDuplicate[],
    confidence,
    completeness: 0,
    completenessLabel: "FRACO",
    qualityLabel: "PARTIAL",
    discoveryStatus: companyIds.length ? "EXISTING" : "NEW",
    rankScore: 0,
    hasDecisionMaker: members.some((m) => m.rec.hasDecisionMaker),
    contacts: mergeContacts(members.map((m) => m.rec)),
    inPipeline: members.some((m) => m.rec.inPipeline),
    enrichment: { state: "PENDING", sources: [] },
    warnings,
  };
  if (cnpjStatus && cnpjStatus !== "ATIVA") unified.warnings.push(`Situação cadastral: ${cnpjStatus}`);
  refreshDerived(unified);
  return unified;
}

function mergeContacts(recs: SourceCompany[]): UnifiedCompany["contacts"] {
  const out: NonNullable<UnifiedCompany["contacts"]> = [];
  for (const r of recs) {
    for (const c of r.contacts ?? []) {
      if (!out.some((o) => foldText(o.name) === foldText(c.name))) out.push({ ...c, source: r.source });
    }
  }
  return out.length ? out : undefined;
}

/** Recompute completeness/labels/rank after any change (merge or enrichment). */
export function refreshDerived(c: UnifiedCompany): UnifiedCompany {
  c.completeness = computeCompleteness(c);
  c.completenessLabel = completenessLabel(c.completeness);
  c.rankScore = rankScore(c);
  const needsReview = c.conflicts.length > 0 || c.warnings.length > 0 || c.possibleDuplicates.some((d) => d.confidence === "MEDIUM");
  c.qualityLabel = needsReview ? "NEEDS_REVIEW" : c.completeness >= 75 ? "COMPLETE" : "PARTIAL";
  return c;
}
