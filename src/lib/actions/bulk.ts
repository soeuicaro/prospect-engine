"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { logAudit } from "@/lib/actions/audit";
import type { ActionState } from "@/lib/actions/companies";

const MAX_BULK = 500;

export async function bulkChangeStageAction(companyIds: string[], stageId: string): Promise<ActionState> {
  if (!companyIds.length) return { error: "Nenhuma empresa selecionada." };
  if (companyIds.length > MAX_BULK) return { error: `Selecione no máximo ${MAX_BULK} empresas por vez.` };

  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const { data: companies } = await supabase
    .from("companies")
    .select("id, pipeline_stage_id")
    .eq("workspace_id", workspace.id)
    .in("id", companyIds);

  if (!companies?.length) return { error: "Empresas não encontradas." };

  const { error: stageError } = await supabase
    .from("companies")
    .update({ pipeline_stage_id: stageId })
    .eq("workspace_id", workspace.id)
    .in("id", companyIds);
  if (stageError) return { error: "Não foi possível mover as empresas selecionadas." };

  await supabase.from("lead_stage_history").insert(
    companies.map((c) => ({
      workspace_id: workspace.id,
      company_id: c.id,
      from_stage_id: c.pipeline_stage_id,
      to_stage_id: stageId,
      changed_by: user.id,
      note: "Alteração em massa",
    }))
  );

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "company.bulk_stage_change",
    entityType: "company",
    metadata: { count: companyIds.length, stageId },
  });

  revalidatePath("/companies");
  revalidatePath("/pipeline");
  return { success: true };
}

export async function bulkSuppressAction(companyIds: string[]): Promise<ActionState> {
  if (!companyIds.length) return { error: "Nenhuma empresa selecionada." };
  if (companyIds.length > MAX_BULK) return { error: `Selecione no máximo ${MAX_BULK} empresas por vez.` };

  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from("suppression_list").insert(
    companyIds.map((id) => ({
      workspace_id: workspace.id,
      company_id: id,
      channel: "all" as const,
      reason: "manual" as const,
      created_by: user.id,
    }))
  );
  if (error) return { error: "Não foi possível suprimir as empresas selecionadas." };

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "company.bulk_suppress",
    entityType: "company",
    metadata: { count: companyIds.length },
  });

  revalidatePath("/companies");
  revalidatePath("/suppression");
  return { success: true };
}
