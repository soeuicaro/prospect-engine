"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, requireUser } from "@/lib/workspace";
import { analyzeWebsite } from "@/lib/providers/website-analyzer";
import { recomputeCompanyScore } from "@/lib/actions/scoring";
import { logAudit } from "@/lib/actions/audit";
import type { ActionState } from "@/lib/actions/companies";
import type { Company } from "@/types/database";

/**
 * Runs the Website Analyzer for one company and merges results in.
 * Gap-filling only: never overwrites a phone/email/website the user (or a
 * higher-confidence source) already provided — see PROMPT MASTER §188.
 */
export async function analyzeWebsiteAction(companyId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const user = await requireUser();
  const supabase = await createClient();

  if (!workspace.feature_flags.WEB_ANALYSIS) {
    return { error: "O analisador de website está desativado em Configurações > Integrações & Flags." };
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id, website, phone, email, whatsapp")
    .eq("id", companyId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!company) return { error: "Empresa não encontrada." };
  if (!company.website) return { error: "Esta empresa não possui website cadastrado." };

  const result = await analyzeWebsite(company.website);

  await supabase.from("company_analysis").upsert(
    {
      workspace_id: workspace.id,
      company_id: companyId,
      website_status: result.status,
      website_flags: result.flags,
      has_blog: result.hasBlog,
      has_https: result.hasHttps,
      has_sitemap: result.hasSitemap,
      content_presence: result.hasBlog ? "PRESENT" : "WEAK",
      summary: { title: result.title, description: result.description },
      last_analyzed_at: new Date().toISOString(),
      content_hash: result.contentHash,
    },
    { onConflict: "company_id" }
  );

  // Gap-fill contact fields only if the company doesn't already have them.
  const updates: Partial<Pick<Company, "phone" | "email" | "whatsapp">> = {};
  if (!company.phone && result.phone) updates.phone = result.phone;
  if (!company.email && result.email) updates.email = result.email;
  if (!company.whatsapp && result.whatsapp) updates.whatsapp = result.whatsapp;
  if (Object.keys(updates).length) {
    await supabase.from("companies").update(updates).eq("id", companyId);
  }

  for (const [channel, url] of Object.entries(result.socialLinks)) {
    if (!url) continue;
    await supabase.from("company_social_profiles").upsert(
      {
        workspace_id: workspace.id,
        company_id: companyId,
        channel: channel as "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin",
        handle_or_url: url,
        status: "FOUND",
        source: "website",
        confidence: "HIGH",
        checked_at: new Date().toISOString(),
      },
      { onConflict: "company_id,channel" }
    );
  }

  await recomputeCompanyScore(supabase, workspace.id, companyId);
  await supabase.from("companies").update({ last_verified_at: new Date().toISOString() }).eq("id", companyId);

  await logAudit(supabase, {
    workspaceId: workspace.id,
    userId: user.id,
    action: "company.website_analyzed",
    entityType: "company",
    entityId: companyId,
    metadata: { status: result.status, flagCount: result.flags.length },
  });

  revalidatePath(`/companies/${companyId}`);
  return { success: true };
}
