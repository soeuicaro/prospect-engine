import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface DashboardData {
  totalCompanies: number;
  newLeadsLast7Days: number;
  qualifiedLeads: number;
  highOpportunity: number;
  contacted: number;
  replies: number;
  meetings: number;
  proposals: number;
  won: number;
  replyRate: number | null;
  meetingRate: number | null;
  topLeads: {
    id: string;
    trade_name: string | null;
    legal_name: string | null;
    city: string | null;
    state: string | null;
    prospect_score: number;
    opportunity_level: string;
    industry_name: string | null;
    next_best_action: string | null;
  }[];
  followupsToday: number;
  tasksOverdue: number;
}

export async function getDashboardData(workspaceId: string): Promise<DashboardData> {
  const supabase = await createClient();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalCompanies,
    newLeads,
    highOpportunity,
    contactedOutreach,
    repliedOutreach,
    stages,
    topLeadsRes,
    followupsToday,
    tasksOverdue,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .gte("created_at", sevenDaysAgo),
    supabase
      .from("company_scores")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("opportunity_level", ["MUITO_ALTO", "ALTO"]),
    supabase
      .from("lead_outreach")
      .select("company_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "MARKED_SENT"),
    supabase
      .from("lead_outreach")
      .select("company_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .not("response_type", "is", null)
      .not("response_type", "eq", "UNKNOWN"),
    supabase
      .from("pipeline_stages")
      .select("id, key, kind")
      .eq("workspace_id", workspaceId),
    supabase
      .from("companies")
      .select(
        "id, trade_name, legal_name, city, state, next_best_action, industries(name), company_scores(prospect_score, opportunity_level)"
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("prospect_score", { referencedTable: "company_scores", ascending: false })
      .limit(10),
    supabase
      .from("followups")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "PENDING")
      .gte("follow_up_at", startOfDay.toISOString())
      .lte("follow_up_at", endOfDay.toISOString()),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "OPEN")
      .lt("due_at", startOfDay.toISOString()),
  ]);

  const stageList = stages.data ?? [];
  const meetingStageIds = stageList.filter((s) => s.key === "MEETING").map((s) => s.id);
  const proposalStageIds = stageList.filter((s) => s.key === "PROPOSAL").map((s) => s.id);
  const wonStageIds = stageList.filter((s) => s.kind === "won").map((s) => s.id);
  // "Qualified" = any stage past intake. Derived from the `stages` result
  // already fetched above instead of re-querying pipeline_stages — this used
  // to be a duplicate fetch that also forced a 3rd sequential round trip.
  const qualifiedStageIds = stageList.filter((s) => s.key !== "NEW").map((s) => s.id);

  const [meetingsRes, proposalsRes, wonRes, qualifiedRes] = await Promise.all([
    meetingStageIds.length
      ? supabase
          .from("companies")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("pipeline_stage_id", meetingStageIds)
      : Promise.resolve({ count: 0 }),
    proposalStageIds.length
      ? supabase
          .from("companies")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("pipeline_stage_id", proposalStageIds)
      : Promise.resolve({ count: 0 }),
    wonStageIds.length
      ? supabase
          .from("companies")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("pipeline_stage_id", wonStageIds)
      : Promise.resolve({ count: 0 }),
    qualifiedStageIds.length
      ? supabase
          .from("companies")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("pipeline_stage_id", qualifiedStageIds)
      : Promise.resolve({ count: 0 }),
  ]);

  const qualifiedCount = qualifiedRes.count ?? 0;

  const contacted = contactedOutreach.count ?? 0;
  const replies = repliedOutreach.count ?? 0;
  const meetings = meetingsRes.count ?? 0;

  type TopLeadRow = {
    id: string;
    trade_name: string | null;
    legal_name: string | null;
    city: string | null;
    state: string | null;
    next_best_action: string | null;
    industries: { name: string } | { name: string }[] | null;
    company_scores: { prospect_score: number; opportunity_level: string } | { prospect_score: number; opportunity_level: string }[] | null;
  };

  const topLeads = ((topLeadsRes.data ?? []) as TopLeadRow[])
    .map((row) => {
      const industry = Array.isArray(row.industries) ? row.industries[0] : row.industries;
      const scoreRow = Array.isArray(row.company_scores) ? row.company_scores[0] : row.company_scores;
      return {
        id: row.id,
        trade_name: row.trade_name,
        legal_name: row.legal_name,
        city: row.city,
        state: row.state,
        next_best_action: row.next_best_action,
        industry_name: industry?.name ?? null,
        prospect_score: scoreRow?.prospect_score ?? 0,
        opportunity_level: scoreRow?.opportunity_level ?? "BAIXO",
      };
    })
    .sort((a, b) => b.prospect_score - a.prospect_score)
    .slice(0, 10);

  return {
    totalCompanies: totalCompanies.count ?? 0,
    newLeadsLast7Days: newLeads.count ?? 0,
    qualifiedLeads: qualifiedCount,
    highOpportunity: highOpportunity.count ?? 0,
    contacted,
    replies,
    meetings,
    proposals: proposalsRes.count ?? 0,
    won: wonRes.count ?? 0,
    replyRate: contacted > 0 ? Math.round((replies / contacted) * 100) : null,
    meetingRate: replies > 0 ? Math.round((meetings / replies) * 100) : null,
    topLeads,
    followupsToday: followupsToday.count ?? 0,
    tasksOverdue: tasksOverdue.count ?? 0,
  };
}
