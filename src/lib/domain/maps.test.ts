import { describe, expect, it } from "vitest";
import { buildGoogleMapsLinks, buildGoogleMapsSearchUrl } from "./maps";
import { mailtoLink, socialLink, telLink, websiteLink, whatsappLink } from "./contact-links";

describe("Google Maps URL generation (§106, §133)", () => {
  it("company without an official Maps URL still opens via a text query (name + address + city/UF)", () => {
    const l = buildGoogleMapsLinks({ trade_name: "Restaurante Aragão", street: "Rua Cel. José Sabóia", street_number: "100", city: "Sobral", state: "CE" });
    expect(l.strategy).toBe("name_address");
    expect(l.query).toBe("Restaurante Aragão, Rua Cel. José Sabóia 100, Sobral - CE");
    expect(l.searchUrl).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.query)}`);
    expect(l.pinUrl).toBeNull();
  });

  it("name only → name + city", () => {
    const l = buildGoogleMapsLinks({ trade_name: "Pizzaria Bella", city: "Sobral", state: "CE" });
    expect(l.strategy).toBe("name_city");
    expect(l.query).toBe("Pizzaria Bella, Sobral - CE");
  });

  it("falls back to legal name, and offers a coordinates pin when available", () => {
    const l = buildGoogleMapsLinks({ legal_name: "X LTDA", city: "Sobral", state: "CE", latitude: -3.69, longitude: -40.35 });
    expect(l.query).toContain("X LTDA");
    expect(l.pinUrl).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("-3.69,-40.35")}`);
  });

  it("uses coordinates when there is no name/address; ignores 0,0", () => {
    expect(buildGoogleMapsLinks({ latitude: -3.69, longitude: -40.35 }).strategy).toBe("coordinates");
    expect(buildGoogleMapsLinks({ trade_name: "A", latitude: 0, longitude: 0 }).pinUrl).toBeNull();
  });

  it("encodes special characters safely", () => {
    const url = buildGoogleMapsSearchUrl({ trade_name: "Bar & Grill #1", city: "Sobral", state: "CE" });
    expect(url).toContain("Bar%20%26%20Grill%20%231");
  });
});

describe("contact links (§107-111)", () => {
  it("website link only for real sites (not social URLs)", () => {
    expect(websiteLink("aragao.com.br")).toBe("https://aragao.com.br");
    expect(websiteLink("https://instagram.com/aragao")).toBeNull();
    expect(websiteLink("")).toBeNull();
    expect(websiteLink("not a url")).toBeNull();
  });

  it("phone → tel: with E.164", () => {
    expect(telLink("(88) 3611-1234")).toBe("tel:+558836111234");
    expect(telLink("123")).toBeNull();
  });

  it("WhatsApp only for explicit WhatsApp or a mobile number; never for landlines", () => {
    expect(whatsappLink({ whatsapp: "(88) 99999-0000" })?.url).toBe("https://wa.me/5588999990000");
    expect(whatsappLink({ phone: "(88) 99999-0000" })?.source).toBe("mobile_phone");
    expect(whatsappLink({ phone: "(88) 3611-1234" })).toBeNull();
    expect(whatsappLink({ whatsapp: "(88) 99999-0000" }, "Olá")?.url).toContain("?text=Ol%C3%A1");
  });

  it("mailto only for valid e-mails", () => {
    expect(mailtoLink("contato@aragao.com.br")).toBe("mailto:contato@aragao.com.br");
    expect(mailtoLink("contato@")).toBeNull();
  });

  it("social links normalize handles", () => {
    expect(socialLink("instagram", "@aragao")).toBe("https://www.instagram.com/aragao");
    expect(socialLink("linkedin", "https://www.linkedin.com/company/aragao")).toBe("https://www.linkedin.com/company/aragao");
    expect(socialLink("facebook", null)).toBeNull();
  });
});
