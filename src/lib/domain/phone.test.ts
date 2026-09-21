import { describe, expect, it } from "vitest";
import { normalizePhoneBR, isValidEmailFormat, buildWhatsAppLink } from "./phone";

describe("normalizePhoneBR", () => {
  it("parses a mobile number with DDD", () => {
    const result = normalizePhoneBR("(85) 99999-8888");
    expect(result).toEqual({
      original: "(85) 99999-8888",
      normalized: "+5585999998888",
      country_code: "55",
      ddd: "85",
      number: "999998888",
      valid_format: true,
    });
  });

  it("handles a number that already carries the country code", () => {
    const result = normalizePhoneBR("+55 85 99999-8888");
    expect(result?.normalized).toBe("+5585999998888");
    expect(result?.valid_format).toBe(true);
  });

  it("returns null for empty input", () => {
    expect(normalizePhoneBR(null)).toBeNull();
    expect(normalizePhoneBR("")).toBeNull();
  });

  it("flags an implausible number as invalid format without discarding it", () => {
    const result = normalizePhoneBR("123");
    expect(result?.valid_format).toBe(false);
  });
});

describe("isValidEmailFormat", () => {
  it("accepts a well-formed address", () => {
    expect(isValidEmailFormat("contato@empresa.com.br")).toBe(true);
  });

  it("rejects a malformed address", () => {
    expect(isValidEmailFormat("nao-e-email")).toBe(false);
  });
});

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with the normalized digits and encoded message", () => {
    const link = buildWhatsAppLink("(85) 99999-8888", "Olá!");
    expect(link).toBe("https://wa.me/5585999998888?text=Ol%C3%A1!");
  });
});
