/**
 * Per-host throttle: a FIFO queue guaranteeing at least `minIntervalMs`
 * between request STARTS to the same host (Nominatim's policy is ≤1 req/s).
 *
 * Scope: one server process. Serverless instances do not share memory, so
 * this cannot enforce a global limit — it prevents one search from
 * bursting (the real risk: pagination + keyword variations fired at once).
 * Search volume itself is human-triggered and low. See OSM.md.
 */

export interface HostThrottle {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}

export function createHostThrottle(
  minIntervalMs: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): HostThrottle {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      // Serialize request STARTS only — the request itself runs
      // concurrently with the next item's wait, so a slow response
      // doesn't block the queue.
      const gate = chain.then(async () => {
        const wait = lastStart + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        lastStart = now();
      });
      chain = gate.catch(() => undefined);
      return gate.then(fn);
    },
  };
}

const registry = new Map<string, HostThrottle>();

/** Process-wide throttle for a host, created on first use. */
export function throttleFor(host: string, requestsPerSecond: number): HostThrottle {
  const key = `${host}@${requestsPerSecond}`;
  let throttle = registry.get(key);
  if (!throttle) {
    throttle = createHostThrottle(Math.ceil(1000 / Math.max(0.1, requestsPerSecond)));
    registry.set(key, throttle);
  }
  return throttle;
}
