import { describe, expect, it } from "vitest";
import { cleanSocials, emailWebsiteCandidate } from "./batch-enrich";

describe("website from registered e-mail domain", () => {
  it("accepts a business domain that matches the company name", () => {
    expect(emailWebsiteCandidate("contato@pizzariabella.com.br", "PIZZARIA BELLA LTDA")).toBe("https://pizzariabella.com.br");
    expect(emailWebsiteCandidate("adm@aragao.com.br", "Restaurante Aragão")).toBe("https://aragao.com.br");
  });
  it("rejects free-mail, government and unrelated (accountant) domains", () => {
    expect(emailWebsiteCandidate("fulano@gmail.com", "Pizzaria Bella")).toBeNull();
    expect(emailWebsiteCandidate("x@hotmail.com.br", "Pizzaria Bella")).toBeNull();
    expect(emailWebsiteCandidate("x@sobral.ce.gov.br", "Pizzaria Bella")).toBeNull();
    expect(emailWebsiteCandidate("fiscal@contabilidadesilva.com.br", "Pizzaria Bella")).toBeNull();
    expect(emailWebsiteCandidate(null, "Pizzaria Bella")).toBeNull();
  });
});

describe("social links published on the site", () => {
  it("keeps profiles, drops share buttons / posts / plugins", () => {
    const s = cleanSocials({
      instagram: "https://www.instagram.com/p/Cx123",
      facebook: "https://www.facebook.com/sharer/sharer.php?u=x",
      tiktok: "https://www.tiktok.com/@pizzariabella",
      linkedin: "https://www.linkedin.com/company/pizzaria-bella",
    });
    expect(s.instagram).toBeUndefined();
    expect(s.facebook).toBeUndefined();
    expect(s.tiktok).toBe("https://www.tiktok.com/@pizzariabella");
    expect(s.linkedin).toBe("https://www.linkedin.com/company/pizzaria-bella");
    expect(cleanSocials({ instagram: "https://instagram.com/pizzariabella/" }).instagram).toBe("https://www.instagram.com/pizzariabella");
  });
});
