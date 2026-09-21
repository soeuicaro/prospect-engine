import "server-only";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export async function getCompanyDetail(workspaceId: string, companyId: string) {
  const supabase = await createClient();

  const { data: company } = await supabase
    .from("companies")
    .select("*, industries(id, name), pipeline_stages(id, key, label, color)")
    .eq("id", companyId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!company) notFound();

  const [
    contacts,
    sources,
    social,
    analysis,
    scores,
    scoreFactors,
    notes,
    tasks,
    followups,
    stageHistory,
    outreachHistory,
    suppression,
    allStages,
    industryPlaybook,
    offers,
    contentIdeas,
    templates,
  ] = await Promise.all([
    supabase
      .from("company_contacts")
      .select("*")
      .eq("company_id", companyId)
      .order("channel_priority"),
    supabase.from("company_sources").select("*").eq("company_id", companyId).order("collected_at", { ascending: false }),
    supabase.from("company_social_profiles").select("*").eq("company_id", companyId),
    supabase.from("company_analysis").select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("company_scores").select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("company_score_factors").select("*").eq("company_id", companyId).order("points", { ascending: false }),
    supabase.from("notes").select("*, profiles(full_name)").eq("company_id", companyId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("company_id", companyId).order("due_at"),
    supabase.from("followups").select("*").eq("company_id", companyId).order("follow_up_at"),
    supabase
      .from("lead_stage_history")
      .select("*, from:pipeline_stages!lead_stage_history_from_stage_id_fkey(label), to:pipeline_stages!lead_stage_history_to_stage_id_fkey(label)")
      .eq("company_id", companyId)
      .order("changed_at", { ascending: false }),
    supabase.from("lead_outreach").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    supabase.from("suppression_list").select("*").eq("company_id", companyId),
    supabase.from("pipeline_stages").select("id, key, label, color, position").eq("workspace_id", workspaceId).order("position"),
    company.industry_id
      ? supabase.from("industry_playbooks").select("*").eq("workspace_id", workspaceId).eq("industry_id", company.industry_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("offers").select("*").eq("workspace_id", workspaceId).eq("active", true),
    company.industry_id
      ? supabase.from("content_ideas").select("*").eq("workspace_id", workspaceId).eq("industry_id", company.industry_id)
      : Promise.resolve({ data: [] }),
    supabase
      .from("message_templates")
      .select("id, name, channel, subject, body, industry_id, stage")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .or(company.industry_id ? `industry_id.eq.${company.industry_id},industry_id.is.null` : "industry_id.is.null"),
  ]);

  return {
    company,
    contacts: contacts.data ?? [],
    sources: sources.data ?? [],
    social: social.data ?? [],
    analysis: analysis.data ?? null,
    scores: scores.data ?? null,
    scoreFactors: scoreFactors.data ?? [],
    notes: notes.data ?? [],
    tasks: tasks.data ?? [],
    followups: followups.data ?? [],
    // lead_stage_history references pipeline_stages twice without configured
    // FK metadata in our hand-authored types — cast narrowly at the call site.
    stageHistory: (stageHistory.data ?? []) as unknown as {
      id: string;
      changed_at: string;
      note: string | null;
      from: { label: string } | null;
      to: { label: string } | null;
    }[],
    outreachHistory: outreachHistory.data ?? [],
    suppression: suppression.data ?? [],
    allStages: allStages.data ?? [],
    industryPlaybook: industryPlaybook.data ?? null,
    offers: offers.data ?? [],
    contentIdeas: contentIdeas.data ?? [],
    templates: templates.data ?? [],
  };
}

export type CompanyDetail = Awaited<ReturnType<typeof getCompanyDetail>>;
