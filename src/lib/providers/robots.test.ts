import { describe, expect, it, vi, afterEach } from "vitest";
import { isPathAllowed } from "./robots";

describe("isPathAllowed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows everything when robots.txt is missing (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    );
    expect(await isPathAllowed("https://example.com", "/")).toBe(true);
  });

  it("disallows a path blocked for all agents", async () => {
    const body = "User-agent: *\nDisallow: /private";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );
    expect(await isPathAllowed("https://example.com", "/private/page")).toBe(false);
    expect(await isPathAllowed("https://example.com", "/public")).toBe(true);
  });

  it("fails open when robots.txt cannot be fetched at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    expect(await isPathAllowed("https://example.com", "/")).toBe(true);
  });
});
