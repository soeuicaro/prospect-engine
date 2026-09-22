import { buildGoogleMapsLinks } from "@/lib/domain/maps";
import { sourceLabel } from "./registry";
import type { UnifiedCompany } from "./types";

/** Flat rows for CSV export (client download and server route share this). */
export function discoveryCsvRows(results: UnifiedCompany[]) {
  return results.map((c) => ({
    nome: c.name,
    razao_social: c.legalName ?? "",
    cnpj: c.cnpj ?? "",
    situacao_cadastral: c.cnpjStatus ?? "",
    categoria: c.category ?? "",
    logradouro: c.street ?? "",
    numero: c.houseNumber ?? "",
    bairro: c.neighborhood ?? "",
    cidade: c.city ?? "",
    uf: c.state ?? "",
    cep: c.postcode ?? "",
    telefone: c.phone ?? "",
    outros_telefones: c.phones.filter((p) => p !== c.phone).join(" | "),
    whatsapp: c.whatsapp ?? "",
    email: c.email ?? "",
    website: c.website ?? "",
    instagram: c.socials.instagram ?? "",
    facebook: c.socials.facebook ?? "",
    tiktok: c.socials.tiktok ?? "",
    linkedin: c.socials.linkedin ?? "",
    latitude: c.lat ?? "",
    longitude: c.lon ?? "",
    fontes: c.sourceKeys.map(sourceLabel).join(" + "),
    confianca: c.confidence,
    completude: c.completeness,
    qualidade: c.qualityLabel,
    conflitos: c.conflicts.map((x) => x.field).join(", "),
    ja_no_banco: c.companyId ? "sim" : "não",
    google_maps: buildGoogleMapsLinks({
      trade_name: c.name,
      street: c.street,
      street_number: c.houseNumber,
      neighborhood: c.neighborhood,
      city: c.city,
      state: c.state,
      latitude: c.lat,
      longitude: c.lon,
    }).searchUrl,
  }));
}
