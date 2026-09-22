import { it } from "vitest";

/**
 * LIVE end-to-end check against the real public OSM services (no DB).
 * Opt-in only — it hits external APIs:  DISCOVERY_LIVE=1 npx vitest run src/lib/discovery/live.test.ts
 * Optional: DMODE=BROAD|BALANCED|PRECISE
 */
import { BreakerRegistry } from "./circuit-breaker";
import { normalizeSearchContext } from "./context";
import { runDiscovery } from "./orchestrator";
import { defaultSourceConfigs } from "./registry";
import { createNominatimSource, nominatimGeo } from "./sources/nominatim";
import { createOverpassSource } from "./sources/overpass";
import { createPhotonSource, photonGeo } from "./sources/photon";

it.skipIf(!process.env.DISCOVERY_LIVE)("LIVE Sobral restaurantes", async () => {
  const ctx = normalizeSearchContext({ city: "Sobral", state: "CE", industryKey: "restaurante", sourcesEnabled: ["osm_overpass", "osm_nominatim", "osm_photon"], mode: process.env.DMODE ?? "BALANCED" });
  const breakers = new BreakerRegistry();
  const t0 = Date.now();
  const { response, logs, geoLogs } = await runDiscovery(ctx, {
    sources: { osm_overpass: createOverpassSource(), osm_nominatim: createNominatimSource(), osm_photon: createPhotonSource() },
    geoSources: [nominatimGeo, photonGeo],
    configs: defaultSourceConfigs(),
    breakers,
    emit: (e) => { if (e.type !== "progress") console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s]`, e.type, e.type === "source" ? `${e.source} ${e.status} ${e.returned} ${e.durationMs}ms fb=${e.isFallback}` : e.type === "phase" ? e.message : ""); },
  });
  console.log("outcome", response.outcome, "status", response.status, "duration", response.durationMs);
  console.log("counts", JSON.stringify(response.counts));
  console.log("summary", JSON.stringify(response.summary));
  console.log("funnel", JSON.stringify(response.funnel.map(f => ({ s: f.source, st: f.status, ret: f.returned, inv: f.invalid, dup: f.duplicate, filt: f.filtered, acc: f.accepted, ms: f.durationMs, strat: f.strategy }))));
  console.log("filters", JSON.stringify(response.diagnostics.filters));
  console.log("location", response.diagnostics.locationStrategy.join(" | "), response.diagnostics.location?.displayName);
  console.log("broadening", response.diagnostics.broadeningApplied);
  console.log("messages", response.userMessages);
  console.log("multi-source records", response.results.filter(r => r.sourceKeys.length > 1).length, "possible dups", response.results.filter(r=>r.possibleDuplicates.length).length);
  console.log("sample", response.results.slice(0, 12).map(r => `${r.name} [${r.sourceKeys.join("+")}] ${r.completeness}% ${r.phone ?? ""} ${r.website ?? ""}`).join("\n"));
  const errs = [...geoLogs, ...logs].filter(l => l.errorKind);
  console.log("request errors", errs.map(l => `${l.source} ${l.endpoint} ${l.httpStatus} ${l.errorKind} ${l.attempt}/${l.maxAttempts} ${l.latencyMs}ms`));
  console.log("total requests", logs.length + geoLogs.length);
}, 120000);
