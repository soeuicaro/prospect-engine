/**
 * Lead qualification: UnifiedCompany → LeadQualification.
 *
 *   validation  (closed / excluded / generic name / no minimum data)
 *   segment     (segments.ts — CONFIRMED by CNAE/OSM/Overture, or INFERRED by name)
 *   signals     (evidence the data actually shows — never assumed)
 *   score       (7 dimensions, each item explains its points)
 *   confidence  (5 levels, each factor listed)
 *   tags + reasons + why_this_lead
 *
 * Pure and deterministic: same input + same ICP + same `now` → same output.
 *
 * Honesty rules baked in:
 * - A missing value is UNKNOWN and earns nothing; it is never guessed.
 * - "Instagram found" is a fact; "Instagram active / posts often" is NOT
 *   measured (no permitted API) and is never claimed — see alerts.
 * - Contact fields are CONFIRMED (a source published them) or UNKNOWN.
 *   The only INFERRED contact is one taken from a website whose domain
 *   does not match the business name, and it is flagged.
 */

import { domainMatchesName, foldText, normalizeBusinessName, phoneKey, significantTokens, websiteDomain, haversineMeters } from "../normalize";
import { sourceLabel } from "../registry";
import type {
  DataStatus,
  LeadConfidence,
  LeadQualification,
  LeadSignal,
  QualificationSummary,
  ScoreDimension,
  ScoreDimensionResult,
  ScoreItem,
  SourceKey,
  UnifiedCompany,
} from "../types";
import type { IcpConfig } from "./icp";
import { exclusionReason, isGenericName, resolveSegment, searchableText, type SegmentMatch } from "./segments";

export const QUALIFICATION_VERSION = 1;

const DAY = 86_400_000;
const ENRICHMENT_ONLY: SourceKey[] = ["cnpj_brasilapi", "website_discovery", "google_maps"];
const GENERIC_EMAIL_HOSTS = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br", "live.com", "icloud.com", "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br", "msn.com"]);
const CLOSED_CNPJ = new Set(["BAIXADA", "INAPTA", "NULA"]);
const CLOSED_OPERATING = new Set(["closed", "permanently_closed"]);
const CONFIDENCE_ORDER: LeadConfidence[] = ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"];

export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  fit: "Fit com o ICP",
  visual_need: "Necessidade audiovisual",
  digital_presence: "Presença digital",
  opportunity: "Oportunidade",
  contactability: "Contato",
  data_quality: "Qualidade dos dados",
  recency: "Recência",
};

export const CONFIDENCE_LABELS: Record<LeadConfidence, string> = {
  VERY_LOW: "muito baixa",
  LOW: "baixa",
  MEDIUM: "média",
  HIGH: "alta",
  VERY_HIGH: "muito alta",
};

export function confidenceRank(c: LeadConfidence): number {
  return CONFIDENCE_ORDER.indexOf(c) + 1;
}

export interface QualifyOptions {
  icp: IcpConfig;
  now?: number;
  /** The niche the user searched (catalog key) — tie-breaker for segment resolution. */
  searchIndustry?: string | null;
  /** Units of the same brand in the result set (qualifyAll computes it). */
  locationCount?: number;
}

// ---------------------------------------------------------------------------
// Dimension builder
// ---------------------------------------------------------------------------

/** Items are added as FRACTIONS of the dimension (0..1); points are scaled to the ICP weight. */
class Dimension {
  items: { key: string; label: string; frac: number; status: Exclude<DataStatus, "UNKNOWN">; evidence: string }[] = [];
  constructor(
    readonly dimension: ScoreDimension,
    readonly max: number
  ) {}
  add(key: string, label: string, frac: number, status: Exclude<DataStatus, "UNKNOWN">, evidence: string) {
    if (frac !== 0) this.items.push({ key, label, frac, status, evidence });
    return this;
  }
  result(): ScoreDimensionResult {
    const raw = this.items.reduce((n, i) => n + i.frac, 0);
    const frac = Math.max(0, Math.min(1, raw));
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const items: ScoreItem[] = this.items.map((i) => ({ key: i.key, label: i.label, points: round1(i.frac * this.max), status: i.status, evidence: i.evidence }));
    return { dimension: this.dimension, label: DIMENSION_LABELS[this.dimension], points: round1(frac * this.max), max: this.max, items };
  }
}

const ageDays = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null;
};

function monthsSince(iso: string | null | undefined, now: number): number | null {
  const d = ageDays(iso, now);
  return d === null ? null : d / 30.44;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function discoverySources(c: UnifiedCompany): SourceKey[] {
  return c.sourceKeys.filter((s) => !ENRICHMENT_ONLY.includes(s));
}

function fieldSource(c: UnifiedCompany, field: keyof UnifiedCompany["provenance"]): SourceKey | null {
  return c.provenance[field]?.source ?? (c.sourceKeys[0] ?? null);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validationFailure(c: UnifiedCompany, icp: IcpConfig, seg: SegmentMatch): LeadQualification["disqualified"] {
  const v = icp.validation;
  if (v.dropClosed) {
    if (c.operatingStatus && CLOSED_OPERATING.has(c.operatingStatus)) return { rule: "closed", reason: `Fonte indica estabelecimento fechado (${c.operatingStatus})` };
    if (c.cnpjStatus && CLOSED_CNPJ.has(c.cnpjStatus)) return { rule: "closed", reason: `CNPJ com situação ${c.cnpjStatus}` };
  }
  if (v.dropExcluded) {
    const why = exclusionReason(c, icp, seg.segment);
    if (why) return { rule: "excluded", reason: why };
  }
  if (v.dropGenericNames && isGenericName(c.name)) return { rule: "generic_name", reason: `Nome genérico, não identifica um negócio ("${c.name}")` };
  if (v.requireMinimumData) {
    const anyContact = Boolean(c.phone || c.whatsapp || c.email || c.website || Object.values(c.socials).some(Boolean));
    if (!anyContact && !c.street) return { rule: "insufficient_data", reason: "Sem nenhum canal de contato e sem endereço" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Qualification of one lead
// ---------------------------------------------------------------------------

export function qualifyLead(c: UnifiedCompany, opts: QualifyOptions): LeadQualification {
  const { icp } = opts;
  const now = opts.now ?? Date.now();
  const W = icp.weights;
  const seg = resolveSegment(c, icp, opts.searchIndustry);
  const disqualified = validationFailure(c, icp, seg);
  const signals: LeadSignal[] = [];
  const signal = (key: string, label: string, status: Exclude<DataStatus, "UNKNOWN">, evidence: string, source: LeadSignal["source"]) =>
    signals.push({ key, label, status, evidence, source });
  const alerts: string[] = [];
  const tags = new Set<string>(seg.tags);
  const text = searchableText(c);
  const segStatus: Exclude<DataStatus, "UNKNOWN"> = seg.status === "CONFIRMED" ? "CONFIRMED" : "INFERRED";

  // ---- FIT -----------------------------------------------------------------
  const fit = new Dimension("fit", W.fit);
  fit.add(
    "segment_fit",
    seg.segment ? `Segmento ${seg.label}${seg.subcategory ? ` / ${seg.subcategory}` : ""}` : "Segmento não identificado",
    (seg.rule.fit / 100) * 0.85,
    segStatus,
    seg.segment ? `fit ${seg.rule.fit}/100 no ICP (${seg.evidence})` : `regra padrão do ICP (fit ${seg.rule.fit})`
  );
  if (seg.rule.ticket === "HIGH") fit.add("ticket", "Ticket potencial alto", 0.15, segStatus, "definido no ICP para o segmento");
  else if (seg.rule.ticket === "MEDIUM") fit.add("ticket", "Ticket potencial médio", 0.08, segStatus, "definido no ICP para o segmento");
  if (c.companySize && icp.sizeAdjustments[c.companySize] != null) {
    const adj = icp.sizeAdjustments[c.companySize];
    fit.add("company_size", `Porte ${c.companySize}`, adj / 100, "CONFIRMED", `ajuste de porte do ICP: ${adj > 0 ? "+" : ""}${adj}`);
  }
  if (seg.rule.ticket === "HIGH") tags.add("high_ticket");
  if (seg.status === "INFERRED") alerts.push(`Segmento deduzido só pelo nome (${seg.evidence}) — confirme a atividade.`);
  if (!seg.segment) alerts.push("Segmento não identificado nas fontes — avalie manualmente.");

  // ---- VISUAL NEED ------------------------------------------------------------
  const visual = new Dimension("visual_need", W.visual_need);
  visual.add("segment_visual", "Dependência de conteúdo visual do segmento", (seg.rule.visualNeed / 100) * 0.8, segStatus, `necessidade visual ${seg.rule.visualNeed}/100 no ICP`);
  if (seg.rule.recurring) {
    visual.add("recurring", "Necessidade recorrente de conteúdo", 0.1, segStatus, "segmento consome conteúdo todo mês (Reels, posts)");
    tags.add("recurring_content");
  }
  const hasVenue = Boolean(c.street || (c.lat != null && c.lon != null));
  if (hasVenue && seg.rule.visualNeed >= 70) {
    visual.add("venue", "Espaço físico filmável", 0.1, "INFERRED", "endereço físico em segmento visual");
  }
  if (seg.rule.visualNeed >= 80) tags.add("high_visual_potential");

  // ---- DIGITAL PRESENCE -----------------------------------------------------
  const digital = new Dimension("digital_presence", W.digital_presence);
  const s = c.socials;
  const channels: string[] = [];
  if (c.website) {
    channels.push("site");
    digital.add("website", "Website próprio", 0.3, "CONFIRMED", `${websiteDomain(c.website) ?? c.website} (${sourceLabel(fieldSource(c, "website") ?? "local_db")})`);
    signal("has_website", "Website encontrado", "CONFIRMED", c.website, fieldSource(c, "website"));
    tags.add("has_website");
    if (c.web?.status === "ACTIVE") digital.add("website_active", "Site no ar (verificado)", 0.1, "CONFIRMED", `homepage respondeu em ${fmtDate(c.web.analyzedAt)}`);
    else if (c.web && c.web.status !== "ACTIVE") {
      digital.add("website_down", "Site fora do ar", -0.15, "CONFIRMED", `análise do site: ${c.web.status}`);
      alerts.push(`Website não respondeu (${c.web.status}).`);
    }
  }
  const socialPoints: [keyof typeof s, string, number][] = [
    ["instagram", "Instagram", 0.3],
    ["tiktok", "TikTok", 0.15],
    ["youtube", "YouTube", 0.15],
    ["facebook", "Facebook", 0.1],
    ["linkedin", "LinkedIn", 0.05],
  ];
  for (const [net, label, frac] of socialPoints) {
    if (!s[net]) continue;
    channels.push(label);
    digital.add(`has_${net}`, `${label} comercial`, frac, "CONFIRMED", `${s[net]} (${sourceLabel(fieldSource(c, net) ?? "local_db")})`);
    signal(`has_${net}`, `${label} encontrado`, "CONFIRMED", s[net]!, fieldSource(c, net));
    tags.add(`has_${net}`);
  }
  if (channels.length >= 3) {
    digital.add("multichannel", "Presença multicanal", 0.1, "CONFIRMED", channels.join(", "));
    tags.add("strong_digital_presence");
  }
  if (s.instagram) alerts.push("Atividade/frequência do Instagram não é medida (sem API permitida) — confira o perfil antes da abordagem.");
  if (!channels.length) alerts.push("Nenhuma presença digital encontrada nas fontes — menor sinal de investimento em marketing.");

  // ---- OPPORTUNITY ----------------------------------------------------------
  const opp = new Dimension("opportunity", W.opportunity);
  const months = monthsSince(c.openedAt, now);
  if (months !== null && months <= icp.newBusinessMonths) {
    opp.add("new_business", "Empresa nova", 0.4, "CONFIRMED", `aberta em ${fmtDate(c.openedAt!)} (registro CNPJ)`);
    signal("new_business", "Negócio aberto recentemente", "CONFIRMED", `abertura ${fmtDate(c.openedAt!)}`, "cnpj_brasilapi");
    tags.add("new_business");
  }
  const units = opts.locationCount ?? 1;
  if (units >= 2) {
    opp.add("multiple_locations", "Múltiplas unidades", 0.3, "CONFIRMED", `${units} unidades da mesma marca nesta busca`);
    signal("multiple_locations", "Múltiplas unidades", "CONFIRMED", `${units} endereços com o mesmo nome/domínio`, "rule");
    tags.add("multiple_locations");
  }
  const videoChannels = [s.youtube && "YouTube", s.tiktok && "TikTok", c.web?.hasVideo && `vídeo no site (${c.web.videoPlatforms.join(", ") || "player"})`].filter(Boolean) as string[];
  const hasPresence = Boolean(c.website || s.instagram || s.facebook);
  if (videoChannels.length) {
    opp.add("video_active", "Já investe em vídeo", 0.15, "CONFIRMED", videoChannels.join(", "));
    signal("video_active", "Já publica vídeo", "CONFIRMED", videoChannels.join(", "), c.web?.hasVideo ? "website_discovery" : null);
    tags.add("video_active");
  } else if (hasPresence) {
    const analyzed = c.web?.status === "ACTIVE";
    opp.add(
      "video_gap",
      "Presença digital sem vídeo aparente",
      analyzed ? 0.3 : 0.2,
      "INFERRED",
      analyzed ? "sem YouTube/TikTok e sem vídeo na homepage" : "sem YouTube/TikTok nas fontes (site ainda não analisado)"
    );
    signal("low_video_presence", "Sem vídeo aparente", "INFERRED", analyzed ? "homepage analisada sem vídeo; sem YouTube/TikTok" : "sem YouTube/TikTok nas fontes", "rule");
    tags.add("low_video_presence");
    if (seg.rule.visualNeed >= 70) tags.add("needs_video");
  }
  const kwText = `${text} ${foldText((c.web?.opportunityHints ?? []).join(" "))}`;
  const hits = icp.opportunityKeywords.map(foldText).filter((k) => k && kwText.includes(k));
  if (hits.length) {
    opp.add("opportunity_keywords", "Sinais de lançamento/evento", Math.min(0.25, 0.1 * hits.length), "INFERRED", `menciona: ${[...new Set(hits)].slice(0, 4).join(", ")}`);
    signal("opportunity_keywords", "Menciona lançamento/evento/reservas", "INFERRED", [...new Set(hits)].join(", "), c.web?.opportunityHints?.length ? "website_discovery" : "rule");
  }
  if (seg.tags.includes("events")) opp.add("events_segment", "Segmento com eventos", 0.1, segStatus, "eventos geram demanda de cobertura");
  if (seg.tags.includes("launches")) opp.add("launches", "Trabalha com lançamentos", 0.15, "INFERRED", seg.subcategory ?? "subsegmento de lançamentos");

  // ---- CONTACTABILITY -------------------------------------------------------
  const contact = new Dimension("contactability", W.contactability);
  const phoneSrc = c.provenance.phone?.source ?? null;
  const validPhone = Boolean(phoneKey(c.phone));
  if (validPhone) {
    const registry = phoneSrc === "cnpj_brasilapi";
    contact.add("phone", registry ? "Telefone cadastral" : "Telefone comercial", registry ? 0.2 : 0.35, "CONFIRMED", `${c.phone} (${sourceLabel(phoneSrc ?? "local_db")})${registry ? " — pode ser do contador" : ""}`);
  } else if (c.phone) {
    alerts.push(`Telefone em formato inválido: ${c.phone}`);
  }
  if (c.whatsapp) contact.add("whatsapp", "WhatsApp publicado", 0.25, "CONFIRMED", `${c.whatsapp} (${sourceLabel(c.provenance.whatsapp?.source ?? "local_db")})`);
  if (c.email) {
    const host = c.email.split("@")[1]?.toLowerCase() ?? "";
    const siteHost = websiteDomain(c.website);
    const registry = c.provenance.email?.source === "cnpj_brasilapi";
    if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`) || siteHost.endsWith(host))) contact.add("email", "E-mail no domínio da empresa", 0.2, "CONFIRMED", c.email);
    else if (registry) contact.add("email", "E-mail cadastral", 0.05, "CONFIRMED", `${c.email} — cadastro CNPJ, pode ser do contador`);
    else contact.add("email", GENERIC_EMAIL_HOSTS.has(host) ? "E-mail (provedor genérico)" : "E-mail", 0.1, "CONFIRMED", c.email);
  }
  if (s.instagram) contact.add("instagram_dm", "Contato por Instagram (DM)", 0.1, "CONFIRMED", s.instagram);
  if (c.web?.hasContactPage || c.web?.hasCta) contact.add("site_contact", "Site com página/CTA de contato", 0.1, "CONFIRMED", "detectado na homepage");
  if (c.contacts?.length) contact.add("decision_maker", "Responsável identificado (registro público)", 0.05, "CONFIRMED", c.contacts.map((x) => `${x.name}${x.role ? ` (${x.role})` : ""}`).slice(0, 2).join(", "));
  const anyChannel = validPhone || Boolean(c.whatsapp || c.email || s.instagram || s.facebook);
  if (!anyChannel) {
    tags.add("no_contact");
    alerts.push("Nenhum canal de contato comercial público encontrado.");
  }

  // ---- DATA QUALITY ---------------------------------------------------------
  const dq = new Dimension("data_quality", W.data_quality);
  const disc = discoverySources(c);
  const nSrc = disc.length;
  dq.add("sources", `${nSrc} fonte(s) de descoberta`, nSrc >= 3 ? 0.6 : nSrc === 2 ? 0.45 : 0.2, "CONFIRMED", disc.map(sourceLabel).join(" + ") || "—");
  if (nSrc >= 2) tags.add("multi_source");
  if (c.cnpj && c.cnpjStatus === "ATIVA") {
    dq.add("cnpj_active", "CNPJ ativo", 0.15, "CONFIRMED", c.cnpj);
    tags.add("registry_confirmed");
  } else if (c.cnpj) dq.add("cnpj", "CNPJ conhecido", 0.08, "CONFIRMED", `${c.cnpj}${c.cnpjStatus ? ` (${c.cnpjStatus})` : ""}`);
  if (c.street && c.houseNumber) dq.add("address", "Endereço completo", 0.1, "CONFIRMED", [c.street, c.houseNumber].join(", "));
  else if (c.street) dq.add("address", "Logradouro sem número", 0.05, "CONFIRMED", c.street);
  if (c.lat != null && c.lon != null) dq.add("coords", "Coordenadas", 0.05, "CONFIRMED", `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`);
  const domain = websiteDomain(c.website);
  const match = domain ? domainMatchesName(domain, c.name) : null;
  if (match === "HIGH") dq.add("domain_match", "Domínio corresponde ao nome", 0.1, "CONFIRMED", domain!);
  else if (match === "LOW") {
    dq.add("domain_mismatch", "Domínio não corresponde ao nome", -0.15, "INFERRED", domain!);
    alerts.push(`Website ${domain} não parece ser desta empresa — confirme antes de usar.`);
  }
  if (c.conflicts.length) {
    dq.add("conflicts", `${c.conflicts.length} conflito(s) entre fontes`, -Math.min(0.3, 0.1 * c.conflicts.length), "CONFIRMED", c.conflicts.map((x) => x.field).join(", "));
    alerts.push(`Fontes divergem em: ${c.conflicts.map((x) => x.field).join(", ")}.`);
  }
  if (c.possibleDuplicates.some((d) => d.confidence === "MEDIUM")) {
    dq.add("possible_duplicate", "Possível duplicata", -0.1, "INFERRED", c.possibleDuplicates.map((d) => d.name).slice(0, 2).join(", "));
  }

  // ---- RECENCY --------------------------------------------------------------
  const rec = new Dimension("recency", W.recency);
  const verified = ageDays(c.lastVerifiedAt, now);
  const dataAge = ageDays(c.dataAsOf, now);
  if (verified !== null) {
    const frac = verified <= 30 ? 1 : verified <= 90 ? 0.8 : verified <= 180 ? 0.6 : verified <= 365 ? 0.4 : 0.2;
    rec.add("verified", "Última verificação", frac, "CONFIRMED", `${Math.round(verified)} dia(s) atrás`);
  } else if (dataAge !== null) {
    const frac = dataAge <= 90 ? 0.6 : dataAge <= 365 ? 0.4 : 0.1;
    rec.add("data_age", "Idade do dado na fonte", frac, "CONFIRMED", `dado de ${Math.round(dataAge)} dia(s) atrás, não verificado`);
    if (dataAge > 365) alerts.push(`Dado com mais de 1 ano (${Math.round(dataAge)} dias) e nunca verificado.`);
  } else {
    rec.add("listed_now", "Listado agora pela fonte", 0.4, "CONFIRMED", "data da última edição na fonte desconhecida");
  }

  // ---- totals ---------------------------------------------------------------
  const breakdown = [fit, visual, digital, opp, contact, dq, rec].map((d) => d.result());
  const maxTotal = breakdown.reduce((n, d) => n + d.max, 0) || 1;
  const leadScore = Math.round((breakdown.reduce((n, d) => n + d.points, 0) / maxTotal) * 100);

  const { level: confidence, factors: confidenceFactors } = computeLeadConfidence(c, { validPhone, domainMatch: match, now });
  const qualified =
    !disqualified && leadScore >= icp.thresholds.qualifiedMinScore && confidenceRank(confidence) >= confidenceRank(icp.thresholds.minConfidence);
  if (qualified) tags.add("qualified");
  if (seg.segment) tags.add(`segment:${seg.segment}`);

  const reasons = breakdown
    .flatMap((d) => d.items.filter((i) => i.points > 0).map((i) => ({ ...i, dim: d.dimension })))
    .sort((a, b) => b.points - a.points)
    .slice(0, 8)
    .map((i) => `${i.label} (+${i.points}) — ${i.evidence}${i.status === "INFERRED" ? " [inferido]" : ""}`);
  for (const d of breakdown) for (const i of d.items) if (i.points < 0) alerts.push(`${i.label} (${i.points}) — ${i.evidence}`);

  const lead: LeadQualification = {
    version: QUALIFICATION_VERSION,
    segment: seg.segment,
    segmentLabel: seg.segment ? seg.label : null,
    segmentStatus: seg.status,
    segmentEvidence: seg.evidence,
    subcategory: seg.subcategory,
    leadScore,
    scoreBreakdown: breakdown,
    confidence,
    confidenceFactors,
    tags: [...tags].sort(),
    signals,
    qualificationReasons: reasons,
    alerts: [...new Set(alerts)],
    whyThisLead: "",
    qualified,
    disqualified,
    fieldStatus: fieldStatusOf(c, match),
    locationCount: units,
    computedAt: new Date(now).toISOString(),
  };
  lead.whyThisLead = buildWhy(c, lead, seg, channels, videoChannels);
  return lead;
}

// ---------------------------------------------------------------------------
// Confidence (5 levels)
// ---------------------------------------------------------------------------

export function computeLeadConfidence(
  c: UnifiedCompany,
  ctx: { validPhone: boolean; domainMatch: "HIGH" | "MEDIUM" | "LOW" | null; now: number }
): { level: LeadConfidence; factors: string[]; points: number } {
  let p = 0;
  const factors: string[] = [];
  const add = (n: number, why: string) => {
    p += n;
    factors.push(`${n > 0 ? "+" : ""}${n} ${why}`);
  };
  const n = discoverySources(c).length;
  add(n >= 3 ? 4 : n === 2 ? 3 : 1, `${n} fonte(s) independente(s)`);
  if (c.cnpj) add(1, "registro oficial (CNPJ)");
  if (c.web?.status === "ACTIVE") add(2, "site oficial respondeu");
  else if (c.website) add(0.5, "website informado (não verificado)");
  if (ctx.validPhone) add(1, "telefone em formato válido");
  if (c.street && (c.houseNumber || (c.lat != null && c.lon != null))) add(1, "endereço consistente");
  if (ctx.domainMatch === "LOW") add(-1, "domínio não corresponde ao nome");
  if (c.conflicts.length) add(-Math.min(2, c.conflicts.length), "conflitos entre fontes");
  if (n === 1 && c.sources.every((x) => x.matchedBy === "text_search" || x.matchedBy === "name_keyword")) add(-1, "só um resultado de busca textual");
  if (c.possibleDuplicates.some((d) => d.confidence === "MEDIUM")) add(-0.5, "possível duplicata não resolvida");
  const verified = ageDays(c.lastVerifiedAt, ctx.now);
  const dataAge = ageDays(c.dataAsOf, ctx.now);
  if (verified === null && dataAge !== null && dataAge > 730) add(-1, "dado com mais de 2 anos sem verificação");
  const level: LeadConfidence = p < 1.5 ? "VERY_LOW" : p < 3 ? "LOW" : p < 5 ? "MEDIUM" : p < 7 ? "HIGH" : "VERY_HIGH";
  return { level, factors, points: p };
}

// ---------------------------------------------------------------------------
// Field status (CONFIRMED / INFERRED / UNKNOWN)
// ---------------------------------------------------------------------------

function fieldStatusOf(c: UnifiedCompany, domainMatch: "HIGH" | "MEDIUM" | "LOW" | null): LeadQualification["fieldStatus"] {
  const of = (value: string | null | undefined, field: keyof UnifiedCompany["provenance"]) => {
    if (!value) return { status: "UNKNOWN" as const, source: null };
    const src = c.provenance[field]?.source ?? null;
    if (src === "website_discovery" && domainMatch === "LOW") {
      return { status: "INFERRED" as const, source: src, note: "extraído de um site cujo domínio não corresponde ao nome" };
    }
    if (src === "cnpj_brasilapi" && (field === "phone" || field === "email")) {
      return { status: "CONFIRMED" as const, source: src, note: "cadastro CNPJ — pode ser do contador" };
    }
    return { status: "CONFIRMED" as const, source: src };
  };
  return {
    phone: of(c.phone, "phone"),
    whatsapp: of(c.whatsapp, "whatsapp"),
    email: of(c.email, "email"),
    website: of(c.website, "website"),
    instagram: of(c.socials.instagram, "instagram"),
    address: of(c.street, "street"),
    contactName: c.contacts?.length ? { status: "CONFIRMED", source: c.contacts[0].source } : { status: "UNKNOWN", source: null },
  };
}

// ---------------------------------------------------------------------------
// why_this_lead
// ---------------------------------------------------------------------------

const SHORT_DIM: Record<ScoreDimension, string> = {
  fit: "fit",
  visual_need: "necessidade visual",
  digital_presence: "presença digital",
  opportunity: "oportunidade",
  contactability: "contato",
  data_quality: "dados",
  recency: "recência",
};

function buildWhy(c: UnifiedCompany, lead: LeadQualification, seg: SegmentMatch, channels: string[], videoChannels: string[]): string {
  if (lead.disqualified) return `Descartado na validação: ${lead.disqualified.reason}.`;
  const parts: string[] = [];
  const segText = seg.segment
    ? `${seg.label}${seg.subcategory ? ` (${seg.subcategory})` : ""}${seg.status === "INFERRED" ? " — segmento deduzido pelo nome" : ""}`
    : "segmento não identificado";
  parts.push(`Apareceu por ser ${segText}: ${seg.rule.pitch}.`);
  const sig = lead.signals.filter((x) => !x.key.startsWith("has_")).map((x) => `${x.label.toLowerCase()} (${x.evidence})`);
  if (sig.length) parts.push(`Sinais: ${sig.slice(0, 3).join("; ")}.`);
  parts.push(
    channels.length
      ? `Presença digital: ${channels.join(", ")}${videoChannels.length ? "" : ", sem vídeo aparente"}.`
      : "Sem presença digital encontrada."
  );
  const contacts = [c.phone && "telefone", c.whatsapp && "WhatsApp", c.email && "e-mail", c.socials.instagram && "Instagram"].filter(Boolean);
  parts.push(contacts.length ? `Contato público: ${contacts.join(", ")}.` : "Nenhum contato comercial público encontrado.");
  const disc = discoverySources(c).map(sourceLabel);
  parts.push(`Confirmado por ${disc.length} fonte(s) (${disc.join(", ") || "—"}); confiança ${CONFIDENCE_LABELS[lead.confidence]}.`);
  parts.push(
    `Score ${lead.leadScore}/100 = ${lead.scoreBreakdown.map((d) => `${SHORT_DIM[d.dimension]} ${d.points}/${d.max}`).join(" + ")}.`
  );
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Whole result set
// ---------------------------------------------------------------------------

/**
 * Units of the same brand: same business domain, or same normalized name
 * (with a distinctive token) at addresses ≥200 m apart.
 */
export function locationCounts(companies: UnifiedCompany[]): Map<string, number> {
  const groups = new Map<string, UnifiedCompany[]>();
  const add = (k: string, c: UnifiedCompany) => {
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  };
  for (const c of companies) {
    const d = websiteDomain(c.website);
    if (d) add(`d:${d}`, c);
    const n = normalizeBusinessName(c.name);
    if (n && significantTokens(n).length) add(`n:${n}`, c);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Distinct places only: drop members within 200 m of an earlier one.
    const places: UnifiedCompany[] = [];
    for (const c of list) {
      const near = places.some((p) =>
        p.lat != null && p.lon != null && c.lat != null && c.lon != null
          ? haversineMeters({ lat: p.lat, lon: p.lon }, { lat: c.lat, lon: c.lon }) < 200
          : foldText(`${p.street} ${p.houseNumber}`) === foldText(`${c.street} ${c.houseNumber}`)
      );
      if (!near) places.push(c);
    }
    if (places.length < 2) continue;
    for (const c of list) out.set(c.key, Math.max(out.get(c.key) ?? 1, places.length));
  }
  return out;
}

export function qualifyAll(companies: UnifiedCompany[], opts: Omit<QualifyOptions, "locationCount">): UnifiedCompany[] {
  const counts = locationCounts(companies);
  for (const c of companies) c.lead = qualifyLead(c, { ...opts, locationCount: counts.get(c.key) ?? 1 });
  return companies;
}

/** Re-qualify after enrichment, keeping the set-level location count computed at search time. */
export function requalify(c: UnifiedCompany, opts: Omit<QualifyOptions, "locationCount">): UnifiedCompany {
  c.lead = qualifyLead(c, { ...opts, locationCount: c.lead?.locationCount ?? 1 });
  return c;
}

export function summarizeQualification(
  kept: UnifiedCompany[],
  discarded: UnifiedCompany[],
  icp: IcpConfig
): QualificationSummary {
  const leads = kept.filter((c) => c.lead);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  const byConfidence = Object.fromEntries(CONFIDENCE_ORDER.map((k) => [k, 0])) as Record<LeadConfidence, number>;
  for (const c of leads) byConfidence[c.lead!.confidence] += 1;

  const segMap = new Map<string, { label: string; scores: number[]; qualified: number }>();
  const hoodMap = new Map<string, { count: number; qualified: number }>();
  const srcMap = new Map<SourceKey, { scores: number[]; qualified: number }>();
  for (const c of leads) {
    const l = c.lead!;
    const sk = l.segment ?? "_unknown";
    const s = segMap.get(sk) ?? { label: l.segmentLabel ?? "Não identificado", scores: [], qualified: 0 };
    s.scores.push(l.leadScore);
    if (l.qualified) s.qualified += 1;
    segMap.set(sk, s);
    const hood = c.neighborhood?.trim();
    if (hood) {
      const h = hoodMap.get(hood) ?? { count: 0, qualified: 0 };
      h.count += 1;
      if (l.qualified) h.qualified += 1;
      hoodMap.set(hood, h);
    }
    for (const src of new Set(c.sources.map((x) => x.source))) {
      const e = srcMap.get(src) ?? { scores: [], qualified: 0 };
      e.scores.push(l.leadScore);
      if (l.qualified) e.qualified += 1;
      srcMap.set(src, e);
    }
  }
  const discardedByRule: Record<string, number> = {};
  for (const c of discarded) {
    const r = c.lead?.disqualified?.rule ?? "other";
    discardedByRule[r] = (discardedByRule[r] ?? 0) + 1;
  }
  return {
    icpName: icp.name,
    evaluated: leads.length + discarded.length,
    qualified: leads.filter((c) => c.lead!.qualified).length,
    disqualified: discarded.length,
    avgScore: avg(leads.map((c) => c.lead!.leadScore)),
    avgConfidence: avg(leads.map((c) => confidenceRank(c.lead!.confidence))),
    byConfidence,
    bySegment: [...segMap.entries()]
      .map(([segment, v]) => ({ segment, label: v.label, count: v.scores.length, qualified: v.qualified, avgScore: avg(v.scores) }))
      .sort((a, b) => b.qualified - a.qualified || b.count - a.count),
    byNeighborhood: [...hoodMap.entries()]
      .map(([neighborhood, v]) => ({ neighborhood, ...v }))
      .sort((a, b) => b.qualified - a.qualified || b.count - a.count)
      .slice(0, 50),
    bySource: [...srcMap.entries()]
      .map(([source, v]) => ({ source, leads: v.scores.length, qualified: v.qualified, avgScore: avg(v.scores) }))
      .sort((a, b) => b.qualified - a.qualified),
    discardedByRule,
  };
}
