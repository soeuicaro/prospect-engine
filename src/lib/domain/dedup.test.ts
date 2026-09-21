import { describe, expect, it } from "vitest";
import { evaluateDedup, findBestDedupMatch, type DedupCandidate } from "./dedup";

const base: DedupCandidate = {
  id: "existing-1",
  cnpj: "11222333000181",
  website_domain: "empresa.com.br",
  phone: "+5585999998888",
  email: "contato@empresa.com.br",
  trade_name: "Empresa Exemplo",
  legal_name: "Empresa Exemplo LTDA",
  city: "Sobral",
};

describe("evaluateDedup", () => {
  it("flags identical CNPJ as an exact match", () => {
    const incoming: DedupCandidate = { ...base, id: "new" };
    const result = evaluateDedup(incoming, base);
    expect(result.level).toBe("EXACT_MATCH");
  });

  it("flags identical website domain as an exact match even with different CNPJ", () => {
    const incoming: DedupCandidate = { ...base, id: "new", cnpj: null };
    const result = evaluateDedup(incoming, base);
    expect(result.level).toBe("EXACT_MATCH");
  });

  it("flags matching phone + email (no CNPJ/domain) as a likely match", () => {
    const incoming: DedupCandidate = {
      id: "new",
      cnpj: null,
      website_domain: null,
      phone: base.phone,
      email: base.email,
      trade_name: "Nome Diferente",
      legal_name: null,
      city: "Outra Cidade",
    };
    const result = evaluateDedup(incoming, base);
    expect(result.level).toBe("LIKELY_MATCH");
  });

  it("flags a single weak signal as only a possible duplicate — never auto-merged", () => {
    const incoming: DedupCandidate = {
      id: "new",
      cnpj: null,
      website_domain: null,
      phone: base.phone,
      email: null,
      trade_name: "Nome Diferente",
      legal_name: null,
      city: "Outra Cidade",
    };
    const result = evaluateDedup(incoming, base);
    expect(result.level).toBe("POSSIBLE_DUPLICATE");
  });

  it("reports no match when nothing overlaps", () => {
    const incoming: DedupCandidate = {
      id: "new",
      cnpj: null,
      website_domain: null,
      phone: null,
      email: null,
      trade_name: "Totalmente Diferente",
      legal_name: null,
      city: "Outra Cidade",
    };
    expect(evaluateDedup(incoming, base).level).toBe("NO_MATCH");
  });
});

describe("findBestDedupMatch", () => {
  it("returns null when no existing company matches", () => {
    const incoming: DedupCandidate = { ...base, id: "new", cnpj: null, website_domain: null, phone: null, email: null, trade_name: "X", city: "Y" };
    expect(findBestDedupMatch(incoming, [base])).toBeNull();
  });

  it("prefers the strongest match across multiple candidates", () => {
    const weakMatch: DedupCandidate = { ...base, id: "weak", cnpj: null, website_domain: null, email: null };
    const incoming: DedupCandidate = { ...base, id: "new" };
    const result = findBestDedupMatch(incoming, [weakMatch, base]);
    expect(result?.level).toBe("EXACT_MATCH");
    expect(result?.candidateId).toBe("existing-1");
  });
});
