"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { logAudit } from "@/lib/actions/audit";
import type { ActionState } from "@/lib/actions/companies";
import type { ScoringCategory } from "@/types/database";

export async function updateBusinessProfileAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const businessProfile = {
    commercial_name: String(formData.get("commercial_name") ?? ""),
    description: String(formData.get("description") ?? ""),
    services: String(formData.get("services") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    regions: String(formData.get("regions") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    website: String(formData.get("website") ?? ""),
    instagram: String(formData.get("instagram") ?? ""),
    whatsapp: String(formData.get("whatsapp") ?? ""),
    sender_name: String(formData.get("sender_name") ?? ""),
  };

  const { error } = await supabase
    .from("workspaces")
    .update({
      name: String(formData.get("name") ?? workspace.name),
      city: String(formData.get("city") ?? "") || null,
      state: String(formData.get("state") ?? "") || null,
      tone_of_voice: String(formData.get("tone_of_voice") ?? workspace.tone_of_voice),
      business_profile: businessProfile,
    })
    .eq("id", workspace.id);
  if (error) return { error: "Não foi possível atualizar o perfil do workspace." };

  revalidatePath("/settings");
  return { success: true };
}

export async function updateScoringWeightsAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const categories: ScoringCategory[] = [
    "digital_presence",
    "content_need",
    "purchase_capacity",
    "marketing_opportunity",
    "fit",
    "size",
    "local_proximity",
  ];

  for (const category of categories) {
    const raw = formData.get(`weight_${category}`);
    if (raw === null) continue;
    const weight = Math.max(0, Math.min(1, Number(raw) || 0));
    const { error } = await supabase
      .from("scoring_category_weights")
      .upsert({ workspace_id: workspace.id, category, weight }, { onConflict: "workspace_id,category" });
    if (error) return { error: "Não foi possível salvar os pesos de score." };
  }

  revalidatePath("/settings");
  revalidatePath("/companies");
  return { success: true };
}

export async function updateContactLimitsAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from("workspaces")
    .update({
      contact_limits: {
        max_contacts_per_day: Number(formData.get("max_contacts_per_day")) || 40,
        max_new_contacts_per_day: Number(formData.get("max_new_contacts_per_day")) || 20,
        max_followups_per_day: Number(formData.get("max_followups_per_day")) || 30,
      },
    })
    .eq("id", workspace.id);
  if (error) return { error: "Não foi possível atualizar os limites de contato." };

  revalidatePath("/settings");
  return { success: true };
}

export async function toggleFeatureFlagAction(flag: string, enabled: boolean): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const nextFlags = { ...workspace.feature_flags, [flag]: enabled };
  const { error } = await supabase.from("workspaces").update({ feature_flags: nextFlags }).eq("id", workspace.id);
  if (error) return { error: "Não foi possível atualizar a feature flag." };

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "settings.feature_flag_toggle",
    entityType: "workspace",
    metadata: { flag, enabled },
  });

  revalidatePath("/settings");
  return { success: true };
}
