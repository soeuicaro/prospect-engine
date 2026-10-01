import { describe, expect, it } from "vitest";
import { ALL_BUSINESSES, expandIndustry, INDUSTRY_CATALOG } from "./industries";
import { buildOverpassQuery, validateTag } from "./osm-query-builder";
import { OVERTURE_CATEGORIES } from "./overture-categories";

const CNAE_RE = /^\d{4}-\d\/\d{2}$/;

describe("industry catalog", () => {
  it("has unique keys", () => {
    const keys = INDUSTRY_CATALOG.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each([...INDUSTRY_CATALOG, ALL_BUSINESSES].map((i) => [i.key, i] as const))("%s: valid tags, CNAEs and Overpass query", (_key, industry) => {
    const tags = [...industry.osmTags.primary, ...industry.osmTags.related, ...industry.osmTags.broad];
    for (const tag of tags) expect(() => validateTag(tag)).not.toThrow();
    for (const cnae of [...industry.cnaes.primary, ...industry.cnaes.related]) expect(cnae).toMatch(CNAE_RE);
    expect(industry.primaryKeywords.length).toBeGreaterThan(0);
    const exp = expandIndustry(industry, { mode: "BROAD" });
    expect(() =>
      buildOverpassQuery({ location: { kind: "area", city: "Sobral", stateUf: "CE" }, tags: exp.osmTags, nameKeywords: exp.nameKeywords })
    ).not.toThrow();
  });

  it("maps every catalog niche to Overture categories", () => {
    const missing = INDUSTRY_CATALOG.filter((i) => !OVERTURE_CATEGORIES[i.key]?.primary.length).map((i) => i.key);
    expect(missing).toEqual([]);
  });

  it("BROAD mode applies every synonym", () => {
    const restaurante = INDUSTRY_CATALOG.find((i) => i.key === "restaurante")!;
    const exp = expandIndustry(restaurante, { mode: "BROAD" });
    for (const s of restaurante.synonyms) expect(exp.textTerms).toContain(s);
  });
});
