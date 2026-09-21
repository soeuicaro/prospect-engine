"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { geocodeCity, searchPlaces, type OsmPlace } from "@/lib/providers/osm";
import { normalizePhoneBR } from "@/lib/domain/phone";
import { recomputeCompanyScore } from "@/lib/actions/scoring";
import { logAudit } from "@/lib/actions/audit";

export interface DiscoveryResult {
  error?: string;
  places?: OsmPlace[];
}

export async function discoverOsmAction(city: string, state: string, categoryTag: string): Promise<DiscoveryResult> {
  const workspace = await requireWorkspace();
  if (!workspace.feature_flags.OSM_DISCOVERY) {
    return { error: "Discovery via OpenStreetMap está desativado em Configurações > Integrações & Flags." };
  }

  if (!city || !state || !categoryTag) return { error: "Preencha cidade, UF e categoria." };

  try {
    const bbox = await geocodeCity(city, state);
    if (!bbox) return { error: "Não foi possível localizar essa cidade no OpenStreetMap." };

    const places = await searchPlaces(bbox, categoryTag);
    return { places };
  } catch {
    return { error: "Erro ao consultar o OpenStreetMap. Tente novamente em instantes." };
  }
}

export async function importOsmPlacesAction(
  places: OsmPlace[],
  city: string,
  state: string,
  industryId: string | null
): Promise<{ error?: string; created?: number; skipped?: number }> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const { data: newStage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("key", "NEW")
    .maybeSingle();

  let created = 0;
  let skipped = 0;

  for (const place of places) {
    const { data: existingSource } = await supabase
      .from("company_sources")
      .select("company_id")
      .eq("workspace_id", workspace.id)
      .eq("source_type", "OSM")
      .eq("source_record_id", place.osmId)
      .maybeSingle();

    if (existingSource) {
      skipped++;
      continue;
    }

    const phone = normalizePhoneBR(place.phone);

    const { data: company } = await supabase
      .from("companies")
      .insert({
        workspace_id: workspace.id,
        trade_name: place.name,
        industry_id: industryId,
        city: place.city || city,
        state: state.toUpperCase(),
        street: place.street,
        street_number: place.houseNumber,
        postal_code: place.postcode,
        latitude: place.lat,
        longitude: place.lon,
        geo_source: "OSM",
        phone: place.phone,
        phone_normalized: phone?.normalized ?? null,
        website: place.website,
        pipeline_stage_id: newStage?.id ?? null,
      })
      .select("id")
      .single();

    if (!company) continue;

    await supabase.from("company_sources").insert({
      workspace_id: workspace.id,
      company_id: company.id,
      source_type: "OSM",
      source_name: "OpenStreetMap",
      source_url: `https://www.openstreetmap.org/node/${place.osmId}`,
      source_record_id: place.osmId,
      confidence: "MEDIUM",
    });

    await recomputeCompanyScore(supabase, workspace.id, company.id);
    created++;
  }

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "discovery.osm_import",
    entityType: "company",
    metadata: { created, skipped, city, state },
  });

  revalidatePath("/companies");
  return { created, skipped };
}
