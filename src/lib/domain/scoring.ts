import type {
  Company,
  CompanySocialProfile,
  CompanyAnalysis,
  Industry,
  ScoringRule,
  ScoringCategoryWeight,
  ScoringCategory,
} from "@/types/database";

/**
 * Prospect Score engine.
 *
 * Design principle (see PROMPT MASTER §67-68): weights and point values are
 * fully configurable per workspace via `scoring_rules` /
 * `scoring_category_weights`. What is NOT configurable from the UI is *which
 * signals exist* — that lives here, in code, as named evaluators keyed by
 * `scoring_rules.key`. Adding a genuinely new signal type is a code change;
 * tuning how much it matters is a Settings change.
 *
 * A signal that cannot be verified must NEVER be treated as a negative
 * fact. Evaluators only fire on positive evidence of a condition; absence of
 * evidence yields `fires: false`, not an assumption.
 */

export interface CompanySignals {
  company: Pick<
    Company,
    | "website"
    | "phone"
    | "email"
    | "whatsapp"
    | "opened_at"
    | "estimated_size"
    | "tags"
    | "industry_id"
    | "city"
    | "state"
  >;
  industry: Pick<Industry, "is_visual_segment" | "recurring_need"> | null;
  socialProfiles: Pick<CompanySocialProfile, "status">[];
  analysis: Pick<CompanyAnalysis, "website_flags"> | null;
  hasOfferMapped: boolean;
}

interface RuleEvaluation {
  fires: boolean;
  evidence: string;
}

type RuleEvaluator = (signals: CompanySignals) => RuleEvaluation;

const RULE_EVALUATORS: Record<string, RuleEvaluator> = {
  no_website: (s) => ({
    fires: !s.company.website,
    evidence: s.company.website ? "Website identificado" : "Nenhum website identificado nas fontes disponíveis",
  }),
  weak_social_presence: (s) => {
    const found = s.socialProfiles.filter((p) => p.status === "FOUND").length;
    const fires = s.company.website ? found === 0 : found <= 1;
    return {
      fires,
      evidence: found === 0
        ? "Nenhuma rede social encontrada"
        : `${found} rede(s) social(is) encontrada(s), abaixo do esperado`,
    };
  },
  visual_segment: (s) => ({
    fires: Boolean(s.industry?.is_visual_segment),
    evidence: "Segmento com alta dependência de conteúdo visual",
  }),
  recurring_content_need: (s) => ({
    fires: Boolean(s.industry?.recurring_need),
    evidence: "Segmento com necessidade recorrente de conteúdo",
  }),
  local_business: (s) => ({
    fires: Boolean(s.company.city && s.company.state) && s.company.estimated_size !== "GRANDE_REGIONAL",
    evidence: "Negócio de atuação local",
  }),
  multi_unit: (s) => ({
    fires: s.company.tags.includes("MULTI_UNIT") || s.company.estimated_size === "MEDIA" || s.company.estimated_size === "GRANDE_REGIONAL",
    evidence: "Sinais de múltiplas unidades/regionalidade",
  }),
  new_business: (s) => {
    if (!s.company.opened_at) return { fires: false, evidence: "Data de abertura desconhecida" };
    const monthsSinceOpen =
      (Date.now() - new Date(s.company.opened_at).getTime()) / (1000 * 60 * 60 * 24 * 30);
    return {
      fires: monthsSinceOpen <= 12,
      evidence: monthsSinceOpen <= 12 ? "Empresa aberta há menos de 12 meses" : "Empresa não é recente",
    };
  },
  business_contact_available: (s) => ({
    fires: Boolean(s.company.phone || s.company.email || s.company.whatsapp),
    evidence: "Possui ao menos um canal de contato empresarial",
  }),
  high_offer_fit: (s) => ({
    fires: Boolean(s.company.industry_id) && s.hasOfferMapped,
    evidence: "Nicho com oferta e playbook mapeados",
  }),
  weak_marketing_signals: (s) => {
    const flags = s.analysis?.website_flags ?? [];
    const negativeFlags = flags.filter((f) =>
      ["WEBSITE_OUTDATED", "LOW_CONTENT_SIGNAL", "MISSING_CTA", "MISSING_SOCIAL", "NO_SOCIAL_LINKS"].includes(f)
    );
    return {
      fires: negativeFlags.length >= 2,
      evidence: negativeFlags.length ? `Sinais fracos: ${negativeFlags.join(", ")}` : "Sem sinais fracos detectados",
    };
  },
};

export interface ScoreFactorResult {
  factor_key: string;
  factor_label: string;
  category: ScoringCategory;
  points: number;
  evidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface ScoreResult {
  categoryScores: Record<ScoringCategory, number>;
  prospectScore: number;
  opportunityLevel: "MUITO_ALTO" | "ALTO" | "MEDIO" | "BAIXO";
  factors: ScoreFactorResult[];
}

const ALL_CATEGORIES: ScoringCategory[] = [
  "digital_presence",
  "content_need",
  "purchase_capacity",
  "marketing_opportunity",
  "fit",
  "size",
  "local_proximity",
];

export function computeProspectScore(
  signals: CompanySignals,
  rules: ScoringRule[],
  categoryWeights: ScoringCategoryWeight[]
): ScoreResult {
  const factors: ScoreFactorResult[] = [];
  const categoryEarned: Record<string, number> = {};
  const categoryMax: Record<string, number> = {};

  for (const cat of ALL_CATEGORIES) {
    categoryEarned[cat] = 0;
    categoryMax[cat] = 0;
  }

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const evaluator = RULE_EVALUATORS[rule.key];
    if (!evaluator) continue; // unknown key: configurable but no code evaluator yet

    const maxPoints = rule.points * rule.weight;
    categoryMax[rule.category] = (categoryMax[rule.category] ?? 0) + maxPoints;

    const { fires, evidence } = evaluator(signals);
    if (fires) {
      const earned = rule.points * rule.weight;
      categoryEarned[rule.category] = (categoryEarned[rule.category] ?? 0) + earned;
      factors.push({
        factor_key: rule.key,
        factor_label: rule.label,
        category: rule.category,
        points: earned,
        evidence,
        confidence: "MEDIUM",
      });
    }
  }

  const categoryScores = {} as Record<ScoringCategory, number>;
  for (const cat of ALL_CATEGORIES) {
    const max = categoryMax[cat] ?? 0;
    categoryScores[cat] = max > 0 ? Math.round((categoryEarned[cat] / max) * 100) : 0;
  }

  const weightByCategory = new Map(categoryWeights.map((w) => [w.category, w.weight]));
  const totalWeight = categoryWeights.reduce((sum, w) => sum + w.weight, 0) || 1;

  let weightedSum = 0;
  for (const cat of ALL_CATEGORIES) {
    const weight = weightByCategory.get(cat) ?? 0;
    weightedSum += categoryScores[cat] * weight;
  }
  const prospectScore = Math.round(weightedSum / totalWeight);

  const opportunityLevel: ScoreResult["opportunityLevel"] =
    prospectScore >= 80 ? "MUITO_ALTO" : prospectScore >= 60 ? "ALTO" : prospectScore >= 40 ? "MEDIO" : "BAIXO";

  return { categoryScores, prospectScore, opportunityLevel, factors };
}

/**
 * Data Quality Score (0-100): completeness/verification of the record
 * itself — independent from commercial opportunity.
 */
export function computeDataQualityScore(company: {
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  trade_name: string | null;
  street: string | null;
  city: string | null;
}, hasDecisionMaker: boolean, hasDigitalPresenceChecked: boolean): number {
  let score = 0;
  if (company.cnpj) score += 20;
  if (company.phone) score += 15;
  if (company.email) score += 10;
  if (company.website) score += 15;
  if (company.trade_name) score += 10;
  if (company.street && company.city) score += 10;
  if (hasDecisionMaker) score += 10;
  if (hasDigitalPresenceChecked) score += 10;
  return Math.min(100, score);
}
