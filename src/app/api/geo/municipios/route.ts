/**
 * GET /api/geo/municipios — every Brazilian municipality as a compact
 * `[name, uf][]` list (IBGE Localidades API, public, no key). Used by the
 * city autocomplete in /discovery. The ~2 MB IBGE payload is fetched once
 * per server instance and shrunk to ~110 KB.
 */

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";

let memo: { at: number; data: [string, string][] } | null = null;
const TTL_MS = 7 * 86_400_000;

export async function GET() {
  if (!memo || Date.now() - memo.at > TTL_MS) {
    try {
      const res = await fetch(IBGE_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`IBGE HTTP ${res.status}`);
      const rows = (await res.json()) as { "municipio-nome": string; "UF-sigla": string }[];
      memo = { at: Date.now(), data: rows.map((r) => [r["municipio-nome"], r["UF-sigla"]]) };
    } catch (err) {
      if (!memo) {
        console.error("[geo] IBGE municipios failed", err);
        return Response.json({ error: "Lista de municípios indisponível no momento." }, { status: 502 });
      }
    }
  }
  return Response.json(memo.data, { headers: { "Cache-Control": "public, max-age=86400" } });
}
