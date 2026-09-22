import { describe, expect, it } from "vitest";
import { BreakerRegistry } from "./circuit-breaker";
import { runDiscovery, type OrchestratorDeps } from "./orchestrator";
import { emptyMetadata, finalizeRun, type DiscoverySource, type GeoSource } from "./sources/base";
import { createOverpassSource } from "./sources/overpass";
import { ctx, fastConfigs, mockFetch, noSleep, overpassElements, rec } from "./testing";
import type { ResolvedLocation, SourceCompany, SourceKey, SourceRunStatus } from "./types";

const LOCATION: ResolvedLocation = {
  city: "Sobral",
  state: "CE",
  displayName: "Sobral, Ceará",
  lat: -3.69,
  lon: -40.35,
  bbox: { south: -3.8, north: -3.6, west: -40.5, east: -40.2 },
  osmRelationId: 1,
  source: "osm_nominatim",
  confidence: "HIGH",
};

const geo: GeoSource = { key: "osm_nominatim", geocodeCity: async () => ({ location: LOCATION, logs: [], error: null }) };

/** A fake source: returns fixed records or fails with a status, optionally after a delay. */
function fake(
  key: SourceKey,
  behavior: { records?: SourceCompany[]; fail?: SourceRunStatus; throws?: boolean; delayMs?: number; requiresLocation?: boolean },
  calls?: SourceKey[]
): DiscoverySource {
  return {
    key,
    kind: "discovery",
    cost: "FREE",
    requiresLocation: behavior.requiresLocation ?? false,
    capabilities: {} as never,
    isConfigured: () => true,
    async search(_input, env) {
      calls?.push(key);
      const started = Date.now();
      if (behavior.delayMs) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, behavior.delayMs);
          env.signal.addEventListener("abort", () => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      if (behavior.throws) throw new Error("adapter bug");
      if (behavior.fail) {
        return finalizeRun(key, key, {
          results: [],
          metadata: emptyMetadata(key, 100),
          errors: [{ kind: behavior.fail === "SOURCE_RATE_LIMITED" ? "RATE_LIMITED" : behavior.fail === "SOURCE_TIMEOUT" ? "TIMEOUT" : "HTTP_5XX", message: behavior.fail, httpStatus: 500 }],
          logs: [],
          isFallback: env.isFallback,
          startedAt: started,
        });
      }
      return finalizeRun(key, key, { results: behavior.records ?? [], metadata: emptyMetadata(key, 100), logs: [], isFallback: env.isFallback, startedAt: started });
    },
  };
}

const many = (source: SourceKey, n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) =>
    rec({ source, sourceRecordId: `${source}-${offset + i}`, name: `Estabelecimento ${source} número ${offset + i}`, lat: -3.6 - (offset + i) * 0.01, lon: -40.3 })
  );

function deps(sources: Partial<Record<SourceKey, DiscoverySource>>, extra: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return { sources, geoSources: [geo], configs: fastConfigs(), breakers: new BreakerRegistry(), ...extra };
}

describe("Discovery Orchestrator", () => {
  it("TEST CASE OSM FAILURE (500): search continues, fallbacks run, other sources' results kept, warning not fatal", async () => {
    const calls: SourceKey[] = [];
    const { response } = await runDiscovery(
      ctx({ depth: "FAST" }),
      deps(
        {
          local_db: fake("local_db", { records: many("local_db", 30) }, calls),
          osm_overpass: fake("osm_overpass", { fail: "SOURCE_ERROR" }, calls),
          osm_nominatim: fake("osm_nominatim", { records: many("osm_nominatim", 12), requiresLocation: true }, calls),
          osm_photon: fake("osm_photon", { records: many("osm_photon", 5), requiresLocation: true }, calls),
        },
        {}
      )
    );
    expect(calls).toEqual(expect.arrayContaining(["local_db", "osm_overpass", "osm_nominatim", "osm_photon"]));
    expect(response.results.length).toBe(47);
    expect(response.outcome).toBe("SUCCESS_WITH_WARNINGS");
    expect(response.userMessages[0]).toMatch(/instabilidade/);
    expect(response.funnel.find((f) => f.source === "osm_nominatim")?.isFallback).toBe(true);
    expect(response.sourceRuns.find((r) => r.source === "osm_overpass")?.status).toBe("SOURCE_ERROR");
  });

  it("TEST CASE OSM RATE LIMIT: 429 recorded, breaker opens after repeated failures, search never blocks", async () => {
    const breakers = new BreakerRegistry([], { failureThreshold: 2 });
    const d = deps(
      { local_db: fake("local_db", { records: many("local_db", 25) }), osm_overpass: fake("osm_overpass", { fail: "SOURCE_RATE_LIMITED" }) },
      { breakers }
    );
    const first = await runDiscovery(ctx({ sourcesEnabled: ["local_db", "osm_overpass"] }), d);
    expect(first.response.sourceRuns.find((r) => r.source === "osm_overpass")?.status).toBe("SOURCE_RATE_LIMITED");
    await runDiscovery(ctx({ sourcesEnabled: ["local_db", "osm_overpass"] }), d);
    expect(breakers.stateOf("osm_overpass")).toBe("OPEN");
    const third = await runDiscovery(ctx({ sourcesEnabled: ["local_db", "osm_overpass"] }), d);
    expect(third.response.sourceRuns.find((r) => r.source === "osm_overpass")?.status).toBe("SOURCE_CIRCUIT_OPEN");
    expect(third.response.results).toHaveLength(25);
  });

  it("TEST CASE FEW RESULTS: OSM returns 2 → other sources + keyword variations are tried, diagnostics explain", async () => {
    const calls: SourceKey[] = [];
    const { response } = await runDiscovery(
      ctx({ depth: "FAST", limit: 100 }),
      deps({
        local_db: fake("local_db", { records: [] }, calls),
        osm_overpass: fake("osm_overpass", { records: many("osm_overpass", 2) }, calls),
        osm_nominatim: fake("osm_nominatim", { records: many("osm_nominatim", 3), requiresLocation: true }, calls),
        osm_photon: fake("osm_photon", { records: [], requiresLocation: true }, calls),
      })
    );
    // FAST uses primaries only, but a low-yield primary activates its fallback chain
    expect(calls).toContain("osm_nominatim");
    expect(response.results.length).toBe(5);
    expect(response.diagnostics.broadeningApplied.length).toBeGreaterThan(0);
    expect(response.diagnostics.lowResultReasons.join(" ")).toMatch(/Banco local sem empresas/);
    expect(response.suggestions.map((s) => s.kind)).toEqual(expect.arrayContaining(["radius", "keywords", "nearby_cities", "mode"]));
  });

  it("TEST CASE DUPLICATE: same restaurant from 3 sources → 1 company with 3 sources", async () => {
    const { response } = await runDiscovery(
      ctx(),
      deps({
        local_db: fake("local_db", { records: [rec({ source: "local_db", sourceRecordId: "c1", companyId: "c1", name: "Restaurante Aragão", cnpj: "11222333000181", phone: "(88) 3611-1234" })] }),
        osm_overpass: fake("osm_overpass", { records: [rec({ source: "osm_overpass", sourceRecordId: "node/1", name: "Restaurante Aragão", phone: "88 3611 1234", lat: -3.69, lon: -40.35 })] }),
        osm_nominatim: fake("osm_nominatim", { records: [rec({ source: "osm_nominatim", sourceRecordId: "node/1", name: "Restaurante Aragão" })], requiresLocation: true }),
      })
    );
    expect(response.results).toHaveLength(1);
    expect(response.results[0].sourceKeys).toHaveLength(3);
    expect(response.counts.duplicates).toBe(2);
  });

  it("TEST CASE SOURCE DOWN: OSM stack down → CNPJ/local data still returned", async () => {
    const { response } = await runDiscovery(
      ctx(),
      deps({
        local_db: fake("local_db", { records: many("local_db", 40) }),
        osm_overpass: fake("osm_overpass", { fail: "SOURCE_TIMEOUT" }),
        osm_nominatim: fake("osm_nominatim", { fail: "SOURCE_ERROR", requiresLocation: true }),
        osm_photon: fake("osm_photon", { fail: "SOURCE_ERROR", requiresLocation: true }),
      })
    );
    expect(response.results).toHaveLength(40);
    // §50: OSM failing while other sources work is SUCCESS_WITH_WARNING, not an error
    expect(response.outcome).toBe("SUCCESS_WITH_WARNINGS");
    expect(response.userMessages.join(" ")).toMatch(/instabilidade/);
  });

  it("all sources failed → FAILED with an actionable message (not 'no results')", async () => {
    const { response } = await runDiscovery(
      ctx({ sourcesEnabled: ["local_db", "osm_overpass"] }),
      deps({ local_db: fake("local_db", { fail: "SOURCE_ERROR" }), osm_overpass: fake("osm_overpass", { fail: "SOURCE_ERROR" }) })
    );
    expect(response.outcome).toBe("FAILED");
    expect(response.userMessages[0]).toMatch(/Todas as fontes configuradas falharam/);
  });

  it("genuinely no results → NO_RESULTS with expansion suggestions", async () => {
    const { response } = await runDiscovery(ctx({ sourcesEnabled: ["local_db", "osm_overpass"], expandKeywords: false }), deps({ local_db: fake("local_db", {}), osm_overpass: fake("osm_overpass", {}) }));
    expect(response.outcome).toBe("NO_RESULTS");
    expect(response.suggestions.length).toBeGreaterThan(0);
  });

  it("disabled source (config) is not called; a throwing adapter is isolated", async () => {
    const calls: SourceKey[] = [];
    const configs = fastConfigs();
    configs.osm_photon = { ...configs.osm_photon, enabled: false };
    const { response } = await runDiscovery(
      ctx(),
      deps(
        {
          local_db: fake("local_db", { records: many("local_db", 25) }, calls),
          osm_overpass: fake("osm_overpass", { throws: true }, calls),
          osm_photon: fake("osm_photon", { records: many("osm_photon", 5) }, calls),
        },
        { configs }
      )
    );
    expect(calls).not.toContain("osm_photon");
    expect(response.results).toHaveLength(25);
    expect(response.sourceRuns.find((r) => r.source === "osm_overpass")?.status).toBe("SOURCE_ERROR");
  });

  it("FALLBACK TEST: user turns a source off manually → search continues with the rest", async () => {
    const calls: SourceKey[] = [];
    const { response } = await runDiscovery(
      ctx({ sourcesEnabled: ["local_db", "osm_nominatim"] }),
      deps({
        local_db: fake("local_db", { records: many("local_db", 22) }, calls),
        osm_overpass: fake("osm_overpass", { records: many("osm_overpass", 50) }, calls),
        osm_nominatim: fake("osm_nominatim", { records: many("osm_nominatim", 10), requiresLocation: true }, calls),
      })
    );
    expect(calls).not.toContain("osm_overpass");
    expect(response.results).toHaveLength(32);
    expect(response.outcome).toBe("SUCCESS");
  });

  it("global deadline returns partial results instead of hanging", async () => {
    const t0 = Date.now();
    const { response } = await runDiscovery(
      ctx({ sourcesEnabled: ["local_db", "osm_overpass"] }),
      deps({ local_db: fake("local_db", { records: many("local_db", 30) }), osm_overpass: fake("osm_overpass", { records: many("osm_overpass", 5), delayMs: 5000 }) }, { deadlineMs: 300 })
    );
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(response.partialResults).toBe(true);
    expect(response.diagnostics.deadlineHit).toBe(true);
    expect(response.results.length).toBeGreaterThanOrEqual(30);
  });

  it("cancel (abort) keeps what already arrived", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const { response } = await runDiscovery(
      ctx({ sourcesEnabled: ["local_db", "osm_overpass"] }),
      deps({ local_db: fake("local_db", { records: many("local_db", 21) }), osm_overpass: fake("osm_overpass", { records: [], delayMs: 5000 }) }, { signal: controller.signal })
    );
    expect(response.status).toBe("CANCELLED");
    expect(response.results).toHaveLength(21);
  });

  it("visible city filter: other-city records are removed AND counted (never hidden)", async () => {
    const { response } = await runDiscovery(
      ctx({ sourcesEnabled: ["osm_overpass"] }),
      deps({
        osm_overpass: fake("osm_overpass", {
          records: [...many("osm_overpass", 20), rec({ source: "osm_overpass", sourceRecordId: "x", name: "Restaurante Vizinho", city: "Meruoca" })],
        }),
      })
    );
    const f = response.diagnostics.filters.find((x) => x.key === "city");
    expect(f?.removed).toBe(1);
    expect(response.results).toHaveLength(20);
    expect(response.funnel[0].filtered).toBe(1);
  });

  it("does not drop incomplete companies (no phone / no website / no CNPJ)", async () => {
    const bare = Array.from({ length: 25 }, (_, i) => rec({ source: "osm_overpass", sourceRecordId: `n${i}`, name: `Casa de Comida Dona ${i}ª`, city: null, lat: -3.69, lon: -40.35 + i * 0.001 }));
    const { response } = await runDiscovery(ctx({ sourcesEnabled: ["osm_overpass"], mode: "PRECISE" }), deps({ osm_overpass: fake("osm_overpass", { records: bare }) }));
    expect(response.results).toHaveLength(25);
  });

  it("does not cap results at the requested limit (limit is a goal, not a silent cap)", async () => {
    const { response } = await runDiscovery(ctx({ limit: 10, sourcesEnabled: ["local_db"] }), deps({ local_db: fake("local_db", { records: many("local_db", 147) }) }));
    expect(response.results).toHaveLength(147);
    expect(response.coverage.percent).toBe(100);
  });

  it("end-to-end with the real Overpass adapter over a mocked 504 → mirror → results", async () => {
    const { impl } = mockFetch({
      "overpass-api.de": [{ status: 504 }],
      "maps.mail.ru": [{ status: 200, body: { elements: [{ type: "area", id: 1 }, ...overpassElements(25)] } }],
    });
    const { response } = await runDiscovery(
      ctx({ sourcesEnabled: ["osm_overpass"] }),
      deps({ osm_overpass: createOverpassSource() }, { http: { fetchImpl: impl, sleep: noSleep } })
    );
    expect(response.results).toHaveLength(25);
    expect(response.outcome).toBe("SUCCESS");
    expect(response.sourceRuns[0].status).toBe("SOURCE_SUCCESS_WITH_WARNINGS");
  });
});
