import type { UnifiedCompany } from "./types";

/**
 * Estimated public visibility ("how well-known / how searched-for") of a
 * company, 0..100. None of our sources carry real popularity data (review
 * counts, ratings, search volume), so this is a proxy built only from
 * signals we already have: how many sources list it, whether it has a site
 * and social profiles, what that site shows, and its registered size.
 *
 * Used to sort results — low visibility often means a business that hasn't
 * invested in being found yet, i.e. a better prospect for marketing work.
 */
export interface Visibility {
  score: number;
  reasons: string[];
}

const SIZE_POINTS: Record<string, number> = {
  MEI: 0,
  MICRO_LOCAL: 0,
  ME: 3,
  PEQUENA: 3,
  EPP: 8,
  MEDIA: 8,
  DEMAIS: 15,
  GRANDE_REGIONAL: 15,
};

type VisibilityInput = Pick<UnifiedCompany, "sourceKeys" | "website" | "socials" | "email" | "web" | "companySize" | "openingHours">;

export function visibilityOf(c: VisibilityInput): Visibility {
  const reasons: string[] = [];
  let score = 0;

  const sources = new Set(c.sourceKeys).size;
  if (sources > 1) {
    const pts = Math.min(36, (sources - 1) * 12);
    score += pts;
    reasons.push(`aparece em ${sources} fontes (+${pts})`);
  }

  if (c.website) {
    score += 20;
    reasons.push("tem site (+20)");
  }

  const socials = Object.values(c.socials ?? {}).filter(Boolean).length;
  if (socials) {
    const pts = Math.min(32, socials * 8);
    score += pts;
    reasons.push(`${socials} rede(s) social(is) (+${pts})`);
  }

  if (c.web) {
    if (c.web.hasVideo) {
      score += 5;
      reasons.push("vídeo no site (+5)");
    }
    if (c.web.hasBlog) {
      score += 5;
      reasons.push("blog no site (+5)");
    }
  }

  if (c.email) {
    score += 3;
    reasons.push("e-mail público (+3)");
  }
  if (c.openingHours) {
    score += 3;
    reasons.push("horário publicado (+3)");
  }

  const sizePts = c.companySize ? SIZE_POINTS[c.companySize] ?? 0 : 0;
  if (sizePts) {
    score += sizePts;
    reasons.push(`porte ${c.companySize} (+${sizePts})`);
  }

  return { score: Math.min(100, score), reasons };
}
