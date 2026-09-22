import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface PipelineCard {
  id: string;
  trade_name: string | null;
  legal_name: string | null;
  city: string | null;
  state: string | null;
  prospect_score: number;
  opportunity_level: string;
  pipeline_stage_id: string | null;
  street: string | null;
  street_number: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  email: string | null;
}

export async function getPipelineBoard(workspaceId: string) {
  const supabase = await createClient();

  const [{ data: stages }, { data: companies }] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, key, label, color, position, kind")
      .eq("workspace_id", workspaceId)
      .order("position"),
    supabase
      .from("companies")
      .select(
        "id, trade_name, legal_name, city, state, pipeline_stage_id, street, street_number, latitude, longitude, phone, whatsapp, website, email, company_scores(prospect_score, opportunity_level)"
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  type Row = {
    id: string;
    trade_name: string | null;
    legal_name: string | null;
    city: string | null;
    state: string | null;
    pipeline_stage_id: string | null;
    street: string | null;
    street_number: string | null;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    whatsapp: string | null;
    website: string | null;
    email: string | null;
    company_scores: { prospect_score: number; opportunity_level: string } | { prospect_score: number; opportunity_level: string }[] | null;
  };

  const cards: PipelineCard[] = ((companies ?? []) as unknown as Row[]).map((c) => {
    const score = Array.isArray(c.company_scores) ? c.company_scores[0] : c.company_scores;
    return {
      id: c.id,
      trade_name: c.trade_name,
      legal_name: c.legal_name,
      city: c.city,
      state: c.state,
      pipeline_stage_id: c.pipeline_stage_id,
      street: c.street,
      street_number: c.street_number,
      latitude: c.latitude !== null ? Number(c.latitude) : null,
      longitude: c.longitude !== null ? Number(c.longitude) : null,
      phone: c.phone,
      whatsapp: c.whatsapp,
      website: c.website,
      email: c.email,
      prospect_score: score?.prospect_score ?? 0,
      opportunity_level: score?.opportunity_level ?? "BAIXO",
    };
  });

  return { stages: stages ?? [], cards };
}
