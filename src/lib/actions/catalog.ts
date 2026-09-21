"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { messageTemplateSchema, offerSchema } from "@/lib/validations/campaign";
import { logAudit } from "@/lib/actions/audit";
import type { ActionState } from "@/lib/actions/companies";

export async function createTemplateAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const parsed = messageTemplateSchema.safeParse({
    name: formData.get("name"),
    industry_id: formData.get("industry_id") ?? "",
    stage: formData.get("stage") ?? "first_contact",
    channel: formData.get("channel") ?? "whatsapp",
    subject: formData.get("subject") ?? "",
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase.from("message_templates").insert({
    workspace_id: workspace.id,
    name: parsed.data.name,
    industry_id: parsed.data.industry_id || null,
    stage: parsed.data.stage,
    channel: parsed.data.channel,
    subject: parsed.data.subject || null,
    body: parsed.data.body,
  });
  if (error) return { error: "Não foi possível criar o template." };

  revalidatePath("/templates");
  return { success: true };
}

export async function createOfferAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const parsed = offerSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    offer_type: formData.get("offer_type") ?? "recurring",
    industry_id: formData.get("industry_id") ?? "",
    argument: formData.get("argument") ?? "",
    ticket_min: formData.get("ticket_min") || undefined,
    ticket_max: formData.get("ticket_max") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase.from("offers").insert({
    workspace_id: workspace.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    offer_type: parsed.data.offer_type,
    industry_id: parsed.data.industry_id || null,
    argument: parsed.data.argument || null,
    ticket_min: parsed.data.ticket_min ?? null,
    ticket_max: parsed.data.ticket_max ?? null,
  });
  if (error) return { error: "Não foi possível criar a oferta." };

  revalidatePath("/offers");
  return { success: true };
}

export async function toggleOfferActiveAction(offerId: string, active: boolean): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from("offers")
    .update({ active })
    .eq("id", offerId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível atualizar a oferta." };
  revalidatePath("/offers");
  return { success: true };
}

export async function createIndustryAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Nome do nicho é obrigatório." };
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const keywords = String(formData.get("keywords") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const painPoints = String(formData.get("pain_points") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const { error } = await supabase.from("industries").insert({
    workspace_id: workspace.id,
    name,
    slug,
    keywords,
    pain_points: painPoints,
    is_visual_segment: formData.get("is_visual_segment") === "on",
    recurring_need: formData.get("recurring_need") === "on",
  });

  if (error) return { error: "Não foi possível criar o nicho (nome já existe?)." };

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "industry.create",
    entityType: "industry",
  });

  revalidatePath("/settings");
  return { success: true };
}
