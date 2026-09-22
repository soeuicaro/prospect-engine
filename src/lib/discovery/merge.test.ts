import { describe, expect, it } from "vitest";
import { mergeSourceCompanies } from "./merge";
import { applyEnrichment } from "./enrich";
import { rec } from "./testing";

describe("multi-source merge / dedup", () => {
  it("same restaurant from CNPJ base + OSM + Nominatim → 1 company, 3 sources", () => {
    const { companies, duplicateRecords } = mergeSourceCompanies(
      [
        rec({
          source: "local_db",
          sourceRecordId: "c1",
          companyId: "c1",
          name: "RESTAURANTE ARAGAO LTDA",
          tradeName: "Restaurante Aragão",
          cnpj: "11.222.333/0001-81",
          phone: "(88) 3611-1234",
          street: "Rua Coronel José Sabóia",
          confidence: "HIGH",
          matchedBy: "cnae",
        }),
        rec({ source: "osm_overpass", sourceRecordId: "node/42", name: "Restaurante Aragão", phone: "+55 88 3611-1234", lat: -3.69, lon: -40.35, website: "https://aragao.com.br" }),
        rec({ source: "osm_nominatim", sourceRecordId: "node/42", name: "Restaurante Aragão", matchedBy: "text_search" }),
      ],
      { targetCity: "Sobral" }
    );
    expect(companies).toHaveLength(1);
    expect(duplicateRecords).toBe(2);
    const c = companies[0];
    expect(c.sourceKeys.sort()).toEqual(["local_db", "osm_nominatim", "osm_overpass"]);
    expect(c.companyId).toBe("c1");
    expect(c.discoveryStatus).toBe("EXISTING");
    expect(c.confidence).toBe("HIGH");
  });

  it("merge complements fields and records provenance (CNPJ: name/address/phone + OSM: site/coords/instagram)", () => {
    const [c] = mergeSourceCompanies(
      [
        rec({ source: "local_db", sourceRecordId: "c1", companyId: "c1", name: "Pizzaria Bella Napoli", cnpj: "11222333000181", phone: "88 3611-2222", street: "Av. Dom José", houseNumber: "10", confidence: "HIGH" }),
        rec({ source: "osm_overpass", sourceRecordId: "node/7", name: "Pizzaria Bella Napoli", website: "bellanapoli.com.br", lat: -3.68, lon: -40.34, socials: { instagram: "https://www.instagram.com/bellanapoli" } }),
      ],
      { targetCity: "Sobral" }
    ).companies;
    expect(c.phone).toBe("88 3611-2222");
    expect(c.website).toBe("bellanapoli.com.br");
    expect(c.socials.instagram).toContain("bellanapoli");
    expect(c.lat).toBe(-3.68);
    expect(c.provenance.phone?.source).toBe("local_db");
    expect(c.provenance.website?.source).toBe("osm_overpass");
    expect(c.provenance.coordinates?.source).toBe("osm_overpass");
    expect(c.completeness).toBeGreaterThanOrEqual(70);
  });

  it("conflicting phones are surfaced as a conflict, never silently replaced", () => {
    const [c] = mergeSourceCompanies(
      [
        rec({ source: "local_db", sourceRecordId: "c1", companyId: "c1", name: "Churrascaria Gaúcha", cnpj: "11222333000181", phone: "(88) 3611-0001", website: "gaucha.com.br", confidence: "HIGH" }),
        rec({ source: "osm_overpass", sourceRecordId: "node/9", name: "Churrascaria Gaúcha", phone: "(88) 99999-0002", website: "https://gaucha.com.br/" }),
      ],
      { targetCity: "Sobral" }
    ).companies;
    const conflict = c.conflicts.find((x) => x.field === "phone");
    expect(conflict).toBeDefined();
    expect(conflict!.chosen.source).toBe("local_db");
    expect(conflict!.alternatives[0].value).toBe("(88) 99999-0002");
    expect(c.phones).toHaveLength(2);
    expect(c.qualityLabel).toBe("NEEDS_REVIEW");
    // same domain with different formatting is NOT a conflict
    expect(c.conflicts.some((x) => x.field === "website")).toBe(false);
  });

  it("never merges across cities without evidence (§75)", () => {
    const { companies } = mergeSourceCompanies([
      rec({ source: "local_db", sourceRecordId: "a", companyId: "a", name: "Restaurante Sabor do Sertão", city: "Sobral" }),
      rec({ source: "osm_overpass", sourceRecordId: "node/1", name: "Restaurante Sabor do Sertão", city: "Fortaleza" }),
    ]);
    expect(companies).toHaveLength(2);
  });

  it("never merges two different CNPJs, even with identical names", () => {
    const { companies } = mergeSourceCompanies([
      rec({ source: "local_db", sourceRecordId: "a", companyId: "a", name: "Lanchonete Central", cnpj: "11222333000181" }),
      rec({ source: "local_db", sourceRecordId: "b", companyId: "b", name: "Lanchonete Central", cnpj: "11222333000262" }),
    ]);
    expect(companies).toHaveLength(2);
  });

  it("generic names alone are not a dedup key", () => {
    const { companies } = mergeSourceCompanies([
      rec({ source: "osm_overpass", sourceRecordId: "node/1", name: "Pizzaria", lat: -3.6, lon: -40.3 }),
      rec({ source: "osm_overpass", sourceRecordId: "node/2", name: "Pizzaria", lat: -3.7, lon: -40.4 }),
    ]);
    expect(companies).toHaveLength(2);
  });

  it("similar name + nearby but not exact → MEDIUM possible duplicate (not auto-merged)", () => {
    const { companies } = mergeSourceCompanies([
      rec({ source: "osm_overpass", sourceRecordId: "node/1", name: "Espetinho do Zé Grande", lat: -3.6881, lon: -40.3491 }),
      rec({ source: "osm_photon", sourceRecordId: "node/2", name: "Espetinho do Zé", lat: -3.6883, lon: -40.3493 }),
    ]);
    expect(companies).toHaveLength(2);
    expect(companies[0].possibleDuplicates[0]?.confidence).toBe("MEDIUM");
    expect(companies[0].qualityLabel).toBe("NEEDS_REVIEW");
  });

  it("a local record previously imported from OSM (legacy bare id) matches the OSM element exactly", () => {
    const { companies } = mergeSourceCompanies([
      rec({ source: "local_db", sourceRecordId: "c9", companyId: "c9", name: "Bar do João", linkedRecordIds: ["osm:node/555"] }),
      rec({ source: "osm_overpass", sourceRecordId: "node/555", name: "Bar do Joao Ferreira" }),
    ]);
    expect(companies).toHaveLength(1);
    expect(companies[0].mergeConfidence).toBe("EXACT");
  });

  it("does not lose any company during merge", () => {
    const records = Array.from({ length: 120 }, (_, i) =>
      rec({ source: i % 2 ? "osm_overpass" : "local_db", sourceRecordId: `r${i}`, companyId: i % 2 ? null : `c${i}`, name: `Empresa Única ${i} ${"xyz".repeat(i % 3)}`, lat: -3 - i * 0.01, lon: -40 })
    );
    expect(mergeSourceCompanies(records).companies).toHaveLength(120);
  });
});

describe("enrichment patches", () => {
  it("fills empty fields and keeps a conflicting value as an alternative", () => {
    const [c] = mergeSourceCompanies([rec({ source: "osm_overpass", sourceRecordId: "node/1", name: "Café Aroma", phone: "(88) 3611-9999", website: "cafearoma.com.br" })]).companies;
    applyEnrichment(c, {
      source: "website_discovery",
      status: "SOURCE_SUCCESS",
      fields: { email: "contato@cafearoma.com.br", phone: "(88) 98888-7777", socials: { instagram: "https://instagram.com/cafearoma" } },
      message: null,
      logs: [],
      durationMs: 1,
    });
    expect(c.email).toBe("contato@cafearoma.com.br");
    expect(c.socials.instagram).toBe("https://www.instagram.com/cafearoma");
    // official website outranks the directory for phone (configurable priority)
    expect(c.phone).toBe("(88) 98888-7777");
    expect(c.conflicts.find((x) => x.field === "phone")?.alternatives[0].value).toBe("(88) 3611-9999");
    expect(c.sourceKeys).toContain("website_discovery");
  });

  it("CNPJ enrichment adds partners as decision-maker hints", () => {
    const [c] = mergeSourceCompanies([rec({ source: "local_db", sourceRecordId: "c1", companyId: "c1", name: "Pet Amigo", cnpj: "11222333000181" })]).companies;
    const before = c.completeness;
    applyEnrichment(c, {
      source: "cnpj_brasilapi",
      status: "SOURCE_SUCCESS",
      fields: { legalName: "PET AMIGO LTDA", cnpjStatus: "ATIVA", street: "Rua X" },
      partners: [{ name: "Maria Silva", role: "Sócia" }],
      message: null,
      logs: [],
      durationMs: 1,
    });
    expect(c.hasDecisionMaker).toBe(true);
    expect(c.contacts?.[0].source).toBe("cnpj_brasilapi");
    expect(c.completeness).toBeGreaterThan(before);
  });
});
