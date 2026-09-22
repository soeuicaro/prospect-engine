/**
 * Circuit breaker per source (and per Overpass mirror).
 *
 *   CLOSED ──(N consecutive failures)──▶ OPEN ──(cooldown elapsed)──▶ HALF_OPEN
 *     ▲                                                              │
 *     └────────────────(trial request succeeds)──────────────────────┘
 *                         (trial fails → OPEN again, cooldown restarts)
 *
 * State is serializable so the orchestrator can hydrate it from the
 * `source_health` table at the start of a search and persist it after —
 * serverless instances share no memory, so the DB is the source of truth.
 * An OPEN breaker never deletes/disables the integration; it just skips
 * calls until the cooldown passes.
 */

import type { BreakerState, HealthStatus } from "./types";

export interface BreakerSnapshot {
  key: string;
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  lastErrorKind: string | null;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  recentOutcomes: boolean[]; // most recent last, max RECENT_WINDOW
  totalResults: number;
  runs: number;
  lastCheckedAt: number | null;
  dirty?: boolean;
}

export const RECENT_WINDOW = 20;

export interface BreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

export const DEFAULT_BREAKER_OPTIONS: BreakerOptions = { failureThreshold: 3, cooldownMs: 2 * 60_000 };

export function emptySnapshot(key: string): BreakerSnapshot {
  return {
    key,
    state: "CLOSED",
    consecutiveFailures: 0,
    openedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastErrorKind: null,
    lastStatus: null,
    lastLatencyMs: null,
    avgLatencyMs: null,
    successCount: 0,
    failureCount: 0,
    recentOutcomes: [],
    totalResults: 0,
    runs: 0,
    lastCheckedAt: null,
  };
}

export class BreakerRegistry {
  private snapshots = new Map<string, BreakerSnapshot>();
  private readonly opts: BreakerOptions;
  private readonly now: () => number;

  constructor(initial: BreakerSnapshot[] = [], opts: Partial<BreakerOptions> = {}) {
    this.opts = { ...DEFAULT_BREAKER_OPTIONS, ...opts };
    this.now = opts.now ?? Date.now;
    for (const s of initial) this.snapshots.set(s.key, { ...s, dirty: false });
  }

  get(key: string): BreakerSnapshot {
    let s = this.snapshots.get(key);
    if (!s) {
      s = emptySnapshot(key);
      this.snapshots.set(key, s);
    }
    return s;
  }

  /** Effective state right now (OPEN turns HALF_OPEN once cooldown passes). */
  stateOf(key: string): BreakerState {
    const s = this.get(key);
    if (s.state === "OPEN" && s.openedAt !== null && this.now() - s.openedAt >= this.opts.cooldownMs) {
      return "HALF_OPEN";
    }
    return s.state;
  }

  /** Whether a call may be attempted now. HALF_OPEN allows a trial call. */
  canRequest(key: string): boolean {
    return this.stateOf(key) !== "OPEN";
  }

  msUntilRetry(key: string): number {
    const s = this.get(key);
    if (this.stateOf(key) !== "OPEN" || s.openedAt === null) return 0;
    return Math.max(0, this.opts.cooldownMs - (this.now() - s.openedAt));
  }

  recordSuccess(key: string, info: { latencyMs: number; results: number; status: string }): void {
    const s = this.get(key);
    const t = this.now();
    s.state = "CLOSED";
    s.consecutiveFailures = 0;
    s.openedAt = null;
    s.lastSuccessAt = t;
    s.lastCheckedAt = t;
    s.lastStatus = info.status;
    s.lastLatencyMs = info.latencyMs;
    s.avgLatencyMs = s.avgLatencyMs === null ? info.latencyMs : Math.round(s.avgLatencyMs * 0.7 + info.latencyMs * 0.3);
    s.successCount += 1;
    s.runs += 1;
    s.totalResults += info.results;
    s.recentOutcomes = [...s.recentOutcomes, true].slice(-RECENT_WINDOW);
    s.dirty = true;
  }

  recordFailure(key: string, info: { latencyMs: number; error: string; kind: string; status: string }): void {
    const s = this.get(key);
    const t = this.now();
    const effective = this.stateOf(key);
    s.consecutiveFailures += 1;
    s.lastErrorAt = t;
    s.lastCheckedAt = t;
    s.lastError = info.error.slice(0, 500);
    s.lastErrorKind = info.kind;
    s.lastStatus = info.status;
    s.lastLatencyMs = info.latencyMs;
    s.failureCount += 1;
    s.runs += 1;
    s.recentOutcomes = [...s.recentOutcomes, false].slice(-RECENT_WINDOW);
    if (effective === "HALF_OPEN" || s.consecutiveFailures >= this.opts.failureThreshold) {
      s.state = "OPEN";
      s.openedAt = t;
    }
    s.dirty = true;
  }

  /** Manual reset from the admin UI. */
  reset(key: string): void {
    const s = this.get(key);
    s.state = "CLOSED";
    s.consecutiveFailures = 0;
    s.openedAt = null;
    s.dirty = true;
  }

  dirtySnapshots(): BreakerSnapshot[] {
    return [...this.snapshots.values()].filter((s) => s.dirty);
  }

  all(): BreakerSnapshot[] {
    return [...this.snapshots.values()];
  }
}

export function successRate(s: BreakerSnapshot): number | null {
  if (!s.recentOutcomes.length) return null;
  return s.recentOutcomes.filter(Boolean).length / s.recentOutcomes.length;
}

/** Health derived from breaker + recent outcomes + config. */
export function deriveHealth(
  s: BreakerSnapshot | null,
  opts: { enabled: boolean; configured: boolean; cooldownMs?: number; now?: number }
): HealthStatus {
  if (!opts.configured) return "NOT_CONFIGURED";
  if (!opts.enabled) return "DISABLED";
  if (!s || s.runs === 0) return "HEALTHY";
  const now = opts.now ?? Date.now();
  const cooldown = opts.cooldownMs ?? DEFAULT_BREAKER_OPTIONS.cooldownMs;
  if (s.state === "OPEN" && s.openedAt !== null && now - s.openedAt < cooldown) return "DOWN";
  const rate = successRate(s);
  if (s.state !== "CLOSED" || (rate !== null && rate < 0.8) || s.consecutiveFailures > 0) return "DEGRADED";
  if (s.lastStatus === "SOURCE_PARTIAL_RESULTS") return "DEGRADED";
  return "HEALTHY";
}
