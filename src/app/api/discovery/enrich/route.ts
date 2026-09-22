import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { executeEnrichment } from "@/lib/discovery/service";
import type { UnifiedCompany } from "@/lib/discovery/types";

export const maxDuration = 45;

const MAX_BATCH = 10;

/**
 * POST /api/discovery/enrich — enriches a small batch of discovered
 * companies (CNPJ registry → official website). The client calls this in
 * batches, top-ranked first, after results are already on screen (§44-45).
 *
 * Body: { searchId?: string, companies: UnifiedCompany[] (≤10) }
 */
export async function POST(request: Request) {
  let body: { searchId?: string | null; companies?: UnifiedCompany[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const companies = Array.isArray(body.companies) ? body.companies.slice(0, MAX_BATCH) : [];
  if (!companies.length) return Response.json({ companies: [], patches: [] });

  const workspace = await requireWorkspace();
  const supabase = await createClient();
  try {
    const out = await executeEnrichment({
      supabase,
      workspace,
      searchId: typeof body.searchId === "string" ? body.searchId : null,
      companies,
      signal: request.signal,
    });
    return Response.json({ companies: out.companies, patches: out.patches });
  } catch (err) {
    console.error("[discovery] enrichment failed", err);
    return Response.json({ error: "Falha no enriquecimento deste lote." }, { status: 500 });
  }
}
