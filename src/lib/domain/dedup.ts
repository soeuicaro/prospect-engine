import { normalizeCnpj } from "./cnpj";
import { normalizePhoneBR, normalizeEmail } from "./phone";

export type MatchLevel = "EXACT_MATCH" | "LIKELY_MATCH" | "POSSIBLE_DUPLICATE" | "NO_MATCH";

export interface DedupCandidate {
  id: string;
  cnpj: string | null;
  website_domain: string | null;
  phone: string | null;
  email: string | null;
  trade_name: string | null;
  legal_name: string | null;
  city: string | null;
}

export interface DedupResult {
  candidateId: string;
  level: MatchLevel;
  reasons: string[];
}

function normalizeName(name: string | null): string | null {
  if (!name) return null;
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Compares a new/incoming record against an existing company. Never
 * auto-deletes — the caller decides what to do with EXACT/LIKELY/POSSIBLE
 * matches (see PROMPT MASTER §43: never silently drop a possible duplicate).
 */
export function evaluateDedup(incoming: DedupCandidate, existing: DedupCandidate): DedupResult {
  const reasons: string[] = [];

  const incomingCnpj = normalizeCnpj(incoming.cnpj);
  const existingCnpj = normalizeCnpj(existing.cnpj);
  if (incomingCnpj && existingCnpj && incomingCnpj === existingCnpj) {
    return { candidateId: existing.id, level: "EXACT_MATCH", reasons: ["CNPJ idêntico"] };
  }

  if (
    incoming.website_domain &&
    existing.website_domain &&
    incoming.website_domain.toLowerCase() === existing.website_domain.toLowerCase()
  ) {
    return { candidateId: existing.id, level: "EXACT_MATCH", reasons: ["Domínio de website idêntico"] };
  }

  const incomingPhone = normalizePhoneBR(incoming.phone);
  const existingPhone = normalizePhoneBR(existing.phone);
  if (incomingPhone && existingPhone && incomingPhone.normalized === existingPhone.normalized) {
    reasons.push("Telefone idêntico");
  }

  const incomingEmail = normalizeEmail(incoming.email);
  const existingEmail = normalizeEmail(existing.email);
  if (incomingEmail && existingEmail && incomingEmail === existingEmail) {
    reasons.push("E-mail idêntico");
  }

  const nameA = normalizeName(incoming.trade_name || incoming.legal_name);
  const nameB = normalizeName(existing.trade_name || existing.legal_name);
  const sameCity = incoming.city && existing.city && incoming.city.toLowerCase() === existing.city.toLowerCase();
  if (nameA && nameB && nameA === nameB && sameCity) {
    reasons.push("Nome + cidade idênticos");
  }

  if (reasons.length >= 2) {
    return { candidateId: existing.id, level: "LIKELY_MATCH", reasons };
  }
  if (reasons.length === 1) {
    return { candidateId: existing.id, level: "POSSIBLE_DUPLICATE", reasons };
  }
  return { candidateId: existing.id, level: "NO_MATCH", reasons: [] };
}

export function findBestDedupMatch(
  incoming: DedupCandidate,
  existingCompanies: DedupCandidate[]
): DedupResult | null {
  let best: DedupResult | null = null;
  for (const existing of existingCompanies) {
    const result = evaluateDedup(incoming, existing);
    if (result.level === "NO_MATCH") continue;
    if (!best || rank(result.level) > rank(best.level)) {
      best = result;
    }
    if (result.level === "EXACT_MATCH") break;
  }
  return best;
}

function rank(level: MatchLevel): number {
  return { EXACT_MATCH: 3, LIKELY_MATCH: 2, POSSIBLE_DUPLICATE: 1, NO_MATCH: 0 }[level];
}
