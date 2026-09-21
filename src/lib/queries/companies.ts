import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface CompanyListFilters {
  search?: string;
  industryId?: string;
  stageId?: string;
  minScore?: number;
  city?: string;
  state?: string;
  noWebsite?: boolean;
  tag?: string;
  sortBy?: "score" | "created_at" | "name";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface CompanyListRow {
  id: string;
  trade_name: string | null;
  legal_name: string | null;
  city: string | null;
  state: string | null;
  estimated_size: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  next_best_action: string | null;
  created_at: string;
  industry_name: string | null;
  stage_label: string | null;
  stage_color: string | null;
  prospect_score: number;
  opportunity_level: string;
}

export async function listCompanies(workspaceId: string, filters: CompanyListFilters) {
  const supabase = await createClient();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("companies")
    .select(
      `id, trade_name, legal_name, city, state, estimated_size, website, phone, whatsapp,
       next_best_action, created_at,
       industries(name), pipeline_stages(label, color), company_scores(prospect_score, opportunity_level)`,
      { count: "exact" }
    )
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("archived_at", null);

  if (filters.search) {
    query = query.or(
      `trade_name.ilike.%${filters.search}%,legal_name.ilike.%${filters.search}%,cnpj.ilike.%${filters.search}%`
    );
  }
  if (filters.industryId) query = query.eq("industry_id", filters.industryId);
  if (filters.stageId) query = query.eq("pipeline_stage_id", filters.stageId);
  if (filters.city) query = query.ilike("city", `%${filters.city}%`);
  if (filters.state) query = query.eq("state", filters.state.toUpperCase());
  if (filters.noWebsite) query = query.is("website", null);
  if (filters.tag) query = query.contains("tags", [filters.tag]);

  if (filters.sortBy === "created_at") {
    query = query.order("created_at", { ascending: filters.sortDir === "asc" });
  } else if (filters.sortBy === "name") {
    query = query.order("trade_name", { ascending: filters.sortDir !== "desc" });
  } else if (filters.sortBy === "score") {
    // Sort in the DB via the joined table, same pattern as dashboard.ts —
    // sorting the already-paginated JS array only ordered the 25 rows on
    // the current page and left every other page in created_at order.
    query = query.order("prospect_score", {
      referencedTable: "company_scores",
      ascending: filters.sortDir === "asc",
    });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  query = query.range(from, to);

  const { data, count } = await query;

  type Row = {
    id: string;
    trade_name: string | null;
    legal_name: string | null;
    city: string | null;
    state: string | null;
    estimated_size: string | null;
    website: string | null;
    phone: string | null;
    whatsapp: string | null;
    next_best_action: string | null;
    created_at: string;
    industries: { name: string } | { name: string }[] | null;
    pipeline_stages: { label: string; color: string | null } | { label: string; color: string | null }[] | null;
    company_scores:
      | { prospect_score: number; opportunity_level: string }
      | { prospect_score: number; opportunity_level: string }[]
      | null;
  };

  const rows: CompanyListRow[] = ((data ?? []) as Row[]).map((row) => {
    const industry = Array.isArray(row.industries) ? row.industries[0] : row.industries;
    const stage = Array.isArray(row.pipeline_stages) ? row.pipeline_stages[0] : row.pipeline_stages;
    const score = Array.isArray(row.company_scores) ? row.company_scores[0] : row.company_scores;
    return {
      id: row.id,
      trade_name: row.trade_name,
      legal_name: row.legal_name,
      city: row.city,
      state: row.state,
      estimated_size: row.estimated_size,
      website: row.website,
      phone: row.phone,
      whatsapp: row.whatsapp,
      next_best_action: row.next_best_action,
      created_at: row.created_at,
      industry_name: industry?.name ?? null,
      stage_label: stage?.label ?? null,
      stage_color: stage?.color ?? null,
      prospect_score: score?.prospect_score ?? 0,
      opportunity_level: score?.opportunity_level ?? "BAIXO",
    };
  });

  return { rows, total: count ?? 0, page, pageSize };
}
