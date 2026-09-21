"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { geocodeCity, searchPlaces, type OsmPlace } from "@/lib/providers/osm";
import { normalizePhoneBR } from "@/lib/domain/phone";
import { computeProspectScore, computeDataQualityScore } from "@/lib/domain/scoring";
import { logAudit } from "@/lib/actions/audit";
import type { ScoringRule, ScoringCategoryWeight, Company, CompanySource, CompanyScores, CompanyScoreFactor } from "@/types/database";

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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const INSERT_BATCH_SIZE = 500;

export async function importOsmPlacesAction(
  places: OsmPlace[],
  city: string,
  state: string,
  industryId: string | null
): Promise<{ error?: string; created?: number; skipped?: number }> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const osmIds = places.map((p) => p.osmId);

  // Previously: 1 dedup check + 1 insert + 1 source insert + a ~10-query
  // recomputeCompanyScore() per place, sequentially — up to ~60 places per
  // search meant ~780 sequential round trips for one "import selected"
  // click. All of the per-place reads below are workspace/industry-wide
  // (not place-specific), so they're fetched once instead.
  const [{ data: newStage }, { data: existingSources }, { data: rules }, { data: weights }, { data: industryRow }, { data: playbook }] =
    await Promise.all([
      supabase.from("pipeline_stages").select("id").eq("workspace_id", workspace.id).eq("key", "NEW").maybeSingle(),
      osmIds.length
        ? supabase
            .from("company_sources")
            .select("source_record_id")
            .eq("workspace_id", workspace.id)
            .eq("source_type", "OSM")
            .in("source_record_id", osmIds)
        : Promise.resolve({ data: [] as { source_record_id: string | null }[] }),
      supabase.from("scoring_rules").select("*").eq("workspace_id", workspace.id).eq("enabled", true),
      supabase.from("scoring_category_weights").select("*").eq("workspace_id", workspace.id),
      industryId
        ? supabase.from("industries").select("is_visual_segment, recurring_need").eq("id", industryId).maybeSingle()
        : Promise.resolve({ data: null }),
      industryId
        ? supabase
            .from("industry_playbooks")
            .select("id")
            .eq("workspace_id", workspace.id)
            .eq("industry_id", industryId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const existingOsmIds = new Set((existingSources ?? []).map((s) => s.source_record_id));
  const scoringRules = (rules ?? []) as ScoringRule[];
  const scoringWeights = (weights ?? []) as ScoringCategoryWeight[];
  const hasOfferMapped = Boolean(playbook);

  interface Prepared {
    company: Partial<Company> & { id: string };
    source: Partial<CompanySource>;
    score: Partial<CompanyScores>;
    scoreFactors: Partial<CompanyScoreFactor>[];
  }

  const toInsert: Prepared[] = [];
  let skipped = 0;

  for (const place of places) {
    if (existingOsmIds.has(place.osmId)) {
      skipped++;
      continue;
    }

    const phone = normalizePhoneBR(place.phone);
    const id = crypto.randomUUID();

    const scoreResult = computeProspectScore(
      {
        company: {
          website: place.website ?? null,
          phone: place.phone ?? null,
          email: null,
          whatsapp: null,
          opened_at: null,
          estimated_size: null,
          tags: [],
          industry_id: industryId,
          city: place.city || city,
          state: state.toUpperCase(),
        },
        industry: industryRow,
        socialProfiles: [],
        analysis: null,
        hasOfferMapped,
      },
      scoringRules,
      scoringWeights
    );
    const dataQualityScore = computeDataQualityScore(
      {
        cnpj: null,
        phone: place.phone ?? null,
        email: null,
        website: place.website ?? null,
        trade_name: place.name,
        street: place.street ?? null,
        city: place.city || city,
      },
      false,
      false
    );

    toInsert.push({
      company: {
        id,
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
        data_quality_score: dataQualityScore,
      },
      source: {
        workspace_id: workspace.id,
        company_id: id,
        source_type: "OSM",
        source_name: "OpenStreetMap",
        source_url: `https://www.openstreetmap.org/node/${place.osmId}`,
        source_record_id: place.osmId,
        confidence: "MEDIUM",
      },
      score: {
        workspace_id: workspace.id,
        company_id: id,
        digital_presence_score: scoreResult.categoryScores.digital_presence,
        content_need_score: scoreResult.categoryScores.content_need,
        purchase_capacity_score: scoreResult.categoryScores.purchase_capacity,
        marketing_opportunity_score: scoreResult.categoryScores.marketing_opportunity,
        fit_score: scoreResult.categoryScores.fit,
        size_score: scoreResult.categoryScores.size,
        local_proximity_score: scoreResult.categoryScores.local_proximity,
        prospect_score: scoreResult.prospectScore,
        opportunity_level: scoreResult.opportunityLevel,
        rule_version: "v1",
        computed_at: new Date().toISOString(),
      },
      scoreFactors: scoreResult.factors.map((f) => ({
        workspace_id: workspace.id,
        company_id: id,
        factor_key: f.factor_key,
        factor_label: f.factor_label,
        category: f.category,
        points: f.points,
        evidence: f.evidence,
        confidence: f.confidence,
      })),
    });
  }

  let created = 0;
  const succeeded: Prepared[] = [];

  for (const batch of chunk(toInsert, INSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("companies").insert(batch.map((r) => r.company));
    if (!error) {
      created += batch.length;
      succeeded.push(...batch);
    }
  }

  if (succeeded.length > 0) {
    await Promise.all([
      ...chunk(succeeded, INSERT_BATCH_SIZE).map((batch) =>
        supabase.from("company_sources").insert(batch.map((r) => r.source))
      ),
      ...chunk(succeeded, INSERT_BATCH_SIZE).map((batch) =>
        supabase.from("company_scores").insert(batch.map((r) => r.score))
      ),
      ...chunk(
        succeeded.flatMap((r) => r.scoreFactors),
        INSERT_BATCH_SIZE
      ).map((batch) => supabase.from("company_score_factors").insert(batch)),
    ]);
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
