/**
 * Data completeness (§22) and record-level quality labels. Missing data is
 * INFORMATION, never a reason to drop a company (§178).
 */

import type { CompletenessLabel, Confidence, UnifiedCompany } from "./types";

export const COMPLETENESS_WEIGHTS = {
  cnpj: 15,
  name: 10,
  address: 15,
  phone: 15,
  email: 10,
  website: 15,
  social: 10,
  decisionMaker: 10,
} as const;

type CompletenessInput = Pick<UnifiedCompany, "cnpj" | "name" | "street" | "city" | "phone" | "whatsapp" | "email" | "website" | "socials" | "hasDecisionMaker">;

export function completenessBreakdown(c: CompletenessInput): Record<keyof typeof COMPLETENESS_WEIGHTS, boolean> {
  return {
    cnpj: Boolean(c.cnpj),
    name: Boolean(c.name),
    address: Boolean(c.street && c.city),
    phone: Boolean(c.phone || c.whatsapp),
    email: Boolean(c.email),
    website: Boolean(c.website),
    social: Object.values(c.socials ?? {}).some(Boolean),
    decisionMaker: Boolean(c.hasDecisionMaker),
  };
}

export function computeCompleteness(c: CompletenessInput): number {
  const b = completenessBreakdown(c);
  let score = 0;
  for (const [k, present] of Object.entries(b) as [keyof typeof COMPLETENESS_WEIGHTS, boolean][]) {
    if (present) score += COMPLETENESS_WEIGHTS[k];
  }
  return score;
}

export function completenessLabel(score: number): CompletenessLabel {
  if (score >= 75) return "COMPLETO";
  if (score >= 45) return "PARCIAL";
  return "FRACO";
}

const CONF_WEIGHT: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function confidenceWeight(c: Confidence): number {
  return CONF_WEIGHT[c];
}

/**
 * Ranking used for default "relevance" order: completeness first, then
 * confidence and corroboration (sources). Documented in DISCOVERY.md.
 */
export function rankScore(c: Pick<UnifiedCompany, "completeness" | "confidence" | "sourceKeys">): number {
  return Math.round(c.completeness * 0.6 + CONF_WEIGHT[c.confidence] * 8 + Math.min(4, c.sourceKeys.length) * 4);
}
