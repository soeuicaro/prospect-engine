/**
 * Website discovery enrichment: reads ONLY the homepage of a website we
 * already know for the company (never searches for sites by name), via the
 * existing robots.txt-respecting Website Analyzer, and returns contact
 * channels the company itself publishes (§73: official website first).
 */

import type { WebsiteAnalysisResult } from "@/lib/providers/website-analyzer";
import { domainMatchesName, normalizeSocial, websiteDomain } from "../normalize";
import { throttleFor } from "../rate-limit";
import type { SocialMap, UnifiedCompany } from "../types";
import type { EnrichmentPatch, EnrichmentSource, SourceEnv } from "./base";

type Analyze = (url: string) => Promise<WebsiteAnalysisResult>;

export function createWebsiteSource(deps: { analyze: Analyze }): EnrichmentSource {
  return {
    key: "website_discovery",
    kind: "enrichment",
    cost: "FREE",
    capabilities: {
      canSearch: false,
      canEnrich: true,
      canGeocode: false,
      canReturnPhone: true,
      canReturnWebsite: true,
      canReturnEmail: true,
      canReturnAddress: false,
      canReturnCoordinates: false,
      canReturnCnpj: false,
      canReturnSocials: true,
      supportsPagination: "none",
    },
    isConfigured: () => true,
    appliesTo: (c: UnifiedCompany) => Boolean(websiteDomain(c.website)),

    async enrich(company: UnifiedCompany, env: SourceEnv): Promise<EnrichmentPatch> {
      const started = Date.now();
      const url = company.website!;
      const host = websiteDomain(url)!;
      const match = domainMatchesName(host, company.name);
      try {
        const result = await throttleFor("website-analyzer", env.config.rateLimitPerSec).schedule(() =>
          withTimeout(deps.analyze(url), env.config.timeoutMs, env.signal)
        );
        const log = {
          source: "website_discovery" as const,
          endpoint: host,
          query: url,
          httpStatus: null,
          latencyMs: Date.now() - started,
          attempt: 1,
          maxAttempts: 1,
          errorKind: result.status === "TIMEOUT" ? ("TIMEOUT" as const) : null,
          errorMessage: result.status === "ACTIVE" ? null : `Website ${result.status}`,
          resultsCount: 1,
          fallbackActivated: false,
          at: new Date(started).toISOString(),
        };
        if (result.status !== "ACTIVE") {
          return {
            source: "website_discovery",
            status: result.status === "TIMEOUT" ? "SOURCE_TIMEOUT" : "NO_RESULTS_FROM_SOURCE",
            fields: {},
            message: `Site ${result.status === "TIMEOUT" ? "não respondeu" : "indisponível"} (${result.flags.join(", ") || result.status})`,
            logs: [log],
            durationMs: Date.now() - started,
          };
        }
        const socials: SocialMap = {};
        for (const [key, value] of Object.entries(result.socialLinks) as [keyof SocialMap, string][]) {
          const v = normalizeSocial(key, value);
          if (v) socials[key] = v;
        }
        return {
          source: "website_discovery",
          status: match === "LOW" ? "SOURCE_SUCCESS_WITH_WARNINGS" : "SOURCE_SUCCESS",
          fields: { phone: result.phone, email: result.email, whatsapp: result.whatsapp, socials },
          message: match === "LOW" ? `Domínio ${host} não parece corresponder ao nome da empresa — revise.` : null,
          logs: [log],
          durationMs: Date.now() - started,
        };
      } catch (err) {
        return {
          source: "website_discovery",
          status: "SOURCE_TIMEOUT",
          fields: {},
          message: err instanceof Error ? err.message : "Falha ao analisar o site",
          logs: [],
          durationMs: Date.now() - started,
        };
      }
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms);
    signal.addEventListener("abort", () => reject(new Error("Cancelado")), { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
