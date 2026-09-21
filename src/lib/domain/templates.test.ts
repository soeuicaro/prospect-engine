import { describe, expect, it } from "vitest";
import { renderTemplate, computeAchievablePersonalizationLevel } from "./templates";

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    const { text, missingVariables } = renderTemplate("Olá, {first_name} da {company_name}!", {
      first_name: "João",
      company_name: "Padaria Central",
    });
    expect(text).toBe("Olá, João da Padaria Central!");
    expect(missingVariables).toEqual([]);
  });

  it("never fabricates a value for a variable with no evidence — flags it instead", () => {
    const { text, missingVariables } = renderTemplate("Vi que {observation}.", { observation: null });
    expect(text).toBe("Vi que [observation?].");
    expect(missingVariables).toEqual(["observation"]);
  });

  it("leaves an unknown placeholder untouched and reports it as missing", () => {
    const { text, missingVariables } = renderTemplate("Olá {unknown_var}", {});
    expect(text).toBe("Olá {unknown_var}");
    expect(missingVariables).toEqual(["unknown_var"]);
  });
});

describe("computeAchievablePersonalizationLevel", () => {
  it("returns 0 with no evidence at all", () => {
    expect(computeAchievablePersonalizationLevel({})).toBe(0);
  });

  it("returns 4 only when name, company, industry, observation and content idea are all present", () => {
    expect(
      computeAchievablePersonalizationLevel({
        first_name: "João",
        company_name: "Padaria Central",
        industry: "Restaurante",
        observation: "o Instagram está parado há meses",
        content_idea: "Bastidores da cozinha",
      })
    ).toBe(4);
  });

  it("does not overclaim level 4 when the content idea is missing", () => {
    expect(
      computeAchievablePersonalizationLevel({
        first_name: "João",
        company_name: "Padaria Central",
        industry: "Restaurante",
        observation: "o Instagram está parado há meses",
      })
    ).toBe(3);
  });
});
