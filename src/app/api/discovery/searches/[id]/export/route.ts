import Papa from "papaparse";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { getSearchRow } from "@/lib/discovery/store";
import { discoveryCsvRows } from "@/lib/discovery/export";
import type { UnifiedCompany } from "@/lib/discovery/types";

/**
 * GET /api/discovery/searches/:id/export — CSV (UTF-8 with BOM, `;`
 * separator so Excel pt-BR opens it directly in columns).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const workspace = await requireWorkspace();
  const supabase = await createClient();
  const row = await getSearchRow(supabase, workspace.id, id);
  if (!row) return new Response("Busca não encontrada", { status: 404 });

  const csv = Papa.unparse(discoveryCsvRows(row.results as unknown as UnifiedCompany[]), { delimiter: ";" });
  const slug = (row.query_text ?? "busca").normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase().slice(0, 60);
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="discovery-${slug}-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
