/**
 * Message Template Engine. Resolves `{variable}` placeholders. NEVER
 * fabricates a value for a variable that has no real evidence — an unmet
 * variable is left as an explicit gap the user must fill in before sending
 * (see PROMPT MASTER §31 — personalization must never be invented).
 */

export interface TemplateVariables {
  first_name?: string | null;
  company_name?: string | null;
  trade_name?: string | null;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  instagram?: string | null;
  offer?: string | null;
  observation?: string | null;
  pain_point?: string | null;
  content_idea?: string | null;
  sender_name?: string | null;
}

const VARIABLE_PATTERN = /\{(\w+)\}/g;

export interface RenderedTemplate {
  text: string;
  missingVariables: string[];
}

export function renderTemplate(body: string, variables: TemplateVariables): RenderedTemplate {
  const missingVariables: string[] = [];

  const text = body.replace(VARIABLE_PATTERN, (match, key: string) => {
    const value = (variables as Record<string, string | null | undefined>)[key];
    if (value === undefined) {
      // Unknown variable name entirely — keep the placeholder visible.
      missingVariables.push(key);
      return match;
    }
    if (value === null || value === "") {
      missingVariables.push(key);
      return `[${key}?]`;
    }
    return value;
  });

  return { text, missingVariables };
}

/**
 * Personalization level (§31): only claim a higher level when the
 * underlying evidence actually exists — computed from which variables are
 * genuinely available, not asserted by the template author.
 */
export function computeAchievablePersonalizationLevel(variables: TemplateVariables): 0 | 1 | 2 | 3 | 4 {
  const hasNameAndCompany = Boolean(variables.first_name) && Boolean(variables.company_name);
  const hasIndustry = Boolean(variables.industry);
  const hasObservation = Boolean(variables.observation);
  const hasContentIdea = Boolean(variables.content_idea);

  if (hasNameAndCompany && hasIndustry && hasObservation && hasContentIdea) return 4;
  if (hasNameAndCompany && hasIndustry && hasObservation) return 3;
  if (hasNameAndCompany && hasIndustry) return 2;
  if (hasNameAndCompany) return 1;
  return 0;
}
