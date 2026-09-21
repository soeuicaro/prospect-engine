import { describe, expect, it } from "vitest";
import { computeProspectScore, computeDataQualityScore, type CompanySignals } from "./scoring";
import type { ScoringRule, ScoringCategoryWeight } from "@/types/database";

function rule(overrides: Partial<ScoringRule>): ScoringRule {
  return {
    id: overrides.key ?? "id",
    workspace_id: "ws",
    key: "no_website",
    label: "Website ausente",
    category: "digital_presence",
    points: 10,
    weight: 1,
    enabled: true,
    config: {},
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const weights: ScoringCategoryWeight[] = [
  { workspace_id: "ws", category: "digital_presence", weight: 0.5 },
  { workspace_id: "ws", category: "content_need", weight: 0.5 },
];

describe("computeProspectScore", () => {
  it("scores 0 when no rule fires", () => {
    const signals: CompanySignals = {
      company: { website: "https://x.com", phone: "123", email: null, whatsapp: null, opened_at: null, estimated_size: null, tags: [], industry_id: null, city: "Sobral", state: "CE" },
      industry: null,
      socialProfiles: [{ status: "FOUND" }],
      analysis: null,
      hasOfferMapped: false,
    };
    const rules = [rule({ key: "no_website", category: "digital_presence" })];
    const result = computeProspectScore(signals, rules, weights);
    expect(result.prospectScore).toBe(0);
    expect(result.opportunityLevel).toBe("BAIXO");
    expect(result.factors).toEqual([]);
  });

  it("scores 100 in a category when every enabled rule in it fires", () => {
    const signals: CompanySignals = {
      company: { website: null, phone: null, email: null, whatsapp: null, opened_at: null, estimated_size: null, tags: [], industry_id: null, city: "Sobral", state: "CE" },
      industry: null,
      socialProfiles: [],
      analysis: null,
      hasOfferMapped: false,
    };
    const rules = [rule({ key: "no_website", category: "digital_presence" })];
    const result = computeProspectScore(signals, rules, weights);
    expect(result.categoryScores.digital_presence).toBe(100);
    // Only digital_presence has a rule; content_need has no configured rule (max=0) -> stays 0.
    expect(result.prospectScore).toBe(50); // 0.5*100 + 0.5*0
    expect(result.factors).toHaveLength(1);
    expect(result.factors[0].factor_key).toBe("no_website");
  });

  it("never invents a fired rule for an unknown evaluator key", () => {
    const signals: CompanySignals = {
      company: { website: null, phone: null, email: null, whatsapp: null, opened_at: null, estimated_size: null, tags: [], industry_id: null, city: "Sobral", state: "CE" },
      industry: null,
      socialProfiles: [],
      analysis: null,
      hasOfferMapped: false,
    };
    const rules = [rule({ key: "totally_made_up_signal", category: "digital_presence" })];
    const result = computeProspectScore(signals, rules, weights);
    expect(result.factors).toEqual([]);
    expect(result.categoryScores.digital_presence).toBe(0);
  });

  it("ignores disabled rules entirely", () => {
    const signals: CompanySignals = {
      company: { website: null, phone: null, email: null, whatsapp: null, opened_at: null, estimated_size: null, tags: [], industry_id: null, city: "Sobral", state: "CE" },
      industry: null,
      socialProfiles: [],
      analysis: null,
      hasOfferMapped: false,
    };
    const rules = [rule({ key: "no_website", category: "digital_presence", enabled: false })];
    const result = computeProspectScore(signals, rules, weights);
    expect(result.factors).toEqual([]);
  });
});

describe("computeDataQualityScore", () => {
  it("adds up completeness signals without exceeding 100", () => {
    const score = computeDataQualityScore(
      {
        cnpj: "11222333000181",
        phone: "85999998888",
        email: "a@b.com",
        website: "https://a.com",
        trade_name: "Empresa",
        street: "Rua X",
        city: "Sobral",
      },
      true,
      true
    );
    expect(score).toBe(100);
  });

  it("scores 0 for a fully empty record", () => {
    const score = computeDataQualityScore(
      { cnpj: null, phone: null, email: null, website: null, trade_name: null, street: null, city: null },
      false,
      false
    );
    expect(score).toBe(0);
  });
});
