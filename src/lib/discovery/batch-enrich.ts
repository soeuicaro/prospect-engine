import "server-only";

/**
 * Batch enrichment of companies ALREADY STORED in the workspace (e.g. the
 * thousands synced from the RFB CNPJ base). Free sources only, no API key:
 *
 * 1. Official website from the registered e-mail's domain
 *    (contato@pizzariabella.com.br → pizzariabella.com.br) — only when the
 *    domain is not a free-mail/platform domain AND plausibly matches the
 *    company name (so the accountant's domain is never taken as the site),
 *    and the site actually answers.
 * 2. Homepage read (robots.txt-respecting Website Analyzer) → Instagram,
 *    Facebook, TikTok, LinkedIn, YouTube, WhatsApp, e-mail published by the
 *    company itself. Gap-fill only.
 * 3. Prospect Score recomputed.
 *
 * Each company is processed once per ENRICH_TAG (re-run safe, resumable):
 * the tag is added whether or not something was found.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeWebsite } from "@/lib/providers/website-analyzer";
import { recomputeCompanyScore } from "@/lib/actions/scoring";
import type { Company, Database, Workspace } from "@/types/database";
import { domainMatchesName, normalizeSocial, normalizeWebsite, websiteDomain } from "./normalize";
import type { SocialMap } from "./types";

type Client = SupabaseClient<Database>;

export const ENRICH_TAG = "auto-enriched-v1";

/** Webmail / ISP / generic domains that never identify a business website. */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "msn.com",
  "yahoo.com", "yahoo.com.br", "ymail.com", "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br", "globo.com",
  "globomail.com", "icloud.com", "me.com", "zipmail.com.br", "r7.com", "oi.com.br", "click21.com.br", "aol.com",
  "protonmail.com", "proton.me", "gmx.com", "yandex.com", "mail.com", "zoho.com", "superig.com.br", "pop.com.br",
  "brturbo.com.br", "veloxmail.com.br", "vivo.com.br", "tim.com.br", "claro.com.br", "gov.br", "hotmai.com", "gmai.com",
]);

/** Social URL paths that are not a profile (share buttons, posts, plugins). */
const NON_PROFILE = /\/(p|reel|reels|explore|stories|sharer|share|sharer\.php|tr|plugins|dialog|intent|hashtag|watch|embed|login|signup|home\.php|profile\.php|groups|events|legal|policies|about|help)(\/|$|\?)/i;

export function emailWebsiteCandidate(email: string | null, name: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1].trim().toLowerCase().replace(/^mail\./, "");
  if (!domain.includes(".") || FREE_MAIL.has(domain) || domain.endsWith(".gov.br") || domain.endsWith(".edu.br")) return null;
  if (!websiteDomain(domain)) return null; // platform hosts
  if (domainMatchesName(domain, name) === "LOW") return null;
  return `https://${domain}`;
}

export function cleanSocials(links: Partial<Record<string, string>>): SocialMap {
  const out: SocialMap = {};
  for (const [net, raw] of Object.entries(links)) {
    if (!raw || NON_PROFILE.test(new URL(raw.startsWith("http") ? raw : `https://${raw}`).pathname + "/")) continue;
    const v = normalizeSocial(net as keyof SocialMap, raw);
    if (v) out[net as keyof SocialMap] = v;
  }
  return out;
}

export interface BatchStats {
  processed: number;
  websitesFound: number;
  websitesChecked: number;
  socialsFound: number;
  whatsappFound: number;
  emailsFound: number;
  remaining: number;
  errors: number;
}

type Row = Pick<Company, "id" | "trade_name" | "legal_name" | "email" | "website" | "phone" | "whatsapp" | "tags" | "field_provenance">;

async function enrichOne(supabase: Client, workspace: Workspace, c: Row, stats: BatchStats) {
  const now = new Date().toISOString();
  const name = c.trade_name || c.legal_name;
  const patch: Partial<Company> = { tags: [...new Set([...(c.tags ?? []), ENRICH_TAG])] };
  const provenance = { ...(c.field_provenance ?? {}) };

  let website = c.website ? normalizeWebsite(c.website) : null;
  let fromEmail = false;
  if (!website && workspace.feature_flags.WEB_ANALYSIS !== false) {
    const candidate = emailWebsiteCandidate(c.email, name);
    if (candidate) {
      website = candidate;
      fromEmail = true;
    }
  }

  if (website && workspace.feature_flags.WEB_ANALYSIS !== false) {
    stats.websitesChecked++;
    const result = await analyzeWebsite(website).catch(() => null);
    if (result && result.status === "ACTIVE") {
      if (fromEmail) {
        patch.website = website;
        patch.website_domain = websiteDomain(website);
        provenance.website = { value: website, source: "website_discovery (domínio do e-mail cadastral)", confidence: "MEDIUM", collected_at: now, verified_at: now };
        stats.websitesFound++;
      }
      if (!c.whatsapp && result.whatsapp) {
        patch.whatsapp = result.whatsapp;
        provenance.whatsapp = { value: result.whatsapp, source: "website_discovery", confidence: "HIGH", collected_at: now, verified_at: now };
        stats.whatsappFound++;
      }
      if (!c.email && result.email && !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(result.email)) {
        patch.email = result.email.toLowerCase();
        provenance.email = { value: patch.email, source: "website_discovery", confidence: "MEDIUM", collected_at: now, verified_at: now };
        stats.emailsFound++;
      }
      await supabase.from("company_analysis").upsert(
        {
          workspace_id: workspace.id,
          company_id: c.id,
          website_status: result.status,
          website_flags: result.flags,
          has_blog: result.hasBlog,
          has_https: result.hasHttps,
          has_sitemap: result.hasSitemap,
          content_presence: result.hasBlog ? "PRESENT" : "WEAK",
          summary: { title: result.title, description: result.description },
          last_analyzed_at: now,
          content_hash: result.contentHash,
        },
        { onConflict: "company_id" }
      );
      const socials = cleanSocials(result.socialLinks);
      const rows = Object.entries(socials).map(([channel, url]) => ({
        workspace_id: workspace.id,
        company_id: c.id,
        channel: channel as "instagram",
        handle_or_url: url!,
        status: "FOUND" as const,
        source: "website",
        confidence: "HIGH" as const,
        checked_at: now,
      }));
      if (rows.length) {
        // ignoreDuplicates: a profile the user already has is never replaced.
        await supabase.from("company_social_profiles").upsert(rows, { onConflict: "company_id,channel", ignoreDuplicates: true });
        stats.socialsFound += rows.length;
        for (const r of rows) provenance[r.channel] = { value: r.handle_or_url, source: "website_discovery", confidence: "HIGH", collected_at: now, verified_at: now };
      }
      await supabase.from("company_sources").insert({
        workspace_id: workspace.id,
        company_id: c.id,
        source_type: "WEBSITE",
        source_name: fromEmail ? "Website oficial (via domínio do e-mail)" : "Website oficial",
        source_url: website,
        source_record_id: websiteDomain(website),
        confidence: fromEmail ? "MEDIUM" : "HIGH",
        raw_ref: { flags: result.flags.slice(0, 10) },
      });
    }
  }

  patch.field_provenance = provenance;
  const { error } = await supabase.from("companies").update(patch).eq("id", c.id).eq("workspace_id", workspace.id);
  if (error) stats.errors++;
  await recomputeCompanyScore(supabase, workspace.id, c.id).catch(() => null);
  stats.processed++;
}

export async function enrichStoredBatch(supabase: Client, workspace: Workspace, opts: { limit?: number; concurrency?: number; city?: string | null } = {}): Promise<BatchStats> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const stats: BatchStats = { processed: 0, websitesFound: 0, websitesChecked: 0, socialsFound: 0, whatsappFound: 0, emailsFound: 0, remaining: 0, errors: 0 };

  let q = supabase
    .from("companies")
    .select("id, trade_name, legal_name, email, website, phone, whatsapp, tags, field_provenance")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .not("tags", "cs", `{${ENRICH_TAG}}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (opts.city) q = q.ilike("city", opts.city);
  const { data } = await q;
  const rows = (data ?? []) as Row[];

  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const c = rows[cursor++];
      try {
        await enrichOne(supabase, workspace, c, stats);
      } catch {
        stats.errors++;
        await supabase.from("companies").update({ tags: [...new Set([...(c.tags ?? []), ENRICH_TAG])] }).eq("id", c.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, worker));

  let remainingQ = supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .not("tags", "cs", `{${ENRICH_TAG}}`);
  if (opts.city) remainingQ = remainingQ.ilike("city", opts.city);
  const { count } = await remainingQ;
  stats.remaining = count ?? 0;
  return stats;
}
