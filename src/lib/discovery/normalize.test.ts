import { describe, expect, it } from "vitest";
import {
  classifySocialUrl,
  domainMatchesName,
  isMobileBR,
  normalizeBusinessName,
  normalizeLocation,
  normalizeSocial,
  normalizeUf,
  phoneKey,
  splitPhones,
  websiteDomain,
} from "./normalize";
import { computeCacheKey, normalizeSearchContext, SearchValidationError } from "./context";
import { expandIndustry, getIndustry } from "./industries";

describe("location normalization (§77)", () => {
  it.each([
    ["Sobral", "CE"],
    ["Sobral - CE", null],
    ["Sobral/CE", null],
    ["Sobral, Ceará", null],
    ["SOBRAL (CE)", null],
    ["sobral", "ce"],
  ])("%s → Sobral/CE", (input, hint) => {
    expect(normalizeLocation(input, hint)).toEqual({ city: "Sobral", state: "CE" });
  });

  it("keeps multi-word city names intact", () => {
    expect(normalizeLocation("São João do Jaguaribe", "CE")).toEqual({ city: "São João do Jaguaribe", state: "CE" });
    expect(normalizeLocation("rio de janeiro - rj")).toEqual({ city: "Rio de Janeiro", state: "RJ" });
  });

  it("normalizes UF names", () => {
    expect(normalizeUf("Ceará")).toBe("CE");
    expect(normalizeUf("ceara")).toBe("CE");
    expect(normalizeUf("XX")).toBeNull();
  });
});

describe("business name normalization (§78)", () => {
  it("compares variants without losing the original", () => {
    const a = normalizeBusinessName("RESTAURANTE X LTDA");
    const b = normalizeBusinessName("Restaurante X");
    const c = normalizeBusinessName("Restaurante X - Sobral", "Sobral");
    expect(a).toBe("restaurante x");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("phone normalization (§79)", () => {
  it("equates BR formats", () => {
    expect(phoneKey("(88) 99999-9999")).toBe("88999999999");
    expect(phoneKey("5588999999999")).toBe("88999999999");
    expect(phoneKey("88999999999")).toBe("88999999999");
    expect(phoneKey("123")).toBeNull();
  });
  it("detects mobiles and splits OSM multi-values", () => {
    expect(isMobileBR("(88) 99999-9999")).toBe(true);
    expect(isMobileBR("(88) 3611-1234")).toBe(false);
    expect(splitPhones("+55 88 3611-0000;+55 88 99999-0000")).toHaveLength(2);
  });
});

describe("URLs / domains / socials", () => {
  it("platform URLs are not business domains", () => {
    expect(websiteDomain("https://www.aragao.com.br/menu")).toBe("aragao.com.br");
    expect(websiteDomain("instagram.com/aragao")).toBeNull();
    expect(websiteDomain("https://www.ifood.com.br/delivery/sobral-ce/x")).toBeNull();
    expect(classifySocialUrl("https://m.facebook.com/aragao")).toBe("facebook");
  });
  it("normalizes handles and URLs to profile links", () => {
    expect(normalizeSocial("instagram", "@aragao")).toBe("https://www.instagram.com/aragao");
    expect(normalizeSocial("instagram", "https://instagram.com/aragao/")).toBe("https://www.instagram.com/aragao");
    expect(normalizeSocial("tiktok", "aragao")).toBe("https://www.tiktok.com/@aragao");
    expect(normalizeSocial("instagram", "not a handle!!")).toBeNull();
  });
  it("domain ↔ name plausibility (§74)", () => {
    expect(domainMatchesName("aragao.com.br", "Restaurante Aragão")).toBe("HIGH");
    expect(domainMatchesName("xyzfoods.com", "Restaurante Aragão")).toBe("LOW");
  });
});

describe("SearchContext + cache key (§12, §63)", () => {
  it("validates and normalizes input", () => {
    const c = normalizeSearchContext({ city: "Sobral/CE", industryKey: "restaurante" });
    expect(c.state).toBe("CE");
    expect(c.limit).toBe(100);
    expect(c.mode).toBe("BALANCED");
    expect(c.sourcesEnabled).toContain("osm_overpass");
    expect(() => normalizeSearchContext({ city: "Sobral", state: "ZZ" })).toThrow(SearchValidationError);
  });

  it("is deterministic and ignores limit/page/sort", async () => {
    const a = normalizeSearchContext({ city: "Sobral", state: "CE", industryKey: "restaurante", keywords: ["pizza", "açaí"], limit: 10 });
    const b = normalizeSearchContext({ city: "sobral", state: "ce", industryKey: "restaurante", keywords: ["açaí", "pizza"], limit: 500, sort: "name" });
    const c = normalizeSearchContext({ city: "Sobral", state: "CE", industryKey: "restaurante", radiusKm: 10 });
    expect(await computeCacheKey(a)).toBe(await computeCacheKey(b));
    expect(await computeCacheKey(a)).not.toBe(await computeCacheKey(c));
  });
});

describe("industry keyword expansion (§24-25)", () => {
  it("BALANCED restaurant search covers restaurant + fast food + food court, not just one tag", () => {
    const e = expandIndustry(getIndustry("restaurante"), { mode: "BALANCED" });
    expect(e.osmTags.map((t) => t.value)).toEqual(["restaurant", "fast_food", "food_court"]);
    expect(e.textTerms).toContain("lanchonete");
    expect(e.cnaes).toContain("5611-2/01");
    expect(e.availableTerms.length).toBeGreaterThan(0);
  });
  it("PRECISE narrows, BROAD widens and enables name keywords", () => {
    const p = expandIndustry(getIndustry("restaurante"), { mode: "PRECISE" });
    const b = expandIndustry(getIndustry("restaurante"), { mode: "BROAD" });
    expect(p.osmTags).toHaveLength(1);
    expect(b.osmTags.length).toBeGreaterThan(5);
    expect(b.nameKeywords).toContain("pizzaria");
    expect(b.cnaes.length).toBeGreaterThan(p.cnaes.length);
  });
});
