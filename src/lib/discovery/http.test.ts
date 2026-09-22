import { describe, expect, it } from "vitest";
import { computeBackoff, requestWithPolicy, SourceRequestError, isRetryableKind } from "./http";
import { mockFetch, noSleep } from "./testing";

const base = { source: "osm_overpass" as const, url: "https://example.test/api", timeoutMs: 200, parse: (t: string) => JSON.parse(t) };

describe("requestWithPolicy", () => {
  it("returns data and one log on success", async () => {
    const { impl } = mockFetch({ "example.test": [{ status: 200, body: { ok: 1 } }] });
    const out = await requestWithPolicy({ ...base, retries: 2 }, { fetchImpl: impl, sleep: noSleep });
    expect(out.data).toEqual({ ok: 1 });
    expect(out.attempts).toBe(1);
    expect(out.logs).toHaveLength(1);
    expect(out.logs[0].httpStatus).toBe(200);
  });

  it("retries 429 with backoff and succeeds (attempt 2/3)", async () => {
    const sleeps: number[] = [];
    const { impl, calls } = mockFetch({ "example.test": [{ status: 429 }, { status: 200, body: { ok: 1 } }] });
    const out = await requestWithPolicy(
      { ...base, retries: 2, backoffBaseMs: 100 },
      { fetchImpl: impl, sleep: async (ms) => void sleeps.push(ms), random: () => 1 }
    );
    expect(calls).toHaveLength(2);
    expect(out.attempts).toBe(2);
    expect(sleeps).toEqual([100]);
    expect(out.logs.map((l) => l.errorKind)).toEqual(["RATE_LIMITED", null]);
    expect(out.logs[1].attempt).toBe(2);
    expect(out.logs[1].maxAttempts).toBe(3);
  });

  it("honors Retry-After (capped by maxBackoff)", async () => {
    const sleeps: number[] = [];
    const { impl } = mockFetch({ "example.test": [{ status: 429, headers: { "retry-after": "2" } }, { status: 200, body: {} }] });
    await requestWithPolicy({ ...base, retries: 1, maxBackoffMs: 5000 }, { fetchImpl: impl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after max attempts on 500 and reports every attempt", async () => {
    const { impl, calls } = mockFetch({ "example.test": [{ status: 500, body: "boom" }] });
    const err = await requestWithPolicy({ ...base, retries: 2 }, { fetchImpl: impl, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceRequestError);
    expect(err.kind).toBe("HTTP_5XX");
    expect(err.httpStatus).toBe(500);
    expect(calls).toHaveLength(3);
    expect((err as { logs: unknown[] }).logs).toHaveLength(3);
  });

  it("does NOT retry 400 (malformed query) or 403", async () => {
    for (const status of [400, 403]) {
      const { impl, calls } = mockFetch({ "example.test": [{ status }] });
      const err = await requestWithPolicy({ ...base, retries: 3 }, { fetchImpl: impl, sleep: noSleep }).catch((e) => e);
      expect(calls).toHaveLength(1);
      expect(err.kind).toBe(status === 400 ? "HTTP_4XX" : "BLOCKED");
      expect(err.retryable).toBe(false);
    }
  });

  it("normalizes a timeout and retries it", async () => {
    const { impl, calls } = mockFetch({ "example.test": [{ throws: "timeout" }, { status: 200, body: { ok: 1 } }] });
    const out = await requestWithPolicy({ ...base, timeoutMs: 30, retries: 1 }, { fetchImpl: impl, sleep: noSleep });
    expect(calls).toHaveLength(2);
    expect(out.logs[0].errorKind).toBe("TIMEOUT");
  });

  it("normalizes network errors", async () => {
    const { impl } = mockFetch({ "example.test": [{ throws: "network" }] });
    const err = await requestWithPolicy({ ...base, retries: 0 }, { fetchImpl: impl, sleep: noSleep }).catch((e) => e);
    expect(err.kind).toBe("NETWORK");
    expect(err.message).toContain("ECONNRESET");
  });

  it("treats invalid JSON on 200 as PARSE (not retried)", async () => {
    const { impl, calls } = mockFetch({ "example.test": [{ status: 200, body: "<html>oops</html>" }] });
    const err = await requestWithPolicy({ ...base, retries: 2 }, { fetchImpl: impl, sleep: noSleep }).catch((e) => e);
    expect(err.kind).toBe("PARSE");
    expect(calls).toHaveLength(1);
  });

  it("supports validate() turning a 200 into a retryable PARTIAL_RESPONSE", async () => {
    const { impl, calls } = mockFetch({ "example.test": [{ status: 200, body: { remark: "runtime error" } }, { status: 200, body: { ok: 1 } }] });
    const out = await requestWithPolicy(
      { ...base, retries: 1, validate: (d: { remark?: string }) => (d.remark ? { kind: "PARTIAL_RESPONSE", message: d.remark } : null) },
      { fetchImpl: impl, sleep: noSleep }
    );
    expect(calls).toHaveLength(2);
    expect(out.data).toEqual({ ok: 1 });
  });

  it("stops immediately when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const { impl, calls } = mockFetch({ "example.test": [{ status: 200, body: {} }] });
    const err = await requestWithPolicy({ ...base, retries: 3, signal: controller.signal }, { fetchImpl: impl, sleep: noSleep }).catch((e) => e);
    expect(err.kind).toBe("ABORTED");
    expect(calls).toHaveLength(0);
  });
});

describe("retry classification + backoff", () => {
  it("classifies retryable kinds", () => {
    expect(isRetryableKind("RATE_LIMITED", 429)).toBe(true);
    expect(isRetryableKind("HTTP_5XX", 503)).toBe(true);
    expect(isRetryableKind("HTTP_5XX", 501)).toBe(false);
    expect(isRetryableKind("HTTP_4XX", 400)).toBe(false);
    expect(isRetryableKind("BLOCKED", 403)).toBe(false);
    expect(isRetryableKind("TIMEOUT", null)).toBe(true);
  });

  it("grows exponentially with jitter in [0.5, 1]", () => {
    expect(computeBackoff(1, 1000, 10_000, () => 0)).toBe(500);
    expect(computeBackoff(2, 1000, 10_000, () => 1)).toBe(2000);
    expect(computeBackoff(5, 1000, 3000, () => 1)).toBe(3000);
  });
});
