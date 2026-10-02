import { describe, expect, it } from "vitest";
import { visibilityOf } from "./visibility";

const base = { sourceKeys: ["osm_overpass"], website: null, socials: {}, email: null, web: null, companySize: null, openingHours: null } as Parameters<typeof visibilityOf>[0];

describe("visibilityOf", () => {
  it("scores a bare single-source listing as 0", () => {
    expect(visibilityOf(base)).toEqual({ score: 0, reasons: [] });
  });

  it("adds points for sources, website, socials and size, capped at 100", () => {
    const v = visibilityOf({
      ...base,
      sourceKeys: ["osm_overpass", "places_overture", "local_db", "osm_photon", "osm_nominatim"] as typeof base.sourceKeys,
      website: "https://x.com.br",
      socials: { instagram: "a", facebook: "b", tiktok: "c", youtube: "d", linkedin: "e" },
      email: "a@x.com.br",
      companySize: "DEMAIS",
    });
    expect(v.score).toBe(100);
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("ranks a business with site + Instagram above one without", () => {
    const low = visibilityOf(base).score;
    const high = visibilityOf({ ...base, website: "https://x.com.br", socials: { instagram: "x" } }).score;
    expect(high).toBe(28);
    expect(high).toBeGreaterThan(low);
  });
});
