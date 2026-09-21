"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import {
  companyCreateSchema,
  noteSchema,
  taskSchema,
  followupSchema,
  suppressionSchema,
} from "@/lib/validations/company";
import { normalizeCnpj } from "@/lib/domain/cnpj";
import { normalizePhoneBR, normalizeEmail } from "@/lib/domain/phone";
import { findBestDedupMatch, type DedupCandidate } from "@/lib/domain/dedup";
import { recomputeCompanyScore } from "@/lib/actions/scoring";
import { logAudit } from "@/lib/actions/audit";

export interface ActionState {
  error?: string;
  success?: boolean;
}

export async function createCompanyAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = companyCreateSchema.safeParse({
    legal_name: formData.get("legal_name") ?? "",
    trade_name: formData.get("trade_name"),
    cnpj: formData.get("cnpj") ?? "",
    industry_id: formData.get("industry_id") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    website: formData.get("website") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    street: formData.get("street") ?? "",
    street_number: formData.get("street_number") ?? "",
    neighborhood: formData.get("neighborhood") ?? "",
    city: formData.get("city"),
    state: formData.get("state"),
    postal_code: formData.get("postal_code") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const input = parsed.data;
  const cnpj = normalizeCnpj(input.cnpj);
  const phone = normalizePhoneBR(input.phone);
  const email = normalizeEmail(input.email);

  // Dedup check against existing companies with a CNPJ/phone/email overlap.
  const { data: existing } = await supabase
    .from("companies")
    .select("id, cnpj, website_domain, phone, email, trade_name, legal_name, city")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  if (existing?.length) {
    const candidate: DedupCandidate = {
      id: "new",
      cnpj,
      website_domain: input.website ? extractDomain(input.website) : null,
      phone: phone?.normalized ?? null,
      email,
      trade_name: input.trade_name,
      legal_name: input.legal_name || null,
      city: input.city,
    };
    const match = findBestDedupMatch(
      candidate,
      existing.map((e) => ({ ...e, id: e.id }))
    );
    if (match && (match.level === "EXACT_MATCH" || match.level === "LIKELY_MATCH")) {
      return {
        error: `Possível empresa duplicada já cadastrada (${match.reasons.join(", ")}). Verifique antes de criar uma nova.`,
      };
    }
  }

  const { data: newStage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("key", "NEW")
    .maybeSingle();

  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      workspace_id: workspace.id,
      legal_name: input.legal_name || null,
      trade_name: input.trade_name,
      cnpj,
      industry_id: input.industry_id || null,
      phone: input.phone || null,
      phone_normalized: phone?.normalized ?? null,
      email,
      website: input.website || null,
      website_domain: input.website ? extractDomain(input.website) : null,
      whatsapp: input.whatsapp || null,
      street: input.street || null,
      street_number: input.street_number || null,
      neighborhood: input.neighborhood || null,
      city: input.city,
      state: input.state.toUpperCase(),
      postal_code: input.postal_code || null,
      pipeline_stage_id: newStage?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !company) {
    return { error: "Não foi possível criar a empresa." };
  }

  await supabase.from("company_sources").insert({
    workspace_id: workspace.id,
    company_id: company.id,
    source_type: "MANUAL",
    source_name: "Cadastro manual",
    confidence: "HIGH",
  });

  await recomputeCompanyScore(supabase, workspace.id, company.id);
  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "company.create",
    entityType: "company",
    entityId: company.id,
  });

  revalidatePath("/companies");
  redirect(`/companies/${company.id}`);
}

function extractDomain(url: string): string | null {
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function changeStageAction(companyId: string, stageId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const { data: company } = await supabase
    .from("companies")
    .select("pipeline_stage_id")
    .eq("id", companyId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!company) return { error: "Empresa não encontrada." };

  const { error: stageError } = await supabase
    .from("companies")
    .update({ pipeline_stage_id: stageId })
    .eq("id", companyId);
  if (stageError) return { error: "Não foi possível mover a empresa de etapa." };

  await supabase.from("lead_stage_history").insert({
    workspace_id: workspace.id,
    company_id: companyId,
    from_stage_id: company.pipeline_stage_id,
    to_stage_id: stageId,
    changed_by: user.id,
  });
  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "company.stage_change",
    entityType: "company",
    entityId: companyId,
    metadata: { from: company.pipeline_stage_id, to: stageId },
  });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/pipeline");
  return { success: true };
}

export async function addNoteAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = noteSchema.safeParse({
    company_id: formData.get("company_id"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase.from("notes").insert({
    workspace_id: workspace.id,
    company_id: parsed.data.company_id,
    author_id: user.id,
    body: parsed.data.body,
  });
  if (error) return { error: "Não foi possível adicionar a nota." };

  revalidatePath(`/companies/${parsed.data.company_id}`);
  return { success: true };
}

export async function addTaskAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = taskSchema.safeParse({
    company_id: formData.get("company_id") ?? "",
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    due_at: formData.get("due_at") ?? "",
    priority: formData.get("priority") ?? "MEDIUM",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspace.id,
    company_id: parsed.data.company_id || null,
    title: parsed.data.title,
    description: parsed.data.description || null,
    due_at: parsed.data.due_at || null,
    priority: parsed.data.priority,
    created_by: user.id,
  });
  if (error) return { error: "Não foi possível criar a tarefa." };

  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}`);
  revalidatePath("/tasks");
  return { success: true };
}

export async function completeTaskAction(taskId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "DONE", completed_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível concluir a tarefa." };
  revalidatePath("/tasks");
  return { success: true };
}

export async function scheduleFollowupAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const parsed = followupSchema.safeParse({
    company_id: formData.get("company_id"),
    follow_up_at: formData.get("follow_up_at"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase.from("followups").insert({
    workspace_id: workspace.id,
    company_id: parsed.data.company_id,
    follow_up_at: new Date(parsed.data.follow_up_at).toISOString(),
    note: parsed.data.note || null,
    follow_up_type: "manual",
  });
  if (error) return { error: "Não foi possível agendar o follow-up." };

  revalidatePath(`/companies/${parsed.data.company_id}`);
  revalidatePath("/followups");
  return { success: true };
}

export async function completeFollowupAction(
  followupId: string,
  status: "DONE" | "NO_RESPONSE" | "INTERESTED" | "OPT_OUT" | "CANCELLED"
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from("followups")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", followupId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível atualizar o follow-up." };

  if (status === "OPT_OUT") {
    const { data: followup } = await supabase
      .from("followups")
      .select("company_id")
      .eq("id", followupId)
      .maybeSingle();
    if (followup) {
      await supabase.from("suppression_list").insert({
        workspace_id: workspace.id,
        company_id: followup.company_id,
        channel: "all",
        reason: "opt_out",
      });
    }
  }

  revalidatePath("/followups");
  return { success: true };
}

export async function suppressCompanyAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = suppressionSchema.safeParse({
    company_id: formData.get("company_id") ?? "",
    contact_id: formData.get("contact_id") ?? "",
    channel: formData.get("channel") ?? "all",
    value: formData.get("value") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase.from("suppression_list").insert({
    workspace_id: workspace.id,
    company_id: parsed.data.company_id || null,
    contact_id: parsed.data.contact_id || null,
    channel: parsed.data.channel,
    value: parsed.data.value || null,
    reason: parsed.data.reason,
    created_by: user.id,
  });
  if (error) return { error: "Não foi possível adicionar a supressão." };

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "suppression.add",
    entityType: "company",
    entityId: parsed.data.company_id || null,
  });

  if (parsed.data.company_id) revalidatePath(`/companies/${parsed.data.company_id}`);
  revalidatePath("/suppression");
  return { success: true };
}

export async function refreshLeadScoreAction(companyId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const result = await recomputeCompanyScore(supabase, workspace.id, companyId);
  if (!result) return { error: "Não foi possível recalcular o score." };
  const { error: verifyError } = await supabase
    .from("companies")
    .update({ last_verified_at: new Date().toISOString() })
    .eq("id", companyId);
  if (verifyError) return { error: "Não foi possível atualizar a data de verificação." };
  revalidatePath(`/companies/${companyId}`);
  return { success: true };
}

export async function validateMapsAction(companyId: string, discrepancy: boolean): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from("companies")
    .update({
      maps_validation_status: discrepancy ? "DISCREPANCY_FOUND" : "VALIDATED_BY_USER",
      maps_last_validated_at: new Date().toISOString(),
    })
    .eq("id", companyId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível validar o endereço." };

  revalidatePath(`/companies/${companyId}`);
  return { success: true };
}

export async function archiveCompanyAction(companyId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", companyId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível arquivar a empresa." };
  revalidatePath("/companies");
  redirect("/companies");
}

export async function softDeleteCompanyAction(companyId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", companyId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível excluir a empresa." };
  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "company.delete",
    entityType: "company",
    entityId: companyId,
  });
  revalidatePath("/companies");
  redirect("/companies");
}
