"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { normalizeCnpj } from "@/lib/domain/cnpj";
import { normalizePhoneBR, normalizeEmail } from "@/lib/domain/phone";
import { findBestDedupMatch, type DedupCandidate } from "@/lib/domain/dedup";
import { recomputeCompanyScore } from "@/lib/actions/scoring";
import { logAudit } from "@/lib/actions/audit";

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

  const { data: importJob } = await supabase
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
    .single();

  const { data: newStage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("key", "NEW")
    .maybeSingle();

  const { data: existingCompanies } = await supabase
    .from("companies")
    .select("id, cnpj, website_domain, phone, email, trade_name, legal_name, city")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  const existing: DedupCandidate[] = (existingCompanies ?? []) as DedupCandidate[];

  let created = 0;
  let duplicates = 0;
  let errors = 0;
  let processed = 0;

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
          await supabase.from("import_errors").insert({
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

      const { data: company } = await supabase
        .from("companies")
        .insert({
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
        })
        .select("id")
        .single();

      if (!company) {
        errors++;
        continue;
      }

      await supabase.from("company_sources").insert({
        workspace_id: workspace.id,
        company_id: company.id,
        source_type: "IMPORT_CSV",
        source_name: file.name,
        confidence: "MEDIUM",
      });

      await recomputeCompanyScore(supabase, workspace.id, company.id);
      existing.push({ ...candidate, id: company.id });
      created++;
    } catch {
      errors++;
      if (importJob) {
        await supabase.from("import_errors").insert({
          import_id: importJob.id,
          row_number: processed,
          error_message: "Erro inesperado ao processar a linha.",
          raw_row: row,
        });
      }
    }
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
