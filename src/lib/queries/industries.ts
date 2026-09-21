import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Global + workspace-owned industries (§148: user-configurable niches). */
export async function listIndustries(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("industries")
    .select("id, name, slug, description, is_visual_segment, recurring_need, workspace_id")
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order("name");
  return data ?? [];
}

export async function listPipelineStages(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pipeline_stages")
    .select("id, key, label, position, kind, color")
    .eq("workspace_id", workspaceId)
    .order("position");
  return data ?? [];
}

export async function listOffers(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("offers")
    .select("id, name, offer_type, ticket_min, ticket_max, active")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("name");
  return data ?? [];
}

export async function listMessageTemplates(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("message_templates")
    .select("id, name, stage, channel, industry_id")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("name");
  return data ?? [];
}

export async function listOutreachSequences(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_sequences")
    .select("id, name, active")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("name");
  return data ?? [];
}
