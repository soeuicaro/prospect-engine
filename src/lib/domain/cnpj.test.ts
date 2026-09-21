import { describe, expect, it } from "vitest";
import { isValidCnpj, normalizeCnpj, formatCnpj, cnpjRoot } from "./cnpj";

describe("cnpj", () => {
  it("validates a known-correct CNPJ check digit", () => {
    // 11.222.333/0001-81 is a commonly used valid-format sample CNPJ.
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("rejects an invalid check digit", () => {
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
  });

  it("rejects repeated-digit sequences", () => {
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });

  it("normalizes formatting away", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("returns null for malformed input", () => {
    expect(normalizeCnpj("123")).toBeNull();
    expect(normalizeCnpj(null)).toBeNull();
  });

  it("formats back to the canonical mask", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("extracts the 8-digit root shared by filiais", () => {
    expect(cnpjRoot("11.222.333/0001-81")).toBe("11222333");
    expect(cnpjRoot("11.222.333/0002-62")).toBe("11222333");
  });
});
