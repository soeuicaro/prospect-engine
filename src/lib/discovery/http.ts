/**
 * The ONE request wrapper every external discovery/enrichment source goes
 * through (no scattered fetch() calls). Provides:
 *
 * - per-attempt timeout (AbortController) + caller abort signal + deadline
 * - bounded retries with exponential backoff + full jitter
 * - Retry-After support (capped)
 * - error normalization into RequestErrorKind
 * - retryable vs non-retryable classification
 * - one RequestLog per attempt (endpoint, query, status, latency, attempt n/N)
 * - optional per-host throttle (see rate-limit.ts)
 *
 * Everything time/randomness related is injectable so tests are
 * deterministic (see http.test.ts).
 */

import type { RequestErrorKind, RequestLog, SourceKey } from "./types";
import type { HostThrottle } from "./rate-limit";

export const DEFAULT_USER_AGENT =
  "ProspectEngine/2.0 (local B2B prospecting tool; low-volume, human-triggered searches)";

export class SourceRequestError extends Error {
  readonly kind: RequestErrorKind;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly endpoint: string;
  readonly attempts: number;
  readonly latencyMs: number;

  constructor(init: {
    kind: RequestErrorKind;
    message: string;
    httpStatus?: number | null;
    endpoint: string;
    attempts?: number;
    latencyMs?: number;
  }) {
    super(init.message);
    this.name = "SourceRequestError";
    this.kind = init.kind;
    this.httpStatus = init.httpStatus ?? null;
    this.retryable = isRetryableKind(init.kind, this.httpStatus);
    this.endpoint = init.endpoint;
    this.attempts = init.attempts ?? 1;
    this.latencyMs = init.latencyMs ?? 0;
  }
}

/**
 * Retry: 429, 500, 502, 503, 504, network errors, timeouts, and upstream
 * "partial response" markers (e.g. Overpass `remark: runtime error`).
 * Never retry: other 4xx (400 malformed query, 401, 403 blocked), parse
 * errors of a 2xx body, caller aborts, missing configuration.
 */
export function isRetryableKind(kind: RequestErrorKind, status: number | null): boolean {
  switch (kind) {
    case "TIMEOUT":
    case "RATE_LIMITED":
    case "NETWORK":
    case "PARTIAL_RESPONSE":
      return true;
    case "HTTP_5XX":
      return status === null || [500, 502, 503, 504].includes(status);
    default:
      return false;
  }
}

export function classifyHttpStatus(status: number): RequestErrorKind | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429) return "RATE_LIMITED";
  if (status === 403 || status === 401 || status === 451) return "BLOCKED";
  if (status >= 500) return "HTTP_5XX";
  return "HTTP_4XX";
}

export interface HttpDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface RequestOptions<T> {
  source: SourceKey;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Human-readable query for logs (URL params / QL), truncated on log. */
  queryForLog?: string;
  timeoutMs: number;
  retries: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  signal?: AbortSignal;
  /** Absolute epoch ms after which no new attempt / sleep may start. */
  deadline?: number;
  throttle?: HostThrottle;
  parse: (text: string, res: { status: number; headers: Headers }) => T;
  /**
   * Inspect a successfully parsed payload; return an error kind to treat it
   * as a failure (e.g. Overpass 200 + "runtime error" remark).
   */
  validate?: (data: T) => { kind: RequestErrorKind; message: string } | null;
  countResults?: (data: T) => number;
  fallbackActivated?: boolean;
}

export interface RequestOutcome<T> {
  data: T;
  httpStatus: number;
  attempts: number;
  latencyMs: number;
  logs: RequestLog[];
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter: delay ∈ [0.5·d, d], d = base·2^(n-1). */
export function computeBackoff(attemptJustFailed: number, baseMs: number, maxMs: number, random: () => number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attemptJustFailed - 1));
  return Math.round(exp * (0.5 + random() * 0.5));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function endpointLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}

function truncate(text: string | undefined, max = 600): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function requestWithPolicy<T>(opts: RequestOptions<T>, deps: HttpDeps = {}): Promise<RequestOutcome<T>> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const maxAttempts = Math.max(1, opts.retries + 1);
  const base = opts.backoffBaseMs ?? 800;
  const maxBackoff = opts.maxBackoffMs ?? 6000;
  const endpoint = endpointLabel(opts.url);
  const logs: RequestLog[] = [];
  const started = now();
  let lastError: SourceRequestError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new SourceRequestError({ kind: "ABORTED", message: "Busca cancelada", endpoint, attempts: attempt - 1 });
    }
    if (opts.deadline && now() >= opts.deadline) {
      throw lastError ?? new SourceRequestError({ kind: "TIMEOUT", message: "Prazo geral da busca atingido", endpoint, attempts: attempt - 1 });
    }

    const attemptStart = now();
    const remaining = opts.deadline ? Math.max(250, opts.deadline - attemptStart) : Infinity;
    const timeoutMs = Math.min(opts.timeoutMs, remaining);

    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onCallerAbort, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let httpStatus: number | null = null;
    try {
      // The timeout clock starts when the request actually starts — time
      // spent queued in the per-host throttle doesn't count against it.
      const doFetch = () => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        return fetchImpl(opts.url, {
          method: opts.method ?? "GET",
          headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "application/json", ...opts.headers },
          body: opts.body,
          signal: controller.signal,
          cache: "no-store",
        });
      };
      const res = opts.throttle ? await opts.throttle.schedule(doFetch) : await doFetch();
      httpStatus = res.status;
      const text = await res.text();

      const statusKind = classifyHttpStatus(res.status);
      if (statusKind) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const err = new SourceRequestError({
          kind: statusKind,
          message: `HTTP ${res.status}${text ? `: ${truncate(text.replace(/\s+/g, " "), 160)}` : ""}`,
          httpStatus: res.status,
          endpoint,
          attempts: attempt,
          latencyMs: now() - started,
        });
        (err as SourceRequestError & { retryAfterMs?: number | null }).retryAfterMs = retryAfter;
        throw err;
      }

      let data: T;
      try {
        data = opts.parse(text, { status: res.status, headers: res.headers });
      } catch (parseErr) {
        throw new SourceRequestError({
          kind: "PARSE",
          message: `Resposta inválida (${parseErr instanceof Error ? parseErr.message : "parse error"})`,
          httpStatus: res.status,
          endpoint,
          attempts: attempt,
        });
      }

      const invalid = opts.validate?.(data);
      if (invalid) {
        throw new SourceRequestError({ kind: invalid.kind, message: invalid.message, httpStatus: res.status, endpoint, attempts: attempt });
      }

      const latencyMs = now() - attemptStart;
      logs.push({
        source: opts.source,
        endpoint,
        query: truncate(opts.queryForLog),
        httpStatus: res.status,
        latencyMs,
        attempt,
        maxAttempts,
        errorKind: null,
        errorMessage: null,
        resultsCount: opts.countResults ? opts.countResults(data) : null,
        fallbackActivated: Boolean(opts.fallbackActivated),
        at: new Date(attemptStart).toISOString(),
      });
      return { data, httpStatus: res.status, attempts: attempt, latencyMs: now() - started, logs };
    } catch (raw) {
      let err: SourceRequestError;
      if (raw instanceof SourceRequestError) {
        err = raw;
      } else if (opts.signal?.aborted) {
        err = new SourceRequestError({ kind: "ABORTED", message: "Busca cancelada", endpoint, attempts: attempt });
      } else if (timedOut) {
        err = new SourceRequestError({ kind: "TIMEOUT", message: `Timeout após ${timeoutMs}ms`, endpoint, attempts: attempt });
      } else {
        const cause = raw instanceof Error ? (raw.cause as { code?: string } | undefined)?.code ?? raw.message : String(raw);
        err = new SourceRequestError({ kind: "NETWORK", message: `Falha de rede (${cause})`, endpoint, attempts: attempt });
      }

      logs.push({
        source: opts.source,
        endpoint,
        query: truncate(opts.queryForLog),
        httpStatus: err.httpStatus ?? httpStatus,
        latencyMs: now() - attemptStart,
        attempt,
        maxAttempts,
        errorKind: err.kind,
        errorMessage: err.message,
        resultsCount: null,
        fallbackActivated: Boolean(opts.fallbackActivated),
        at: new Date(attemptStart).toISOString(),
      });

      const final = new SourceRequestError({
        kind: err.kind,
        message: err.message,
        httpStatus: err.httpStatus ?? httpStatus,
        endpoint,
        attempts: attempt,
        latencyMs: now() - started,
      });
      (final as SourceRequestError & { logs?: RequestLog[] }).logs = logs;
      lastError = final;

      if (err.kind === "ABORTED" || !err.retryable || attempt >= maxAttempts) throw final;

      const retryAfter = (err as SourceRequestError & { retryAfterMs?: number | null }).retryAfterMs ?? null;
      const delay = Math.min(maxBackoff, retryAfter ?? computeBackoff(attempt, base, maxBackoff, random));
      if (opts.deadline && now() + delay >= opts.deadline) throw final;
      try {
        await sleep(delay, opts.signal);
      } catch {
        throw new SourceRequestError({ kind: "ABORTED", message: "Busca cancelada", endpoint, attempts: attempt });
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  throw lastError ?? new SourceRequestError({ kind: "NETWORK", message: "Falha desconhecida", endpoint });
}

/** Logs attached to a thrown SourceRequestError (every attempt, not just the last). */
export function logsFromError(err: unknown): RequestLog[] {
  return (err as { logs?: RequestLog[] } | null)?.logs ?? [];
}

export function jsonParser<T>(text: string): T {
  return JSON.parse(text) as T;
}
