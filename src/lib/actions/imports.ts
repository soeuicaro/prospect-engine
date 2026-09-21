"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { normalizeCnpj } from "@/lib/domain/cnpj";
import { normalizePhoneBR, normalizeEmail } from "@/lib/domain/phone";
import { findBestDedupMatch, type DedupCandidate } from "@/lib/domain/dedup";
import { computeProspectScore, computeDataQualityScore } from "@/lib/domain/scoring";
import { logAudit } from "@/lib/actions/audit";
import type { ScoringRule, ScoringCategoryWeight, Company, CompanySource, CompanyScores, CompanyScoreFactor } from "@/types/database";

/** Splits an array into fixed-size chunks for batched Supabase writes. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const INSERT_BATCH_SIZE = 500;

// V1 processes synchronously within one request — safe up to this size on
// Vercel Functions (Node runtime, generous timeout). Larger files should be
// split; a chunked/resumable job queue is documented as a roadmap item in
// TROUBLESHOOTING.md rather than built prematurely.
const MAX_IMPORT_ROWS = 2000;

export const IMPORTABLE_FIELDS = [
  { key: "trade_name", label: "Nome fantasia *" },
  { key: "legal_name", label: "Razão social" },
  { key: "cnpj", label: "CNPJ" },
  { key: "phone", label: "Telefone" },
  { key: "email", label: "E-mail" },
  { key: "website", label: "Website" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "street", label: "Endereço" },
  { key: "neighborhood", label: "Bairro" },
  { key: "city", label: "Cidade *" },
  { key: "state", label: "UF *" },
  { key: "postal_code", label: "CEP" },
] as const;

export interface ImportPreview {
  error?: string;
  headers?: string[];
  sampleRows?: Record<string, string>[];
  totalRows?: number;
}

export async function previewImportAction(formData: FormData): Promise<ImportPreview> {
  await requireWorkspace();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Selecione um arquivo CSV." };

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  if (parsed.errors.length && !parsed.data.length) {
    return { error: "Não foi possível ler o CSV. Verifique o formato (separador vírgula, cabeçalho na 1ª linha)." };
  }

  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return { error: `Arquivo com ${parsed.data.length} linhas excede o limite de ${MAX_IMPORT_ROWS} por importação. Divida o arquivo.` };
  }

  return {
    headers: parsed.meta.fields ?? [],
    sampleRows: parsed.data.slice(0, 5),
    totalRows: parsed.data.length,
  };
}

export interface ImportRunResult {
  error?: string;
  created?: number;
  updated?: number;
  duplicates?: number;
  errors?: number;
}

export async function runImportAction(formData: FormData): Promise<ImportRunResult> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  const file = formData.get("file");
  const mappingRaw = formData.get("mapping");
  if (!(file instanceof File) || typeof mappingRaw !== "string") {
    return { error: "Dados de importação incompletos." };
  }

  const mapping = JSON.parse(mappingRaw) as Record<string, string>; // { csvHeader: fieldKey }
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.slice(0, MAX_IMPORT_ROWS);

  // All independent reads needed before any row can be processed — fetched
  // in one round trip instead of four sequential ones. Scoring rules/weights
  // are workspace-wide and identical for every row, so they're read once
  // here rather than re-fetched per company (previously the #1 bottleneck:
  // recomputeCompanyScore() ran ~10 queries per row, sequentially, for up to
  // MAX_IMPORT_ROWS rows).
  const [{ data: importJob }, { data: newStage }, { data: existingCompanies }, { data: rules }, { data: weights }] =
    await Promise.all([
      supabase
        .from("imports")
        .insert({
          workspace_id: workspace.id,
          file_name: file.name,
          source_type: "CSV",
          status: "RUNNING",
          column_mapping: mapping,
          total_rows: rows.length,
          created_by: user.id,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single(),
      supabase
        .from("pipeline_stages")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("key", "NEW")
        .maybeSingle(),
      supabase
        .from("companies")
        .select("id, cnpj, website_domain, phone, email, trade_name, legal_name, city")
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null),
      supabase.from("scoring_rules").select("*").eq("workspace_id", workspace.id).eq("enabled", true),
      supabase.from("scoring_category_weights").select("*").eq("workspace_id", workspace.id),
    ]);

  const existing: DedupCandidate[] = (existingCompanies ?? []) as DedupCandidate[];
  const scoringRules = (rules ?? []) as ScoringRule[];
  const scoringWeights = (weights ?? []) as ScoringCategoryWeight[];

  let duplicates = 0;
  let errors = 0;
  let processed = 0;

  interface PreparedRow {
    rowNumber: number;
    company: Partial<Company> & { id: string };
    source: Partial<CompanySource>;
    score: Partial<CompanyScores>;
    scoreFactors: Partial<CompanyScoreFactor>[];
  }

  const toInsert: PreparedRow[] = [];
  const importErrorRows: { import_id: string; row_number: number; error_message: string; raw_row: Record<string, string> }[] = [];

  // Pass 1: pure in-memory work only (mapping, normalization, dedup,
  // scoring) — no DB calls in this loop at all, so 2000 rows costs
  // milliseconds of CPU instead of thousands of network round trips.
  for (const row of rows) {
    processed++;
    try {
      const mapped: Record<string, string> = {};
      for (const [csvHeader, fieldKey] of Object.entries(mapping)) {
        if (fieldKey && fieldKey !== "__skip__") mapped[fieldKey] = row[csvHeader]?.trim() ?? "";
      }

      if (!mapped.trade_name || !mapped.city || !mapped.state) {
        errors++;
        if (importJob) {
          importErrorRows.push({
            import_id: importJob.id,
            row_number: processed,
            error_message: "Campos obrigatórios ausentes (nome fantasia, cidade ou UF).",
            raw_row: row,
          });
        }
        continue;
      }

      const cnpj = normalizeCnpj(mapped.cnpj);
      const phone = normalizePhoneBR(mapped.phone);
      const email = normalizeEmail(mapped.email);
      const websiteDomain = mapped.website ? extractDomain(mapped.website) : null;

      const candidate: DedupCandidate = {
        id: "new",
        cnpj,
        website_domain: websiteDomain,
        phone: phone?.normalized ?? null,
        email,
        trade_name: mapped.trade_name,
        legal_name: mapped.legal_name || null,
        city: mapped.city,
      };

      const match = findBestDedupMatch(candidate, existing);
      if (match && (match.level === "EXACT_MATCH" || match.level === "LIKELY_MATCH")) {
        duplicates++;
        continue;
      }

      const id = crypto.randomUUID();

      // Freshly-imported companies never have industry_id set (not an
      // importable field), contacts, social profiles, or website analysis
      // yet — so the score signals that would normally require 5 extra
      // reads (industries, playbooks, social profiles, analysis, contact
      // count) are all known statically for this path.
      const scoreResult = computeProspectScore(
        {
          company: {
            website: mapped.website || null,
            phone: mapped.phone || null,
            email,
            whatsapp: mapped.whatsapp || null,
            opened_at: null,
            estimated_size: null,
            tags: [],
            industry_id: null,
            city: mapped.city,
            state: mapped.state.toUpperCase().slice(0, 2),
          },
          industry: null,
          socialProfiles: [],
          analysis: null,
          hasOfferMapped: false,
        },
        scoringRules,
        scoringWeights
      );
      const dataQualityScore = computeDataQualityScore(
        {
          cnpj,
          phone: mapped.phone || null,
          email,
          website: mapped.website || null,
          trade_name: mapped.trade_name,
          street: mapped.street || null,
          city: mapped.city,
        },
        false,
        false
      );

      toInsert.push({
        rowNumber: processed,
        company: {
          id,
          workspace_id: workspace.id,
          trade_name: mapped.trade_name,
          legal_name: mapped.legal_name || null,
          cnpj,
          phone: mapped.phone || null,
          phone_normalized: phone?.normalized ?? null,
          email,
          website: mapped.website || null,
          website_domain: websiteDomain,
          whatsapp: mapped.whatsapp || null,
          street: mapped.street || null,
          neighborhood: mapped.neighborhood || null,
          city: mapped.city,
          state: mapped.state.toUpperCase().slice(0, 2),
          postal_code: mapped.postal_code || null,
          pipeline_stage_id: newStage?.id ?? null,
          data_quality_score: dataQualityScore,
        },
        source: {
          workspace_id: workspace.id,
          company_id: id,
          source_type: "IMPORT_CSV",
          source_name: file.name,
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
      existing.push({ ...candidate, id });
    } catch {
      errors++;
      if (importJob) {
        importErrorRows.push({
          import_id: importJob.id,
          row_number: processed,
          error_message: "Erro inesperado ao processar a linha.",
          raw_row: row,
        });
      }
    }
  }

  // Pass 2: batched writes. Each chunk is one round trip instead of one per
  // row — a 2000-row import now issues single-digit-to-low-tens of write
  // requests total instead of ~20,000. company_sources/company_scores/
  // company_score_factors are only queued for a chunk once its `companies`
  // insert has actually succeeded, so a failed chunk can't leave orphaned
  // rows pointing at a company_id that was never written.
  let created = 0;
  const succeeded: PreparedRow[] = [];

  for (const batch of chunk(toInsert, INSERT_BATCH_SIZE)) {
    const { error } = await supabase.from("companies").insert(batch.map((r) => r.company));
    if (error) {
      // Whole chunk failed (e.g. transient DB error) — surface as row
      // errors rather than silently under-reporting `created`.
      errors += batch.length;
      if (importJob) {
        for (const { rowNumber } of batch) {
          importErrorRows.push({
            import_id: importJob.id,
            row_number: rowNumber,
            error_message: "Falha ao gravar a empresa (lote).",
            raw_row: {},
          });
        }
      }
    } else {
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

  if (importErrorRows.length && importJob) {
    await Promise.all(
      chunk(importErrorRows, INSERT_BATCH_SIZE).map((batch) => supabase.from("import_errors").insert(batch))
    );
  }

  if (importJob) {
    await supabase
      .from("imports")
      .update({
        status: "SUCCESS",
        processed_rows: processed,
        created_count: created,
        duplicate_count: duplicates,
        error_count: errors,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importJob.id);
  }

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "import.run",
    entityType: "import",
    entityId: importJob?.id,
    metadata: { created, duplicates, errors, fileName: file.name },
  });

  revalidatePath("/companies");
  revalidatePath("/imports");
  return { created, duplicates, errors, updated: 0 };
}

function extractDomain(url: string): string | null {
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
