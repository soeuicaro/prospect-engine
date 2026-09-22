/**
 * Test helpers (mocked HTTP for OSM/CNPJ/Web adapters). Imported only by
 * *.test.ts files.
 */

import { BreakerRegistry } from "./circuit-breaker";
import type { HttpDeps } from "./http";
import { defaultSourceConfigs, type SourceConfigMap } from "./registry";
import type { SourceEnv } from "./sources/base";
import type { SearchContext, SourceCompany, SourceKey } from "./types";

export type MockReply =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { throws: "network" | "timeout" }
  | ((url: string, init?: RequestInit) => MockReply);

/** fetch() mock: routes by substring of the URL; each route replays its queue (last reply repeats). */
export function mockFetch(routes: Record<string, MockReply[]>) {
  const calls: { url: string; body?: string }[] = [];
  const counters: Record<string, number> = {};
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new TypeError(`no mock for ${url}`);
    const i = counters[key] ?? 0;
    counters[key] = i + 1;
    let reply = routes[key][Math.min(i, routes[key].length - 1)];
    while (typeof reply === "function") reply = reply(url, init);
    if ("throws" in reply) {
      if (reply.throws === "timeout") {
        return new Promise<Response>((_, reject) => {
          if (init?.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
    }
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(body, { status: reply.status, headers: reply.headers });
  }) as typeof fetch;
  return { impl, calls };
}

export const noSleep: HttpDeps["sleep"] = async () => {};

export function fastConfigs(): SourceConfigMap {
  const c = defaultSourceConfigs();
  for (const k of Object.keys(c) as SourceKey[]) {
    c[k] = { ...c[k], rateLimitPerSec: 20, timeoutMs: Math.min(c[k].timeoutMs, 2000) };
  }
  return c;
}

export function testEnv(source: SourceKey, fetchImpl: typeof fetch, overrides: Partial<SourceEnv> = {}): SourceEnv {
  const configs = fastConfigs();
  return {
    signal: new AbortController().signal,
    deadline: Date.now() + 20_000,
    config: configs[source],
    breakers: new BreakerRegistry(),
    http: { fetchImpl, sleep: noSleep, random: () => 0.5 },
    isFallback: false,
    ...overrides,
  };
}

export function ctx(partial: Partial<SearchContext> = {}): SearchContext {
  return {
    city: "Sobral",
    state: "CE",
    country: "BR",
    radiusKm: null,
    neighborhoods: [],
    keywords: [],
    industryKey: "restaurante",
    industryId: null,
    cnaes: [],
    includeRelatedCnaes: false,
    companySize: [],
    cnpjStatus: [],
    limit: 100,
    page: 1,
    sort: "relevance",
    sourcesEnabled: ["local_db", "osm_overpass", "osm_nominatim", "osm_photon"],
    mode: "BALANCED",
    depth: "BALANCED",
    autoEnrichTop: 20,
    expandKeywords: true,
    ...partial,
  };
}

export function rec(partial: Partial<SourceCompany> & Pick<SourceCompany, "source" | "sourceRecordId" | "name">): SourceCompany {
  return {
    sourceUrl: null,
    collectedAt: "2026-09-01T00:00:00.000Z",
    matchedBy: "tag",
    confidence: "MEDIUM",
    city: "Sobral",
    ...partial,
  };
}

export function overpassElements(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    type: "node",
    id: 1000 + offset + i,
    lat: -3.68 + i * 0.001,
    lon: -40.35 + i * 0.001,
    tags: { amenity: "restaurant", name: `Restaurante Teste ${offset + i}`, "addr:street": `Rua ${offset + i}` },
  }));
}
