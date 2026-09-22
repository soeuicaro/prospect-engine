import { describe, expect, it } from "vitest";
import { BreakerRegistry, deriveHealth } from "./circuit-breaker";

const fail = { latencyMs: 10, error: "HTTP 503", kind: "HTTP_5XX", status: "SOURCE_ERROR" };
const ok = { latencyMs: 10, results: 5, status: "SOURCE_SUCCESS" };

describe("BreakerRegistry", () => {
  it("opens after N consecutive failures, half-opens after cooldown, closes on success", () => {
    let now = 0;
    const b = new BreakerRegistry([], { failureThreshold: 3, cooldownMs: 1000, now: () => now });
    b.recordFailure("osm", fail);
    b.recordFailure("osm", fail);
    expect(b.stateOf("osm")).toBe("CLOSED");
    b.recordFailure("osm", fail);
    expect(b.stateOf("osm")).toBe("OPEN");
    expect(b.canRequest("osm")).toBe(false);
    expect(b.msUntilRetry("osm")).toBe(1000);

    now = 1000;
    expect(b.stateOf("osm")).toBe("HALF_OPEN");
    expect(b.canRequest("osm")).toBe(true);
    b.recordSuccess("osm", ok);
    expect(b.stateOf("osm")).toBe("CLOSED");
    expect(b.get("osm").consecutiveFailures).toBe(0);
  });

  it("re-opens immediately when the half-open trial fails", () => {
    let now = 0;
    const b = new BreakerRegistry([], { failureThreshold: 2, cooldownMs: 100, now: () => now });
    b.recordFailure("x", fail);
    b.recordFailure("x", fail);
    now = 150;
    expect(b.stateOf("x")).toBe("HALF_OPEN");
    b.recordFailure("x", fail);
    expect(b.stateOf("x")).toBe("OPEN");
    expect(b.msUntilRetry("x")).toBe(100);
  });

  it("tracks dirty snapshots for persistence and a success-rate window", () => {
    const b = new BreakerRegistry([]);
    b.recordSuccess("a", ok);
    b.recordFailure("a", fail);
    expect(b.dirtySnapshots().map((s) => s.key)).toEqual(["a"]);
    expect(b.get("a").recentOutcomes).toEqual([true, false]);
  });

  it("manual reset closes the breaker", () => {
    const b = new BreakerRegistry([], { failureThreshold: 1 });
    b.recordFailure("a", fail);
    expect(b.canRequest("a")).toBe(false);
    b.reset("a");
    expect(b.canRequest("a")).toBe(true);
  });
});

describe("deriveHealth", () => {
  it("maps state + outcomes to HEALTHY/DEGRADED/DOWN/DISABLED/NOT_CONFIGURED", () => {
    const b = new BreakerRegistry([], { failureThreshold: 2, cooldownMs: 60_000 });
    expect(deriveHealth(null, { enabled: true, configured: true })).toBe("HEALTHY");
    expect(deriveHealth(null, { enabled: false, configured: true })).toBe("DISABLED");
    expect(deriveHealth(null, { enabled: true, configured: false })).toBe("NOT_CONFIGURED");
    b.recordSuccess("s", ok);
    expect(deriveHealth(b.get("s"), { enabled: true, configured: true })).toBe("HEALTHY");
    b.recordFailure("s", fail);
    expect(deriveHealth(b.get("s"), { enabled: true, configured: true })).toBe("DEGRADED");
    b.recordFailure("s", fail);
    expect(deriveHealth(b.get("s"), { enabled: true, configured: true })).toBe("DOWN");
  });
});
