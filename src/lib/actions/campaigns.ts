"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { campaignCreateSchema } from "@/lib/validations/campaign";
import { logAudit } from "@/lib/actions/audit";
import type { ActionState } from "@/lib/actions/companies";

export async function createCampaignAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = campaignCreateSchema.safeParse({
    name: formData.get("name"),
    cities: formData.getAll("cities"),
    state: formData.get("state") ?? "",
    niches: formData.getAll("niches"),
    radius_km: formData.get("radius_km") || undefined,
    min_score: formData.get("min_score") || 0,
    target_count: formData.get("target_count") || undefined,
    offer_id: formData.get("offer_id") ?? "",
    template_id: formData.get("template_id") ?? "",
    sequence_id: formData.get("sequence_id") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const input = parsed.data;
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspace.id,
      name: input.name,
      cities: input.cities,
      state: input.state || null,
      niches: input.niches,
      radius_km: input.radius_km ?? null,
      min_score: input.min_score,
      target_count: input.target_count ?? null,
      offer_id: input.offer_id || null,
      template_id: input.template_id || null,
      sequence_id: input.sequence_id || null,
      status: "DRAFT",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !campaign) return { error: "Não foi possível criar a campanha." };

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "campaign.create",
    entityType: "campaign",
    entityId: campaign.id,
  });

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

/**
 * Populates campaign_leads from matching companies, applying the Campaign
 * Quality Check (§102): excludes suppressed, already-added, and
 * contact-less companies rather than silently including them.
 */
export async function buildCampaignAudienceAction(campaignId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!campaign) return { error: "Campanha não encontrada." };

  let query = supabase
    .from("companies")
    .select("id, phone, email, whatsapp")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .is("archived_at", null);

  if (campaign.cities.length) query = query.in("city", campaign.cities);
  if (campaign.state) query = query.eq("state", campaign.state);
  if (campaign.niches.length) query = query.in("industry_id", campaign.niches);

  const { data: candidates } = await query.limit(campaign.target_count ?? 1000);
  if (!candidates?.length) return { error: "Nenhuma empresa corresponde aos filtros da campanha." };

  const candidateIds = candidates.map((c) => c.id);

  const [{ data: suppressed }, { data: existing }, { data: scores }] = await Promise.all([
    supabase.from("suppression_list").select("company_id").in("company_id", candidateIds),
    supabase.from("campaign_leads").select("company_id").eq("campaign_id", campaignId),
    supabase.from("company_scores").select("company_id, prospect_score").in("company_id", candidateIds),
  ]);

  const suppressedIds = new Set((suppressed ?? []).map((s) => s.company_id));
  const existingIds = new Set((existing ?? []).map((e) => e.company_id));
  const scoreByCompany = new Map((scores ?? []).map((s) => [s.company_id, s.prospect_score]));

  const rowsToInsert = candidates
    .filter((c) => !existingIds.has(c.id))
    .map((c) => {
      let status: "QUEUED" | "SKIPPED_SUPPRESSED" | "SKIPPED_NO_CONTACT" | "SKIPPED_INSUFFICIENT_DATA" = "QUEUED";
      if (suppressedIds.has(c.id)) status = "SKIPPED_SUPPRESSED";
      else if (!c.phone && !c.email && !c.whatsapp) status = "SKIPPED_NO_CONTACT";
      else if ((scoreByCompany.get(c.id) ?? 0) < (campaign.min_score ?? 0)) status = "SKIPPED_INSUFFICIENT_DATA";

      return { workspace_id: workspace.id, campaign_id: campaignId, company_id: c.id, status };
    });

  if (rowsToInsert.length) {
    await supabase.from("campaign_leads").insert(rowsToInsert);
  }

  await supabase.from("campaigns").update({ status: "READY" }).eq("id", campaignId);

  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true };
}

export async function activateCampaignAction(campaignId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  await supabase
    .from("campaigns")
    .update({ status: "ACTIVE" })
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id);

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "campaign.activate",
    entityType: "campaign",
    entityId: campaignId,
  });

  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true };
}
