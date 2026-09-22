/**
 * Contact action links (§107-111). Each builder returns null when the data
 * is missing or invalid, so the UI only renders buttons that work.
 * Nothing here sends anything — every link is opened by the user.
 */

import { classifySocialUrl, isMobileBR, normalizeSocial, normalizeWebsite, formatPhoneBR } from "@/lib/discovery/normalize";
import { isValidEmailFormat, normalizePhoneBR } from "./phone";

export function websiteLink(raw: string | null | undefined): string | null {
  if (!raw || classifySocialUrl(raw)) return null;
  return normalizeWebsite(raw);
}

export function socialLink(network: "instagram" | "facebook" | "tiktok" | "linkedin" | "youtube", raw: string | null | undefined): string | null {
  return normalizeSocial(network, raw);
}

export function telLink(raw: string | null | undefined): string | null {
  const p = normalizePhoneBR(raw);
  if (!p || !p.valid_format) return null;
  return `tel:${p.normalized}`;
}

/**
 * WhatsApp only for an explicit WhatsApp number, or a phone that is a BR
 * mobile (landlines can't have WhatsApp conversations started this way).
 * Opens the chat — never sends (§109).
 */
export function whatsappLink(opts: { whatsapp?: string | null; phone?: string | null }, message?: string): { url: string; source: "whatsapp" | "mobile_phone" } | null {
  const candidates: [string | null | undefined, "whatsapp" | "mobile_phone"][] = [
    [opts.whatsapp, "whatsapp"],
    [opts.phone, "mobile_phone"],
  ];
  for (const [raw, source] of candidates) {
    const p = normalizePhoneBR(raw);
    if (!p || !p.valid_format) continue;
    if (source === "mobile_phone" && !isMobileBR(raw)) continue;
    const base = `https://wa.me/${p.normalized.replace("+", "")}`;
    return { url: message ? `${base}?text=${encodeURIComponent(message)}` : base, source };
  }
  return null;
}

export function mailtoLink(raw: string | null | undefined): string | null {
  if (!raw || !isValidEmailFormat(raw)) return null;
  return `mailto:${raw.trim()}`;
}

export function displayPhone(raw: string | null | undefined): string | null {
  return formatPhoneBR(raw);
}
