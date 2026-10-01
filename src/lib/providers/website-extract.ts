/**
 * Pure extraction helpers for the Website Analyzer (no I/O, unit-tested in
 * website-extract.test.ts).
 *
 * The previous version took the FIRST regex hit anywhere in the raw HTML:
 * "logo@2x.png" became an e-mail and a run of digits inside a CNPJ or a
 * JS timestamp became a phone. Rules now, in order of trust:
 *
 *   1. explicit links the business published: mailto:, tel:, wa.me
 *   2. visible text only (scripts/styles/tags stripped), with BR phone
 *      shape + valid DDD, not glued to other digits
 *   3. never placeholders (example.com, seuemail@…), assets or vendor
 *      addresses (sentry, wixpress)
 *
 * Nothing found → null. A wrong contact is worse than no contact.
 */

const ASSET_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|woff2?|ttf|mp4|webm)$/i;
const PLACEHOLDER_DOMAINS = /(^|\.)(example\.(com|org|net)|exemplo\.com(\.br)?|domain\.com|dominio\.com(\.br)?|seudominio|yourdomain|email\.com|mail\.com|test\.com|teste\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|godaddy\.com|schema\.org|w3\.org)$/i;
const PLACEHOLDER_LOCAL = /^(nome|seunome|seuemail|email|e-mail|usuario|user|exemplo|example|fulano|contato@contato|your|you|name|noreply|no-reply|donotreply)$/i;

/** Valid Brazilian DDDs (ANATEL). */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54,
  55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function isPlausibleEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase();
  const m = /^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(email);
  if (!m) return false;
  const [, local, domain] = m;
  if (ASSET_TLD.test(domain) || /@\d+x\./.test(email)) return false;
  if (PLACEHOLDER_DOMAINS.test(domain) || PLACEHOLDER_LOCAL.test(local)) return false;
  if (/^[0-9a-f]{16,}$/.test(local)) return false; // hashes (Sentry DSNs etc.)
  return true;
}

/** Digits of a plausible BR phone (DDD + 8/9 digits), or null. */
export function plausiblePhoneDigits(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0") && d.length >= 11) d = d.slice(1); // 0 + DDD
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  const n = d.slice(2);
  if (n.length === 9 && n[0] !== "9") return null; // 9-digit numbers are mobiles
  if (n.length === 8 && !/^[2-5]/.test(n)) return null; // landlines start 2-5
  if (/^(\d)\1+$/.test(n)) return null; // 99999-9999 placeholders
  return d;
}

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

export interface ExtractedContacts {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** Where each value came from — "link" (mailto/tel/wa.me) is stronger than "text". */
  origin: { email: "link" | "text" | null; phone: "link" | "text" | null };
}

export function extractContacts(html: string): ExtractedContacts {
  const out: ExtractedContacts = { email: null, phone: null, whatsapp: null, origin: { email: null, phone: null } };

  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    const e = decodeURIComponent(m[1]).trim().toLowerCase();
    if (isPlausibleEmail(e)) {
      out.email = e;
      out.origin.email = "link";
      break;
    }
  }
  const text = visibleText(html);
  if (!out.email) {
    for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
      if (isPlausibleEmail(m[0])) {
        out.email = m[0].toLowerCase();
        out.origin.email = "text";
        break;
      }
    }
  }

  for (const m of html.matchAll(/(?:wa\.me\/|whatsapp\.com\/send\/?\?phone=)\+?(\d{10,13})/gi)) {
    const d = plausiblePhoneDigits(m[1]);
    if (d) {
      out.whatsapp = d;
      break;
    }
  }
  for (const m of html.matchAll(/href=["']tel:([^"']+)/gi)) {
    const d = plausiblePhoneDigits(decodeURIComponent(m[1]));
    if (d) {
      out.phone = d;
      out.origin.phone = "link";
      break;
    }
  }
  if (!out.phone) {
    // Formatted like a phone in the visible text, not glued to other digits.
    const re = /(?<![\d/.-])(?:\+?55[\s.-]?)?\(?0?(\d{2})\)?[\s.-]?(9?\d{4})[\s.-](\d{4})(?![\d/-])/g;
    for (const m of text.matchAll(re)) {
      const d = plausiblePhoneDigits(`${m[1]}${m[2]}${m[3]}`);
      if (d) {
        out.phone = d;
        out.origin.phone = "text";
        break;
      }
    }
  }
  return out;
}

const VIDEO_PATTERNS: { platform: string; re: RegExp }[] = [
  { platform: "YouTube", re: /(youtube(-nocookie)?\.com\/(embed|watch|shorts)|youtu\.be\/)/i },
  { platform: "Vimeo", re: /(player\.vimeo\.com|vimeo\.com\/\d+)/i },
  { platform: "vídeo HTML5", re: /<video[\s>]/i },
  { platform: "Instagram Reels", re: /instagram\.com\/reels?\//i },
  { platform: "TikTok", re: /tiktok\.com\/@[\w.]+\/video\/|tiktok\.com\/embed/i },
  { platform: "Wistia/Vidyard", re: /(wistia\.(com|net)|vidyard\.com)/i },
];

/** Video the homepage actually carries (embeds, players, links to specific videos). */
export function detectVideo(html: string): { hasVideo: boolean; platforms: string[] } {
  const platforms = VIDEO_PATTERNS.filter((p) => p.re.test(html)).map((p) => p.platform);
  return { hasVideo: platforms.length > 0, platforms };
}

const HINTS = [
  "lançamento", "lançamentos", "inauguração", "inauguramos", "nova unidade", "novas unidades", "em breve", "eventos", "evento",
  "reserve", "reservas", "agende", "agendamento", "cardápio", "franquia", "franquias", "nossas unidades", "casamentos", "festas",
  "pré-lançamento", "empreendimento", "decorado",
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Opportunity words present in the page's visible text (folded match). */
export function opportunityHints(html: string): string[] {
  const text = fold(visibleText(html));
  return HINTS.filter((h) => text.includes(fold(h))).slice(0, 10);
}
