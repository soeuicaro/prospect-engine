import "server-only";
import { isPathAllowed } from "./robots";

/**
 * Lightweight, polite website analyzer. Fetches exactly one page (the
 * homepage) over HTTPS-preferred, respects robots.txt, never authenticates,
 * never bypasses protections, and never stores the raw HTML — only
 * extracted metadata/flags/a content hash (see DATABASE.md storage-economy
 * policy and PROMPT MASTER §23).
 *
 * A flag here means "signal detected," never "verified fact" — e.g.
 * WEBSITE_OUTDATED is a heuristic, not a certified claim (§214).
 */

export type WebsiteStatus = "ACTIVE" | "INACTIVE" | "TIMEOUT" | "DNS_ERROR" | "HTTPS_ERROR" | "UNKNOWN";

export interface WebsiteAnalysisResult {
  status: WebsiteStatus;
  flags: string[];
  hasHttps: boolean;
  hasSitemap: boolean | null;
  hasBlog: boolean;
  title: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  socialLinks: Partial<Record<"instagram" | "facebook" | "tiktok" | "youtube" | "linkedin", string>>;
  contentHash: string;
}

const SOCIAL_PATTERNS: { key: "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin"; pattern: RegExp }[] = [
  { key: "instagram", pattern: /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+/i },
  { key: "facebook", pattern: /https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9_.]+/i },
  { key: "tiktok", pattern: /https?:\/\/(www\.)?tiktok\.com\/@[a-zA-Z0-9_.]+/i },
  { key: "youtube", pattern: /https?:\/\/(www\.)?youtube\.com\/(channel|c|@)[a-zA-Z0-9_.-]+/i },
  { key: "linkedin", pattern: /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9_-]+/i },
];

const NON_PROFILE_PATH = /\.com\/(p|reel|reels|explore|stories|sharer|share|tr|plugins|dialog|intent|hashtag|watch|embed|login|groups|events|policies)(\/|\.php|$|\?)/i;

const CTA_KEYWORDS = /agende|fale conosco|whatsapp|solicite|pe[çc]a um or[çc]amento|entre em contato|reserve|compre agora/i;

async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function analyzeWebsite(rawUrl: string): Promise<WebsiteAnalysisResult> {
  const flags: string[] = [];
  let url: URL;
  try {
    url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  } catch {
    return emptyResult("UNKNOWN", ["INVALID_URL"]);
  }

  const hasHttps = url.protocol === "https:";
  if (!hasHttps) flags.push("HTTPS_ERROR");

  const allowed = await isPathAllowed(url.origin, url.pathname || "/");
  if (!allowed) {
    return emptyResult("UNKNOWN", ["ROBOTS_DISALLOWED"]);
  }

  let html = "";
  let status: WebsiteStatus = "UNKNOWN";

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
      headers: { "User-Agent": "ProspectEngine/1.0 (+website analyzer; single page fetch, no auth)" },
    });

    if (!res.ok) {
      status = "INACTIVE";
      flags.push(`HTTP_${res.status}`);
    } else {
      status = "ACTIVE";
      html = await res.text();
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      status = "TIMEOUT";
    } else {
      status = "DNS_ERROR";
    }
    return emptyResult(status, [status]);
  }

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const phoneMatch = html.match(/(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/);
  const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const whatsappMatch = html.match(/(?:wa\.me\/|whatsapp\.com\/send\?phone=)(\d+)/i);

  const socialLinks: WebsiteAnalysisResult["socialLinks"] = {};
  // First link per network that is a PROFILE — share buttons, posts and
  // plugins (instagram.com/p/…, facebook.com/sharer…) come first on many sites.
  for (const { key, pattern } of SOCIAL_PATTERNS) {
    const all = html.matchAll(new RegExp(pattern.source, "gi"));
    for (const m of all) {
      if (NON_PROFILE_PATH.test(m[0])) continue;
      socialLinks[key] = m[0];
      break;
    }
  }

  const hasContactPage = /href=["'][^"']*(contato|contact|fale-conosco)[^"']*["']/i.test(html);
  const hasCta = CTA_KEYWORDS.test(html);
  const hasBlog = /href=["'][^"']*(blog|noticias|artigos)[^"']*["']/i.test(html);

  if (!hasContactPage) flags.push("NO_CONTACT_PAGE");
  if (!whatsappMatch) flags.push("NO_WHATSAPP");
  if (Object.keys(socialLinks).length === 0) flags.push("NO_SOCIAL_LINKS", "MISSING_SOCIAL");
  if (!hasCta) flags.push("MISSING_CTA");
  if (!hasBlog) flags.push("LOW_CONTENT_SIGNAL");

  let hasSitemap: boolean | null = null;
  try {
    const sitemapRes = await fetch(`${url.origin}/sitemap.xml`, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
    });
    hasSitemap = sitemapRes.ok;
  } catch {
    hasSitemap = null; // not verified, never asserted false
  }
  if (hasSitemap === false) flags.push("WEBSITE_OUTDATED");

  const contentHash = await hashText(html.slice(0, 5000));

  return {
    status,
    flags,
    hasHttps,
    hasSitemap,
    hasBlog,
    title: titleMatch?.[1]?.trim().slice(0, 200) ?? null,
    description: descMatch?.[1]?.trim().slice(0, 500) ?? null,
    phone: phoneMatch?.[0] ?? null,
    email: emailMatch?.[0] ?? null,
    whatsapp: whatsappMatch?.[1] ?? null,
    socialLinks,
    contentHash,
  };
}

function emptyResult(status: WebsiteStatus, flags: string[]): WebsiteAnalysisResult {
  return {
    status,
    flags,
    hasHttps: false,
    hasSitemap: null,
    hasBlog: false,
    title: null,
    description: null,
    phone: null,
    email: null,
    whatsapp: null,
    socialLinks: {},
    contentHash: "",
  };
}
