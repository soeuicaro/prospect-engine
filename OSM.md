# OpenStreetMap integration

Three independent OSM services, each an adapter in `src/lib/discovery/sources/`:

| Service | Adapter | Use | Policy we follow |
|---|---|---|---|
| Overpass API | `overpass.ts` | tag/name search inside the municipality boundary, bbox or radius | 3 mirrors (overpass-api.de, maps.mail.ru, overpass.kumi.systems), ≤1 req/s per mirror, one query per search pass |
| Nominatim | `nominatim.ts` | city geocoding + text POI search in the city bbox | ≤1 req/s (hard-clamped), identifying User-Agent, results cached, ≤3 pages per term |
| Photon (komoot) | `photon.ts` | text POI search + backup geocoder | fair use, ≤50 per term |

Test page: `/admin/integrations/osm` (TEST CONNECTION with city / lat / lon / query).

## Root cause of "Erro ao consultar o OpenStreetMap" and of very few results

Reproduced on 2026-09-22 against the real services, Sobral/CE:

1. **Single endpoint, no timeout, no retry.** `overpass-api.de` answered **HTTP 504 after ~40s**; the
   old code called only that host and turned any non-2xx into the generic error.
2. **HTTP 200 with a `remark` was treated as a full answer.** Overloaded Overpass servers return 200 +
   `"remark": "runtime error: Query timed out…"` and a partial (often near-empty) `elements` array.
   The old code never looked at `remark`, so a timed-out query showed up as "2 results".
3. **One tag per search.** "Restaurantes" searched only `amenity=restaurant`: 32 elements in the
   municipality vs 87 for the food-related tags (restaurant 32, fast_food 28, pub 13, bar 7, …).
4. **Relations dropped, ids colliding.** Only `node`/`way` were queried and the record id was the bare
   number (`node/123` and `way/123` collided), with the URL always `/node/`.
5. **Geocoding failures looked like "city not found".** Nominatim 429/timeouts returned `null`.
6. The bbox of the municipality includes neighbouring towns (Meruoca, Forquilha); nothing filtered them.

## What changed

- `osm-query-builder.ts`: the only place QL is assembled. Values validated (`^[a-z0-9_:;.-]+$`),
  strings escaped, city matched accent/case-insensitively, tags grouped per key (one request),
  `nwr` (nodes, ways and relations).
- Strategy order: **municipality area** (`area["ISO3166-2"="BR-CE"]` → `admin_level=8` by name; no
  geocoder needed) → **geocoder bbox** if the boundary isn't found → **radius** (`around:`) when asked.
- Tag query and name-keyword query run as **separate requests** (the combined BROAD query timed out on
  every mirror in testing; tags alone answered in ~11s).
- `requestWithPolicy` (`http.ts`): per-attempt timeout (starts after throttle wait), bounded retries,
  exponential backoff with jitter, Retry-After, error normalization, a log row per attempt.
- Mirrors: on 429/5xx/timeout/parse error/partial remark → next mirror; `retryCount` extra rounds.
  HTTP 400 (bad query) stops immediately. Largest partial answer is kept → `SOURCE_PARTIAL_RESULTS`.
- Circuit breaker per mirror (`osm_overpass@host`) and per source: 3 consecutive failures → OPEN for
  2 min → HALF_OPEN trial → CLOSED on success. State persisted in `source_health`. Reset in the UI.
- Defaults (editable in `/settings/sources`): timeout 25s per mirror attempt (QL `[timeout:20]`),
  1 retry round, 1 req/s, cache 24h, max 1000.

Rate limiting caveat: throttles are per server process. Serverless instances don't share memory; volume
stays low because searches are human-triggered, cached and bounded.

## Data & attribution

OSM data is ODbL: storing it is allowed with attribution ("© OpenStreetMap contributors"). Every record
keeps its `openstreetmap.org/<type>/<id>` link in `company_sources`.

## Observed limits (not bugs)

OSM coverage of small Brazilian cities is thin: Sobral had ~30 named restaurants/fast-food places inside
the municipality, few with phone/website. OSM is a geographic source; cadastral volume comes from the
CNPJ base (see CNPJ_IMPORT.md) through the local DB source.
