import { describe, expect, it } from "vitest";
import { buildOverpassQuery, OsmQueryError, quoteString } from "./osm-query-builder";

describe("buildOverpassQuery", () => {
  it("builds a municipality-area query with all tags grouped in ONE request", () => {
    const q = buildOverpassQuery({
      location: { kind: "area", city: "Sobral", stateUf: "CE" },
      tags: [
        { key: "amenity", value: "restaurant" },
        { key: "amenity", value: "fast_food" },
        { key: "shop", value: "bakery" },
      ],
    });
    expect(q).toContain('area["ISO3166-2"="BR-CE"]->.uf;');
    expect(q).toContain('["admin_level"="8"]');
    expect(q).toContain('nwr["amenity"~"^(restaurant|fast_food)$"](area.city);');
    expect(q).toContain('nwr["shop"="bakery"](area.city);');
    expect(q).toContain(".city out ids;");
    expect(q).toMatch(/out center tags \d+;$/);
    // relations included (nwr), not only node/way
    expect(q).not.toContain("node[");
  });

  it("matches the city name accent/case-insensitively", () => {
    const q = buildOverpassQuery({ location: { kind: "area", city: "São João", stateUf: "PB" }, tags: [{ key: "amenity", value: "cafe" }] });
    expect(q).toContain("^s[aáàâãä][oóòôõö] j[oóòôõö][aáàâãä][oóòôõö]$");
    expect(q).toContain(",i](area.uf)");
  });

  it("escapes user text so it cannot break out of the QL string", () => {
    expect(quoteString('a"b\\c')).toBe('"a\\"b\\\\c"');
    const q = buildOverpassQuery({
      location: { kind: "area", city: 'X"];out;', stateUf: "CE" },
      tags: [],
      nameKeywords: ['pizza"](around:1)'],
    });
    expect(q).not.toContain('"];out;');
    expect(q).toContain('\\"');
  });

  it("rejects invalid tags, UF and coordinates", () => {
    expect(() => buildOverpassQuery({ location: { kind: "area", city: "Sobral", stateUf: "CE" }, tags: [{ key: "amenity", value: 'x"]' }] })).toThrow(OsmQueryError);
    expect(() => buildOverpassQuery({ location: { kind: "area", city: "Sobral", stateUf: "Ceará" }, tags: [{ key: "amenity", value: "cafe" }] })).toThrow(OsmQueryError);
    expect(() => buildOverpassQuery({ location: { kind: "bbox", south: 1, north: 0, west: 0, east: 1 }, tags: [{ key: "amenity", value: "cafe" }] })).toThrow(OsmQueryError);
    expect(() => buildOverpassQuery({ location: { kind: "bbox", south: -10, north: 0, west: -50, east: -40 }, tags: [{ key: "amenity", value: "cafe" }] })).toThrow(/grande demais/);
    expect(() => buildOverpassQuery({ location: { kind: "area", city: "Sobral", stateUf: "CE" }, tags: [] })).toThrow(OsmQueryError);
  });

  it("supports radius and indexed name-keyword clauses", () => {
    const q = buildOverpassQuery({ location: { kind: "around", lat: -3.68, lon: -40.35, radiusM: 5000 }, tags: [], nameKeywords: ["pizzaria"] });
    expect(q).toContain("(around:5000,-3.68,-40.35)");
    expect(q).toContain('nwr["amenity"]["name"~"p[iíìîï]zz[aáàâãä]r[iíìîï][aáàâãä]",i]');
    expect(q).toContain('nwr["shop"]["name"~');
  });
});

describe("all-businesses mode", () => {
  it("key-only tags become 'any named object with that key'", () => {
    const q = buildOverpassQuery({ location: { kind: "area", city: "Sobral", stateUf: "CE" }, tags: [{ key: "shop", value: "*" }, { key: "amenity", value: "pharmacy" }] });
    expect(q).toContain('nwr["shop"]["name"](area.city);');
    expect(q).toContain('nwr["amenity"="pharmacy"](area.city);');
  });
});
