/**
 * OSM (Overpass QL) Query Builder — the only place Overpass queries are
 * assembled. Inputs are validated/escaped; nothing user-typed is ever
 * concatenated raw into QL.
 *
 * Location strategies (tried in this order by the Overpass adapter):
 *   area   → municipality boundary by name inside the state's ISO3166-2
 *            area. Needs no geocoder at all.
 *   bbox   → bounding box from a geocoder result.
 *   around → radius (m) around coordinates (radius searches / "cidades
 *            vizinhas" expansion).
 */

import { accentInsensitivePattern, escapeRegex, foldText } from "./normalize";
import type { OsmTag } from "./industries";

export type OsmLocation =
  | { kind: "area"; city: string; stateUf: string }
  | { kind: "bbox"; south: number; west: number; north: number; east: number }
  | { kind: "around"; lat: number; lon: number; radiusM: number };

export interface OsmQueryInput {
  location: OsmLocation;
  tags: OsmTag[];
  nameKeywords?: string[];
  timeoutSec?: number;
  maxResults?: number;
}

const TAG_KEY = /^[a-z][a-z0-9_:]{0,40}$/;
const TAG_VALUE = /^([a-z0-9][a-z0-9_:;.-]{0,60}|\*)$/;
const NAME_KEYWORD_PARENT_KEYS = ["amenity", "shop", "craft", "office", "healthcare", "leisure", "tourism"];

export class OsmQueryError extends Error {}

function assertNumber(n: number, label: string, min: number, max: number) {
  if (!Number.isFinite(n) || n < min || n > max) throw new OsmQueryError(`Coordenada inválida (${label})`);
}

export function quoteString(value: string): string {
  // Overpass string literal: escape backslash and double quote, drop control chars.
  return `"${value.replace(/[\u0000-\u001f]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function validateTag(tag: OsmTag): OsmTag {
  if (!TAG_KEY.test(tag.key) || !TAG_VALUE.test(tag.value)) {
    throw new OsmQueryError(`Tag OSM inválida: ${tag.key}=${tag.value}`);
  }
  return tag;
}

function locationFilter(loc: OsmLocation): { prelude: string; filter: string } {
  switch (loc.kind) {
    case "area": {
      if (!/^[A-Z]{2}$/.test(loc.stateUf)) throw new OsmQueryError("UF inválida");
      const cityFolded = foldText(loc.city);
      if (!cityFolded || cityFolded.length > 80) throw new OsmQueryError("Cidade inválida");
      const pattern = `^${accentInsensitivePattern(loc.city.trim())}$`;
      return {
        prelude:
          `area["ISO3166-2"=${quoteString(`BR-${loc.stateUf}`)}]->.uf;\n` +
          `area["boundary"="administrative"]["admin_level"="8"]["name"~${quoteString(pattern)},i](area.uf)->.city;\n` +
          `.city out ids;\n`,
        filter: "(area.city)",
      };
    }
    case "bbox": {
      assertNumber(loc.south, "south", -90, 90);
      assertNumber(loc.north, "north", -90, 90);
      assertNumber(loc.west, "west", -180, 180);
      assertNumber(loc.east, "east", -180, 180);
      if (loc.south >= loc.north || loc.west >= loc.east) throw new OsmQueryError("Bounding box inválido");
      const area = (loc.north - loc.south) * (loc.east - loc.west);
      if (area > 4) throw new OsmQueryError("Bounding box grande demais para uma busca local");
      return { prelude: "", filter: `(${loc.south},${loc.west},${loc.north},${loc.east})` };
    }
    case "around": {
      assertNumber(loc.lat, "lat", -90, 90);
      assertNumber(loc.lon, "lon", -180, 180);
      assertNumber(loc.radiusM, "radius", 100, 100_000);
      return { prelude: "", filter: `(around:${Math.round(loc.radiusM)},${loc.lat},${loc.lon})` };
    }
  }
}

/**
 * Groups tags by key into one regex clause per key, so N tags become a few
 * clauses in ONE request (not N requests):
 *   nwr["amenity"~"^(restaurant|fast_food)$"](area.city);
 */
function tagClauses(tags: OsmTag[], filter: string): string[] {
  const byKey = new Map<string, string[]>();
  for (const tag of tags.map(validateTag)) {
    const list = byKey.get(tag.key) ?? [];
    if (!list.includes(tag.value)) list.push(tag.value);
    byKey.set(tag.key, list);
  }
  return [...byKey.entries()].map(([key, values]) =>
    // "*" = any value for that key; only named objects are useful as businesses.
    values.includes("*")
      ? `  nwr[${quoteString(key)}]["name"]${filter};`
      : values.length === 1
      ? `  nwr[${quoteString(key)}=${quoteString(values[0])}]${filter};`
      : `  nwr[${quoteString(key)}~${quoteString(`^(${values.map(escapeRegex).join("|")})$`)}]${filter};`
  );
}

function nameClauses(keywords: string[], filter: string): string[] {
  const clean = keywords
    .map((k) => k.trim())
    .filter((k) => foldText(k).length >= 3)
    .slice(0, 12);
  if (!clean.length) return [];
  const pattern = clean.map((k) => accentInsensitivePattern(k)).join("|");
  // One clause per parent key: a key-exists filter hits Overpass's index,
  // whereas a regex over keys (nwr[~"^(amenity|shop)$"~"."]) scans every
  // object and timed out (>60s) on a municipality-sized area in testing.
  return NAME_KEYWORD_PARENT_KEYS.map((key) => `  nwr[${quoteString(key)}]["name"~${quoteString(pattern)},i]${filter};`);
}

export function buildOverpassQuery(input: OsmQueryInput): string {
  const timeout = Math.min(60, Math.max(5, Math.round(input.timeoutSec ?? 25)));
  const max = Math.min(2000, Math.max(1, Math.round(input.maxResults ?? 1000)));
  const { prelude, filter } = locationFilter(input.location);
  const clauses = [...tagClauses(input.tags, filter), ...nameClauses(input.nameKeywords ?? [], filter)];
  if (!clauses.length) throw new OsmQueryError("Nenhuma tag ou palavra-chave para consultar no OSM");
  return `[out:json][timeout:${timeout}];\n${prelude}(\n${clauses.join("\n")}\n);\nout center tags ${max};`;
}
