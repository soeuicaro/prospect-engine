/**
 * Normalization helpers used by adapters, the merge engine, and the UI.
 * Normalized values are for COMPARISON only — original values are always
 * kept on the record.
 */

import { normalizePhoneBR } from "@/lib/domain/phone";
import type { SocialMap } from "./types";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function foldText(text: string | null | undefined): string {
  if (!text) return "";
  return stripAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export const UF_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

const UF_BY_FOLDED_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(UF_NAMES).map(([uf, name]) => [foldText(name), uf])
);

/** "CE", "ce", "Ceará", "ceara" → "CE". Unknown → null. */
export function normalizeUf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[a-z]{2}$/i.test(trimmed) && UF_NAMES[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  return UF_BY_FOLDED_NAME[foldText(trimmed)] ?? null;
}

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

function titleCaseCity(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * "Sobral", "Sobral - CE", "Sobral/CE", "Sobral, Ceará", "SOBRAL (CE)" →
 * { city: "Sobral", state: "CE" }. An explicit `stateHint` wins when the
 * city text carries no state.
 */
export function normalizeLocation(cityRaw: string, stateHint?: string | null): { city: string; state: string | null } {
  let text = (cityRaw ?? "").trim().replace(/\s+/g, " ");
  let state: string | null = null;

  const suffix = text.match(/^(.*?)(?:\s*[-/,(]\s*|\s+)([A-Za-zÀ-ÿ ]{2,})\)?\s*$/);
  if (suffix) {
    const maybeUf = normalizeUf(suffix[2]);
    if (maybeUf && suffix[1].trim().length >= 2) {
      state = maybeUf;
      text = suffix[1].trim();
    }
  }
  text = text.replace(/[-/,(]+$/, "").trim();
  const city = text === text.toUpperCase() || text === text.toLowerCase() ? titleCaseCity(text) : text;
  return { city, state: state ?? normalizeUf(stateHint) };
}

export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return foldText(a) === foldText(b);
}

/** Regex fragment matching `text` case/accent-insensitively (for Overpass). */
export function accentInsensitivePattern(text: string): string {
  const groups: Record<string, string> = {
    a: "[aáàâãä]",
    e: "[eéèêë]",
    i: "[iíìîï]",
    o: "[oóòôõö]",
    u: "[uúùûü]",
    c: "[cç]",
    n: "[nñ]",
  };
  return stripAccents(text)
    .toLowerCase()
    .split("")
    .map((ch) => groups[ch] ?? escapeRegex(ch))
    .join("");
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/"]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Business names
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = /\b(ltda|me|epp|eireli|s\/?a|sa|mei|limitada|comercio|servicos|com|serv)\b\.?/g;

/** Generic words that must not be used alone as a dedup blocking key. */
export const GENERIC_NAME_TOKENS = new Set([
  "restaurante", "restaurant", "lanchonete", "lanches", "bar", "pizzaria", "pizza", "cafe", "cafeteria",
  "padaria", "comida", "casa", "ponto", "espaco", "centro", "clinica", "loja", "salao", "studio", "estudio",
  "academia", "hotel", "pousada", "oficina", "auto", "pet", "shop", "do", "da", "de", "dos", "das", "e", "o", "a",
  "the", "grill", "churrascaria", "hamburgueria", "burger", "sorveteria", "delivery", "food",
]);

/**
 * "RESTAURANTE X LTDA", "Restaurante X", "Restaurante X - Sobral" → "restaurante x".
 * `city` (if given) is stripped as a trailing qualifier.
 */
export function normalizeBusinessName(name: string | null | undefined, city?: string | null): string {
  let n = foldText(name);
  if (!n) return "";
  n = n.replace(LEGAL_SUFFIXES, " ");
  if (city) {
    const c = foldText(city);
    if (c) n = n.replace(new RegExp(`(^| )${escapeRegex(c)}$`), " ");
  }
  return n.replace(/\s+/g, " ").trim();
}

export function significantTokens(normalizedName: string, extraStopwords?: Set<string>): string[] {
  return normalizedName
    .split(" ")
    .filter((t) => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t) && !extraStopwords?.has(t));
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Trigram Jaccard similarity on normalized names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

/** Comparable key: "(88) 99999-9999", "5588999999999", "88999999999" → "88999999999". */
export function phoneKey(raw: string | null | undefined): string | null {
  const p = normalizePhoneBR(raw);
  if (!p || !p.valid_format || !p.ddd) return null;
  return `${p.ddd}${p.number}`;
}

/** BR mobile numbers have 9 digits starting with 9 (after the DDD). */
export function isMobileBR(raw: string | null | undefined): boolean {
  const p = normalizePhoneBR(raw);
  return Boolean(p?.valid_format && p.number.length === 9 && p.number.startsWith("9"));
}

/** OSM-style multi-value phone fields: "+55 88 3611-0000;+55 88 99999-0000". */
export function splitPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,/]|\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.replace(/\D/g, "").length >= 8);
}

export function formatPhoneBR(raw: string | null | undefined): string | null {
  const p = normalizePhoneBR(raw);
  if (!p || !p.valid_format || !p.ddd) return raw ?? null;
  const n = p.number;
  return n.length === 9 ? `(${p.ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : `(${p.ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
}

// ---------------------------------------------------------------------------
// URLs, domains, socials
// ---------------------------------------------------------------------------

/** Hosts where the domain says nothing about the business (never a dedup key). */
const PLATFORM_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "fb.me", "m.facebook.com", "tiktok.com", "linkedin.com",
  "youtube.com", "youtu.be", "wa.me", "api.whatsapp.com", "whatsapp.com", "linktr.ee", "linktree.com",
  "bit.ly", "goo.gl", "google.com", "maps.google.com", "g.page", "ifood.com.br", "aiqfome.com",
  "anota.ai", "cardapioweb.com", "goomer.app", "twitter.com", "x.com", "beacons.ai", "taplink.cc",
];

export function toUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

export function hostOf(raw: string | null | undefined): string | null {
  const url = toUrl(raw);
  return url ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
}

export function isPlatformHost(host: string): boolean {
  return PLATFORM_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
}

/** Business domain usable as a dedup key, or null for platform/social URLs. */
export function websiteDomain(raw: string | null | undefined): string | null {
  const host = hostOf(raw);
  if (!host || isPlatformHost(host)) return null;
  return host;
}

export function normalizeWebsite(raw: string | null | undefined): string | null {
  const url = toUrl(raw);
  if (!url) return null;
  return url.toString().replace(/\/$/, "");
}

type SocialKey = keyof SocialMap;

const SOCIAL_HOSTS: { key: SocialKey; hosts: string[]; build: (handle: string) => string }[] = [
  { key: "instagram", hosts: ["instagram.com"], build: (h) => `https://www.instagram.com/${h}` },
  { key: "facebook", hosts: ["facebook.com", "fb.com", "m.facebook.com", "fb.me"], build: (h) => `https://www.facebook.com/${h}` },
  { key: "tiktok", hosts: ["tiktok.com"], build: (h) => `https://www.tiktok.com/@${h.replace(/^@/, "")}` },
  { key: "linkedin", hosts: ["linkedin.com"], build: (h) => `https://www.linkedin.com/company/${h}` },
  { key: "youtube", hosts: ["youtube.com", "youtu.be"], build: (h) => `https://www.youtube.com/@${h.replace(/^@/, "")}` },
];

/** If `raw` is a social profile URL, which network is it? */
export function classifySocialUrl(raw: string | null | undefined): SocialKey | null {
  const host = hostOf(raw);
  if (!host) return null;
  for (const s of SOCIAL_HOSTS) if (s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return s.key;
  return null;
}

/**
 * Normalizes a social value that may be a URL or a bare handle
 * ("@restx", "restx", "instagram.com/restx") into a canonical profile URL.
 */
export function normalizeSocial(key: SocialKey, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const spec = SOCIAL_HOSTS.find((s) => s.key === key)!;
  const url = toUrl(trimmed);
  if (url && spec.hosts.some((h) => url.hostname.toLowerCase().replace(/^www\./, "").endsWith(h))) {
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return null;
    return `https://${url.hostname.toLowerCase().startsWith("www.") ? url.hostname.toLowerCase() : `www.${url.hostname.toLowerCase().replace(/^m\./, "")}`}${path}`;
  }
  const handle = trimmed.replace(/^@/, "");
  if (!/^[A-Za-z0-9_.-]{2,60}$/.test(handle)) return null;
  return spec.build(handle);
}

export function socialHandle(url: string | null | undefined): string | null {
  const u = toUrl(url);
  if (!u) return null;
  const seg = u.pathname.split("/").filter(Boolean);
  return seg.length ? seg[seg.length - 1] : null;
}

/**
 * Domain ↔ business name plausibility, used before trusting a website
 * that did not come from an official source (§74). HIGH = the domain
 * contains a significant name token; LOW = no overlap at all.
 */
export function domainMatchesName(domain: string | null, name: string | null): "HIGH" | "MEDIUM" | "LOW" {
  if (!domain || !name) return "LOW";
  const label = foldText(domain.split(".")[0]).replace(/\s+/g, "");
  const tokens = significantTokens(normalizeBusinessName(name));
  if (!tokens.length) return "MEDIUM";
  if (tokens.some((t) => label.includes(t))) return "HIGH";
  const joined = tokens.join("");
  if (joined && nameSimilarity(label, joined) >= 0.4) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bboxAround(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

export function inBbox(
  point: { lat: number; lon: number },
  bbox: { south: number; west: number; north: number; east: number },
  marginDeg = 0.01
): boolean {
  return (
    point.lat >= bbox.south - marginDeg &&
    point.lat <= bbox.north + marginDeg &&
    point.lon >= bbox.west - marginDeg &&
    point.lon <= bbox.east + marginDeg
  );
}
