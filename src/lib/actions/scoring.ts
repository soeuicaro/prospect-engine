import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { computeProspectScore, computeDataQualityScore, type CompanySignals } from "@/lib/domain/scoring";

/**
 * Recomputes and persists the Prospect Score + factor evidence trail for one
 * company. Called after create/import/enrichment and from the manual
 * "Refresh Lead" action. Never called for a company outside the caller's
 * workspace — the caller must have already verified access (RLS also
 * protects this at the DB layer since we still go through the RLS-bound
 * client, not the admin client).
 */
export async function recomputeCompanyScore(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyId: string
) {
  const [{ data: company }, { data: rules }, { data: weights }, { data: social }, { data: analysis }] =
    await Promise.all([
      supabase
        .from("companies")
        .select(
          "id, website, phone, email, whatsapp, opened_at, estimated_size, tags, industry_id, city, state, cnpj, trade_name, street, last_verified_at"
        )
        .eq("id", companyId)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase.from("scoring_rules").select("*").eq("workspace_id", workspaceId).eq("enabled", true),
      supabase.from("scoring_category_weights").select("*").eq("workspace_id", workspaceId),
      supabase.from("company_social_profiles").select("status").eq("company_id", companyId),
      supabase.from("company_analysis").select("website_flags").eq("company_id", companyId).maybeSingle(),
    ]);

  if (!company) return null;

  let industry: { is_visual_segment: boolean; recurring_need: boolean } | null = null;
  let hasOfferMapped = false;
  if (company.industry_id) {
    const [{ data: industryRow }, { data: playbook }] = await Promise.all([
      supabase
        .from("industries")
        .select("is_visual_segment, recurring_need")
        .eq("id", company.industry_id)
        .maybeSingle(),
      supabase
        .from("industry_playbooks")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("industry_id", company.industry_id)
        .maybeSingle(),
    ]);
    industry = industryRow;
    hasOfferMapped = Boolean(playbook);
  }

  const { count: contactCount } = await supabase
    .from("company_contacts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  const signals: CompanySignals = {
    company,
    industry,
    socialProfiles: social ?? [],
    analysis: analysis ?? null,
    hasOfferMapped,
  };

  const result = computeProspectScore(signals, rules ?? [], weights ?? []);
  const dataQuality = computeDataQualityScore(company, (contactCount ?? 0) > 0, Boolean(analysis));

  await supabase.from("company_scores").upsert(
    {
      workspace_id: workspaceId,
      company_id: companyId,
      digital_presence_score: result.categoryScores.digital_presence,
      content_need_score: result.categoryScores.content_need,
      purchase_capacity_score: result.categoryScores.purchase_capacity,
      marketing_opportunity_score: result.categoryScores.marketing_opportunity,
      fit_score: result.categoryScores.fit,
      size_score: result.categoryScores.size,
      local_proximity_score: result.categoryScores.local_proximity,
      prospect_score: result.prospectScore,
      opportunity_level: result.opportunityLevel,
      rule_version: "v1",
      computed_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  await supabase.from("company_score_factors").delete().eq("company_id", companyId);
  if (result.factors.length) {
    await supabase.from("company_score_factors").insert(
      result.factors.map((f) => ({
        workspace_id: workspaceId,
        company_id: companyId,
        factor_key: f.factor_key,
        factor_label: f.factor_label,
        category: f.category,
        points: f.points,
        evidence: f.evidence,
        confidence: f.confidence,
      }))
    );
  }

  await supabase.from("companies").update({ data_quality_score: dataQuality }).eq("id", companyId);

  return result;
}
