export interface NormalizedPhone {
  original: string;
  normalized: string; // E.164-ish, digits only with country code
  country_code: string;
  ddd: string | null;
  number: string;
  valid_format: boolean;
}

/**
 * Normalizes a Brazilian phone number. Only validates FORMAT — never claims
 * the line is active/reachable (see PROMPT MASTER §99 PHONE STATUS).
 */
export function normalizePhoneBR(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  let withoutCountry = digits;
  const countryCode = "55";
  if (digits.startsWith("55") && digits.length > 11) {
    withoutCountry = digits.slice(2);
  }

  let ddd: string | null = null;
  let number = withoutCountry;
  if (withoutCountry.length === 10 || withoutCountry.length === 11) {
    ddd = withoutCountry.slice(0, 2);
    number = withoutCountry.slice(2);
  }

  const validFormat = /^\d{8,9}$/.test(number) && ddd !== null && /^\d{2}$/.test(ddd);

  return {
    original: raw,
    normalized: `+${countryCode}${withoutCountry}`,
    country_code: countryCode,
    ddd,
    number,
    valid_format: validFormat,
  };
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

export function isValidEmailFormat(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** Builds a wa.me deep link for Assisted WhatsApp outreach. */
export function buildWhatsAppLink(phone: string, prefilledMessage?: string): string {
  const normalized = normalizePhoneBR(phone);
  const digits = normalized ? normalized.normalized.replace("+", "") : phone.replace(/\D/g, "");
  const base = `https://wa.me/${digits}`;
  if (!prefilledMessage) return base;
  return `${base}?text=${encodeURIComponent(prefilledMessage)}`;
}

/** Builds a mailto: link for Assisted Email outreach. */
export function buildMailtoLink(email: string, subject?: string, body?: string): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString();
  return `mailto:${email}${qs ? `?${qs}` : ""}`;
}
