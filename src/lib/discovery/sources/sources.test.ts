import { describe, expect, it } from "vitest";
import { BreakerRegistry } from "../circuit-breaker";
import { expandIndustry, getIndustry } from "../industries";
import { ctx, mockFetch, overpassElements, testEnv } from "../testing";
import type { ResolvedLocation } from "../types";
import { createOverpassSource, mirrorBreakerKey, OVERPASS_ENDPOINTS, parseOverpassElements } from "./overpass";
import { createNominatimSource, nominatimGeo, pickMunicipality } from "./nominatim";
import { createPhotonSource } from "./photon";
import { brasilApiToPatch, createBrasilApiSource, formatCnae } from "./brasilapi";

const expansion = expandIndustry(getIndustry("restaurante"), { mode: "BALANCED" });
const location: ResolvedLocation = {
  city: "Sobral",
  state: "CE",
  displayName: "Sobral, Ceará",
  lat: -3.6883,
  lon: -40.3497,
  bbox: { south: -3.75, north: -3.61, west: -40.49, east: -40.3 },
  osmRelationId: 302610,
  source: "osm_nominatim",
  confidence: "HIGH",
};
const withArea = (els: unknown[]) => ({ elements: [{ type: "area", id: 3600302610 }, ...els] });

describe("Overpass adapter", () => {
  it("OSM success: parses node/way/relation, drops nameless (counted), unique record ids", async () => {
    const { impl } = mockFetch({
      "overpass-api.de": [
        {
          status: 200,
          body: withArea([
            ...overpassElements(3),
            { type: "way", id: 1000, center: { lat: -3.69, lon: -40.34 }, tags: { amenity: "fast_food", name: "Lanchonete Way", phone: "+55 88 3611-0000;+55 88 99999-0000", website: "https://instagram.com/lanchonete" } },
            { type: "relation", id: 7, center: { lat: -3.7, lon: -40.3 }, tags: { amenity: "food_court", name: "Praça de Alimentação" } },
            { type: "node", id: 99, lat: -3.6, lon: -40.3, tags: { amenity: "restaurant" } },
          ]),
        },
      ],
    });
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, testEnv("osm_overpass", impl));
    expect(run.status).toBe("SOURCE_SUCCESS");
    expect(run.results).toHaveLength(5);
    expect(run.metadata.invalid).toBe(1);
    const way = run.results.find((r) => r.sourceRecordId === "way/1000")!;
    expect(way.sourceUrl).toBe("https://www.openstreetmap.org/way/1000");
    expect(way.phones).toHaveLength(2);
    // An instagram URL in `website` is a social, not a website.
    expect(way.website).toBeNull();
    expect(way.socials?.instagram).toBe("https://www.instagram.com/lanchonete");
    expect(run.results.some((r) => r.sourceRecordId === "relation/7")).toBe(true);
    expect(run.metadata.strategy).toBe("area");
  });

  it("OSM 500 on the main mirror → next mirror, results kept, mirror breaker records the failure", async () => {
    const { impl, calls } = mockFetch({
      "overpass-api.de": [{ status: 500, body: "Internal error" }],
      "maps.mail.ru": [{ status: 200, body: withArea(overpassElements(4)) }],
    });
    const env = testEnv("osm_overpass", impl);
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, env);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["overpass-api.de", "maps.mail.ru"]);
    expect(run.results).toHaveLength(4);
    expect(run.status).toBe("SOURCE_SUCCESS_WITH_WARNINGS");
    expect(run.logs.map((l) => l.httpStatus)).toEqual([500, 200]);
    expect(run.logs[1].fallbackActivated).toBe(true);
    expect(env.breakers.get(mirrorBreakerKey(OVERPASS_ENDPOINTS[0])).consecutiveFailures).toBe(1);
  });

  it("OSM 429 everywhere → SOURCE_RATE_LIMITED (not 'no results'), bounded attempts", async () => {
    const { impl, calls } = mockFetch({
      "overpass-api.de": [{ status: 429 }],
      "maps.mail.ru": [{ status: 429 }],
      "kumi.systems": [{ status: 429 }],
    });
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, testEnv("osm_overpass", impl));
    expect(run.status).toBe("SOURCE_RATE_LIMITED");
    expect(run.results).toHaveLength(0);
    // 3 mirrors × (1 + retryCount=1) rounds, never infinite
    expect(calls.length).toBe(6);
    expect(run.userMessage).toMatch(/limitou/);
  });

  it("OSM timeout → SOURCE_TIMEOUT", async () => {
    const { impl } = mockFetch({ overpass: [{ throws: "timeout" }], "maps.mail.ru": [{ throws: "timeout" }] });
    const env = testEnv("osm_overpass", impl);
    env.config = { ...env.config, timeoutMs: 20, retryCount: 0 };
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, env);
    expect(run.status).toBe("SOURCE_TIMEOUT");
  });

  it("OSM malformed result (HTML on 200) → tries the next mirror", async () => {
    const { impl } = mockFetch({
      "overpass-api.de": [{ status: 200, body: "<html>rate limited</html>" }],
      "maps.mail.ru": [{ status: 200, body: withArea(overpassElements(2)) }],
    });
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, testEnv("osm_overpass", impl));
    expect(run.results).toHaveLength(2);
    expect(run.logs[0].errorKind).toBe("PARSE");
  });

  it("HTTP 200 + 'runtime error' remark is PARTIAL — never silently treated as complete", async () => {
    const partial = { remark: "runtime error: Query timed out in \"query\" at line 5 after 26 seconds.", ...withArea(overpassElements(2)) };
    const { impl } = mockFetch({ "overpass-api.de": [{ status: 200, body: partial }], "maps.mail.ru": [{ status: 504 }], "kumi.systems": [{ status: 504 }] });
    const env = testEnv("osm_overpass", impl);
    env.config = { ...env.config, retryCount: 0 };
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, env);
    expect(run.status).toBe("SOURCE_PARTIAL_RESULTS");
    expect(run.results).toHaveLength(2);
    expect(run.warnings.join(" ")).toMatch(/parcial/);
  });

  it("remark on one mirror, full answer on the next → complete result", async () => {
    const { impl } = mockFetch({
      "overpass-api.de": [{ status: 200, body: { remark: "runtime error: out of memory", elements: [] } }],
      "maps.mail.ru": [{ status: 200, body: withArea(overpassElements(30)) }],
    });
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, testEnv("osm_overpass", impl));
    expect(run.results).toHaveLength(30);
    expect(run.status).toBe("SOURCE_SUCCESS_WITH_WARNINGS");
  });

  it("municipality boundary not found → falls back to geocoder bbox", async () => {
    const { impl, calls } = mockFetch({
      "overpass-api.de": [{ status: 200, body: { elements: [] } }, { status: 200, body: { elements: overpassElements(5) } }],
    });
    const run = await createOverpassSource().search(
      { context: ctx(), expansion, location: null, resolveLocation: async () => location },
      testEnv("osm_overpass", impl)
    );
    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[1].body!)).toContain("(-3.75,-40.49,-3.61,-40.3)");
    expect(run.metadata.strategy).toBe("bbox");
    expect(run.results).toHaveLength(5);
  });

  it("skips mirrors whose circuit breaker is OPEN", async () => {
    const breakers = new BreakerRegistry([], { failureThreshold: 1 });
    breakers.recordFailure(mirrorBreakerKey(OVERPASS_ENDPOINTS[0]), { latencyMs: 1, error: "x", kind: "HTTP_5XX", status: "SOURCE_ERROR" });
    const { impl, calls } = mockFetch({ "maps.mail.ru": [{ status: 200, body: withArea(overpassElements(1)) }] });
    const run = await createOverpassSource().search({ context: ctx(), expansion, location: null }, testEnv("osm_overpass", impl, { breakers }));
    expect(calls.every((c) => !c.url.includes("overpass-api.de"))).toBe(true);
    expect(run.results).toHaveLength(1);
  });

  it("parseOverpassElements reports area presence", () => {
    expect(parseOverpassElements([{ type: "area", id: 1 }], { matchedBy: "tag", collectedAt: "" }).areaFound).toBe(true);
  });
});

describe("Nominatim adapter", () => {
  it("picks the municipality relation in the right state", () => {
    const place = pickMunicipality(
      [
        { place_id: 1, osm_type: "node", osm_id: 1, lat: "0", lon: "0", type: "city", addresstype: "city", display_name: "Sobral, Pernambuco", address: { state: "Pernambuco" } },
        { place_id: 2, osm_type: "relation", osm_id: 302610, lat: "-3.8", lon: "-40", type: "administrative", addresstype: "municipality", category: "boundary", display_name: "Sobral, Ceará", address: { state: "Ceará" } },
      ],
      "CE"
    );
    expect(place?.osm_id).toBe(302610);
  });

  it("geocode failure is an ERROR, not 'city not found'", async () => {
    const { impl } = mockFetch({ nominatim: [{ status: 429 }] });
    const out = await nominatimGeo.geocodeCity("Sobral", "CE", testEnv("osm_nominatim", impl));
    expect(out.location).toBeNull();
    expect(out.error?.kind).toBe("RATE_LIMITED");
  });

  it("paginates with exclude_place_ids and filters non-POIs", async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        place_id: start + i,
        osm_type: "node",
        osm_id: start + i,
        lat: "-3.69",
        lon: "-40.35",
        category: i === 0 ? "highway" : "amenity",
        type: "restaurant",
        name: `Rest ${start + i}`,
        display_name: "x",
        address: { road: "Rua A", city: "Sobral", state: "Ceará" },
        extratags: { phone: "(88) 3611-1234" },
      }));
    const { impl, calls } = mockFetch({ nominatim: [{ status: 200, body: page(1, 40) }, { status: 200, body: page(100, 10) }] });
    const run = await createNominatimSource().search(
      { context: ctx({ mode: "PRECISE" }), expansion: { ...expansion, textTerms: ["restaurante"] }, location },
      testEnv("osm_nominatim", impl)
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("exclude_place_ids=");
    expect(run.results).toHaveLength(48); // 50 - 2 highways
    expect(run.metadata.invalid).toBe(2);
    expect(run.results[0].phone).toBe("(88) 3611-1234");
    expect(run.results[0].sourceRecordId).toMatch(/^node\//);
  });

  it("without a bbox it reports an error instead of empty results", async () => {
    const { impl } = mockFetch({});
    const run = await createNominatimSource().search({ context: ctx(), expansion, location: null }, testEnv("osm_nominatim", impl));
    expect(run.status).toBe("SOURCE_ERROR");
  });
});

describe("Photon adapter", () => {
  it("maps POI features and ignores streets/places", async () => {
    const feature = (id: number, key: string) => ({
      geometry: { coordinates: [-40.35, -3.69] },
      properties: { osm_id: id, osm_type: "N", osm_key: key, osm_value: "restaurant", name: `P${id}`, city: "Sobral", street: "Rua B" },
    });
    const { impl } = mockFetch({ photon: [{ status: 200, body: { features: [feature(1, "amenity"), feature(2, "highway"), feature(3, "amenity")] } }] });
    const run = await createPhotonSource().search(
      { context: ctx({ mode: "PRECISE" }), expansion: { ...expansion, textTerms: ["restaurante"] }, location },
      testEnv("osm_photon", impl)
    );
    expect(run.results.map((r) => r.sourceRecordId)).toEqual(["node/1", "node/3"]);
    expect(run.metadata.invalid).toBe(1);
  });
});

describe("BrasilAPI CNPJ enrichment", () => {
  it("maps registry fields, formats CNAE, keeps partners", () => {
    const patch = brasilApiToPatch({
      cnpj: "11222333000181",
      razao_social: "RESTAURANTE ARAGAO LTDA",
      nome_fantasia: "Restaurante Aragão",
      descricao_situacao_cadastral: "ATIVA",
      cnae_fiscal: 5611201,
      descricao_tipo_de_logradouro: "RUA",
      logradouro: "CEL JOSE SABOIA",
      numero: "100",
      municipio: "SOBRAL",
      uf: "CE",
      ddd_telefone_1: "8836111234",
      email: "CONTATO@ARAGAO.COM.BR",
      qsa: [{ nome_socio: "FULANO DE TAL", qualificacao_socio: "Sócio-Administrador" }],
    });
    expect(patch.cnae).toBe("5611-2/01");
    expect(patch.street).toBe("RUA CEL JOSE SABOIA");
    expect(patch.phone).toBe("8836111234");
    expect(patch.email).toBe("contato@aragao.com.br");
    expect(patch.partners).toEqual([{ name: "FULANO DE TAL", role: "Sócio-Administrador" }]);
    expect(formatCnae("123")).toBeNull();
  });

  it("404 is NO_RESULTS (not an error); 503 after retries is an error", async () => {
    const company = { cnpj: "11222333000181" } as never;
    const notFound = mockFetch({ brasilapi: [{ status: 404, body: { message: "CNPJ não encontrado" } }] });
    const a = await createBrasilApiSource().enrich(company, testEnv("cnpj_brasilapi", notFound.impl));
    expect(a.status).toBe("NO_RESULTS_FROM_SOURCE");
    const down = mockFetch({ brasilapi: [{ status: 503 }] });
    const b = await createBrasilApiSource().enrich(company, testEnv("cnpj_brasilapi", down.impl));
    expect(b.status).toBe("SOURCE_ERROR");
    expect(down.calls).toHaveLength(3);
  });
});

describe("local DB niche filter", () => {
  it("matches primary OR secondary CNAE and sanitizes keywords", async () => {
    const { buildNicheOrFilter } = await import("./local-db");
    const f = buildNicheOrFilter({ industryId: null, cnaes: ["5611-2/01"], keywords: ["pizza(ria),x"] })!;
    expect(f).toContain('cnae_primary.in.("5611-2/01")');
    expect(f).toContain('cnae_secondary.ov.{"5611-2/01"}');
    expect(f).toContain("trade_name.ilike.*pizza ria x*");
  });
});
