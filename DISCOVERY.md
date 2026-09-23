# Discovery Engine

Multi-source company discovery. **A source failure is never a search failure.**

Code: `src/lib/discovery/` · UI: `/discovery` · Admin: `/settings/sources`, `/admin/discovery`, `/admin/integrations/osm`, `/admin/integrations/maps`.

## Flow

```
POST /api/discovery/search (NDJSON stream: phase / source / progress / done)
  → normalizeSearchContext (zod; "Sobral/CE", "Sobral, Ceará" → Sobral/CE)
  → cache lookup (deterministic SHA-256 of what is searched; TTL = min TTL of sources used)
  → Industry Keyword Expansion (industries.ts: OSM tags / text terms / CNAEs per mode)
  → geocode in parallel (cache → Nominatim → Photon)            ← Overpass does NOT wait for it
  → sources in parallel, each isolated (throw/timeout = that source's status)
        places_overture (Overture Maps, imported per city — tools/places-importer)
        local_db  ┐
        overpass  ├→ fallback chain on failure OR low yield (<20): overpass → nominatim → photon
        nominatim │
        photon    ┘
  → automatic keyword variations if still low (disclosed in diagnostics; never radius/CNAE/cities)
  → merge/dedup (merge.ts) → visible filters → rank → diagnostics + suggestions
  → persisted: discovery_searches, source_request_logs, source_health (breakers)
Client then runs progressive enrichment: POST /api/discovery/enrich in batches of 5, top-ranked first
("Enriquecer todas as restantes" runs the same batches over every non-enriched row).
City/UF inputs autocomplete from IBGE (`GET /api/geo/municipios`, memoized per server instance).
Nothing enters the pipeline until the user selects rows and clicks "Enviar para o pipeline" (stage NEW).
```

Global deadline per depth: FAST 20s, BALANCED 40s, DEEP 55s. At the deadline, in-flight sources are
aborted and get 1.5s to hand back what they have → `PARTIAL`. The user can cancel (closes the stream,
aborts every request).

## Modes and depth

| | PRECISE | BALANCED (default) | BROAD |
|---|---|---|---|
| OSM tags | primary (`amenity=restaurant`) | + related (`fast_food`, `food_court`) | + broad (cafe, bar, pub, bakery…) |
| Text terms | primary | + 2 secondary | + all secondary + synonyms |
| OSM name matching | – | – | yes (separate Overpass request) |
| CNAEs (local DB) | primary | primary (+ related if checked) | primary + related |
| Extra filters | CNPJ ATIVA/SUSPENSA, drops LOW confidence | none | none |

Depth: FAST = primary sources only (local DB + Overpass; fallbacks still fire), no auto-enrichment ·
BALANCED = all enabled free sources + enrichment of top N (default 50 in the UI) · DEEP = + enrichment of ≥50.

## Source run statuses

`SOURCE_SUCCESS`, `SOURCE_SUCCESS_WITH_WARNINGS`, `SOURCE_PARTIAL_RESULTS`, `NO_RESULTS_FROM_SOURCE`,
`SOURCE_ERROR`, `SOURCE_TIMEOUT`, `SOURCE_RATE_LIMITED`, `SOURCE_BLOCKED`, `SOURCE_NOT_CONFIGURED`,
`SOURCE_DISABLED`, `SOURCE_CIRCUIT_OPEN`. Search outcome: `SUCCESS`, `SUCCESS_WITH_WARNINGS` (a source
failed, others worked), `PARTIAL` (deadline, cancel, or a source returned partial data), `NO_RESULTS`
(sources answered, nothing matched), `FAILED` (every source failed — "Tentar novamente" / "Ver status das fontes").

## Base vs pipeline

`companies` is the prospecting base (CNPJ import, CSV, manual). Only rows with `pipeline_stage_id`
appear on the pipeline board. `cnpj_sync.py` inserts WITHOUT a stage (unless `--to-pipeline`);
"Enviar para o pipeline" in Discovery sets stage NEW on new and on stage-less existing companies.
Badges: "na base" (companyId, no stage) vs "no pipeline".

## Dedup (merge.ts)

Blocking keys: OSM element id, local company id, CNPJ, website domain (platform hosts like
instagram/ifood never count), normalized phone, significant name token, ~200 m geo cell. Never name alone.

| Confidence | Examples | Action |
|---|---|---|
| EXACT | same OSM element across Overpass/Nominatim/Photon; local company already linked to it; same CNPJ | auto-merge |
| HIGH | same domain/phone + similar name; identical normalized name (same city); same token set + ≤150 m | auto-merge |
| MEDIUM | similar name + ≤300 m; shared phone with dissimilar name | `possibleDuplicates`, NEEDS_REVIEW |
| LOW | similar name only; names differing by a number | listed only |

Guards: different CNPJs or incompatible cities never merge (also transitively, cluster-level).

Field merge: every value keeps `{source, confidence, collectedAt, verifiedAt}`; winner = source priority
per field group (configurable in `/settings/sources`) → confidence → recency (≤30d +2, ≤180d +1, >365d −2).
Different values on CNPJ/phone/email/website/street/number/CEP/instagram become **conflicts** (never
silently replaced) — chosen in the company page after import. All phones are kept.

## Filters (always visible as "Filtros ativos")

- city: address in another city (off in radius mode)
- outside_area: no city in address and coordinates outside the geocoded bbox
- cnpj_status: only when the user asks ("Somente CNPJ ativo") or PRECISE; companies without CNPJ are kept
- low_confidence: PRECISE only

Missing phone/website/Instagram/CNPJ is **never** a filter. Every removal is counted in the funnel.

## Limits (the "only 2 results" audit)

| Limit | Value | Where |
|---|---|---|
| requested (goal) | user input, default 100 | a target — results are NOT truncated to it; "Mostrar top N" is a view toggle |
| system | 1500 unique per search | `SYSTEM_RESULT_LIMIT` in context.ts, shown in debug |
| Overpass | 1000 elements (`out center tags 1000`) | configurable |
| Nominatim | 40/page (API max) × 3 pages per term | exclude_place_ids pagination |
| Photon | 50 per term (no pagination in the API) | |
| Local DB | range pages of 1000 up to 2000 | configurable |
| UI page | all rows by default (50/100/200/500 per page optional), client-side | discovery-results.tsx |

## Completeness / confidence / ranking

Completeness (0–100): CNPJ 15, name 10, address 15, phone 15, email 10, website 15, social 10,
decision-maker 10 → 🟢 ≥75 · 🟡 ≥45 · 🔴 below. Confidence HIGH = ≥2 sources, a CNPJ or an official record;
LOW = single text-search match. Rank = completeness·0.6 + confidence·8 + min(4, sources)·4.
Discovery Quality Score = coverage·30% + avg completeness·35% + HIGH share·20% + healthy-source share·15%.

## Persistence

`discovery_searches` (log / full history / saved searches / cache; results are kept forever so any past
search can be reopened — `expires_at` only governs cache reuse), `source_request_logs` (every attempt, 30-day retention), `source_health` (breakers),
`geocode_cache` (30 days). Migration: `supabase/migrations/0011_discovery_engine.sql`.
Without it applied the search still works; history/cache/health just aren't saved.

## Live check

`DISCOVERY_LIVE=1 npx vitest run src/lib/discovery/live.test.ts` (hits the real OSM services; optional `DMODE=BROAD`).
