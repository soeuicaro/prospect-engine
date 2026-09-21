import "server-only";

/**
 * Minimal robots.txt parser — covers the common case (a `User-agent: *`
 * group with `Disallow` path prefixes). Not a full RFC 9309 implementation,
 * but enough to honor a blanket disallow or a disallowed path, which is
 * what matters for a single polite homepage fetch (see PROMPT MASTER §23).
 */
export async function isPathAllowed(origin: string, path: string, userAgent = "*"): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "ProspectEngine/1.0 (+website analyzer; single page fetch)" },
    });
    if (!res.ok) return true; // no robots.txt → allowed by default

    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim());

    let inRelevantGroup = false;
    let matchedSpecificAgent = false;
    const disallows: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();

      if (key === "user-agent") {
        const agent = value.toLowerCase();
        if (agent === userAgent.toLowerCase()) {
          inRelevantGroup = true;
          matchedSpecificAgent = true;
        } else if (agent === "*" && !matchedSpecificAgent) {
          inRelevantGroup = true;
        } else {
          inRelevantGroup = false;
        }
      } else if (key === "disallow" && inRelevantGroup && value) {
        disallows.push(value);
      }
    }

    return !disallows.some((rule) => path.startsWith(rule));
  } catch {
    // robots.txt unreachable — fail open (allowed), matching common crawler behavior.
    return true;
  }
}
