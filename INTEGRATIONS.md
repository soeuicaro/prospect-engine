# Integrations

Every external call goes through `requestWithPolicy` (`src/lib/discovery/http.ts`): timeout, bounded
retry with exponential backoff + jitter, Retry-After, error normalization, per-host throttle, one log row
per attempt (`source_request_logs`). No other `fetch()` to third parties in discovery code (the Website
Analyzer keeps its own robots.txt-aware fetch, wrapped with a timeout + throttle).

## Adapter contracts (`src/lib/discovery/sources/base.ts`)

- `DiscoverySource.search(input, env) → SourceRunResult` — `{ status, results, metadata{requested,
  returned, pages, hasMore, durationMs, attempts, sourceLimit, strategy, queries, endpointsTried,
  invalid}, warnings, errors, logs, coverage, isFallback, userMessage }`
- `EnrichmentSource.enrich(company, env) → EnrichmentPatch`
- `GeoSource.geocodeCity(city, uf, env) → { location, logs, error }`

Each source declares `cost` (FREE/PAID — `FREE_ONLY` workspaces never run PAID sources) and
capabilities (`canSearch`, `canEnrich`, `canGeocode`, `canReturnPhone`, …). Metadata and defaults live in
`src/lib/discovery/registry.ts`.

## Errors

| Kind | From | Retried |
|---|---|---|
| RATE_LIMITED | 429 | yes (Retry-After honoured) |
| HTTP_5XX | 500/502/503/504 | yes |
| TIMEOUT / NETWORK | abort by timer / fetch failure | yes |
| PARTIAL_RESPONSE | e.g. Overpass 200 + runtime-error remark | yes (next mirror) |
| HTTP_4XX | 400 malformed query, 404 | no |
| BLOCKED | 401/403/451 | no |
| PARSE | invalid body on 2xx | no (Overpass: next mirror) |
| ABORTED | user cancel / search deadline | no |
| CIRCUIT_OPEN | breaker open | not called |

Users only see safe messages ("OpenStreetMap apresentou instabilidade. Os resultados das outras fontes
foram mantidos."); technical detail is in `/settings/sources`, `/admin/discovery/searches/<id>` and the DB logs.

## Health

`HEALTHY / DEGRADED / DOWN / DISABLED / NOT_CONFIGURED`, derived from the breaker state and the last 20
outcomes. `/settings/sources` shows status, breaker, last success/error, latency (last/avg), success rate,
last check, per-mirror/geocoder components, a degradation banner, **TEST ALL SOURCES**, per-source
config (enabled, priority, timeout, retries, rate limit, cache TTL, max results, fallback) and the
field-priority editor used by the merge.

## Configuration storage

`settings` rows `discovery.sources` and `discovery.field_priority`. The legacy feature flags still
apply: `OSM_DISCOVERY=false` disables all OSM sources, `WEB_ANALYSIS=false` disables website enrichment.
