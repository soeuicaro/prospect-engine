"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { logAudit } from "@/lib/actions/audit";
import type { ActionState } from "@/lib/actions/companies";
import type { MessageChannel, ResponseType } from "@/types/database";

/**
 * Records an ASSISTED outreach attempt (the user sent it manually via
 * WhatsApp Web/mailto — we never send on their behalf) and auto-schedules a
 * follow-up 3 days out, matching the default sales workflow (§35, §246).
 */
export async function recordOutreachAction(input: {
  companyId: string;
  channel: MessageChannel | "manual";
  templateId?: string | null;
  messagePreview: string;
}): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const { data: suppressed } = await supabase
    .from("suppression_list")
    .select("id")
    .eq("company_id", input.companyId)
    .or(`channel.eq.all,channel.eq.${input.channel}`)
    .limit(1)
    .maybeSingle();

  if (suppressed) {
    return { error: "Esta empresa está na lista de supressão — contato bloqueado." };
  }

  const { data: outreach, error } = await supabase
    .from("lead_outreach")
    .insert({
      workspace_id: workspace.id,
      company_id: input.companyId,
      channel: input.channel,
      template_id: input.templateId || null,
      message_preview: input.messagePreview.slice(0, 2000),
      send_mode: "ASSISTED",
      status: "MARKED_SENT",
      sent_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !outreach) return { error: "Não foi possível registrar o envio." };

  const { data: newStage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("key", "CONTACTED")
    .maybeSingle();

  if (newStage) {
    await supabase.from("companies").update({ pipeline_stage_id: newStage.id }).eq("id", input.companyId);
  }

  const followUpAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await supabase.from("followups").insert({
    workspace_id: workspace.id,
    company_id: input.companyId,
    lead_outreach_id: outreach.id,
    follow_up_at: followUpAt.toISOString(),
    follow_up_type: "assisted",
    note: "Follow-up automático (3 dias após primeiro contato).",
  });

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "outreach.marked_sent",
    entityType: "company",
    entityId: input.companyId,
    metadata: { channel: input.channel },
  });

  revalidatePath(`/companies/${input.companyId}`);
  revalidatePath("/followups");
  return { success: true };
}

export async function recordResponseAction(
  outreachId: string,
  responseType: ResponseType,
  companyId: string
): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  await supabase
    .from("lead_outreach")
    .update({ response_type: responseType, responded_at: new Date().toISOString() })
    .eq("id", outreachId)
    .eq("workspace_id", workspace.id);

  if (responseType === "OPT_OUT") {
    await supabase.from("suppression_list").insert({
      workspace_id: workspace.id,
      company_id: companyId,
      channel: "all",
      reason: "opt_out",
    });
  }

  const stageKeyByResponse: Record<string, string> = {
    INTERESTED: "REPLIED",
    MEETING_REQUESTED: "MEETING",
    ASKED_PRICE: "REPLIED",
    ASKED_DETAILS: "REPLIED",
  };
  const targetKey = stageKeyByResponse[responseType];
  if (targetKey) {
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("key", targetKey)
      .maybeSingle();
    if (stage) {
      await supabase.from("companies").update({ pipeline_stage_id: stage.id }).eq("id", companyId);
    }
  }

  revalidatePath(`/companies/${companyId}`);
  return { success: true };
}
