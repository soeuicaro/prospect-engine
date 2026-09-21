# Data Sources

Every source the product uses or is designed to use, and exactly how.

## OpenStreetMap (implemented)

- **URL:** https://www.openstreetmap.org, data via Nominatim (geocoding) + Overpass API
- **Type:** Free, public, open-data (ODbL license)
- **What we fetch:** place name, category tag, coordinates, address tags, phone/website tags — only for categories the user explicitly searches (`lib/providers/osm.ts`, `OSM_CATEGORIES`)
- **Method:** `fetch()` with a descriptive `User-Agent` header, per Nominatim's usage policy
- **Limits:** Nominatim policy caps at ~1 req/sec; each discovery search is a single human-triggered request (no batch crawling), see `ARCHITECTURE.md` for the honest caveat about serverless rate-limiting
- **Storage:** normalized into `companies` + a `company_sources` row (`source_type: 'OSM'`, linking back to `openstreetmap.org/node/<id>`) — never re-scraped/re-stored in bulk
- **Attribution:** the source URL is kept per-record; a visible "data © OpenStreetMap contributors" credit in the UI footer is a roadmap item

## Receita Federal — Dados Abertos CNPJ (implemented via local tool)

- **URL:** https://dadosabertos.rfb.gov.br/CNPJ/
- **Type:** Free, public, official government open data
- **What we fetch:** company registry fields (razão social, situação cadastral, CNAE, address, phone) — see `tools/cnpj-importer/cnpj_importer.py`
- **Method:** the app never scrapes the Receita Federal website. The user downloads the official bulk files and runs the local `tools/cnpj-importer` script, which filters by UF/CNAE and emits a small CSV. That CSV is uploaded through the normal **Imports** page.
- **Limits:** none beyond download bandwidth (files are large; the local tool is what makes this tractable — see `CNPJ_IMPORT.md`)
- **Storage:** filtered subset only, never the national dataset
- **Update cadence:** RFB republishes monthly; re-run the local tool and re-import for fresher data — `imports.dataset_version`/`source_date` track this per import batch

## Google Maps (implemented, validation-only — see MAPS_USAGE.md)

- **Type:** Consultation/validation link only, generated from data we already hold
- **What we do NOT do:** scrape, store, cache, or replicate any Maps content (reviews, photos, place details)
- **Method:** `lib/domain/maps.ts` builds a `google.com/maps/search/?api=1&query=...` URL; opened in a new tab by the user, who then manually marks `VALIDATED_BY_USER` / `DISCREPANCY_FOUND` on the company record

## User-provided data (implemented)

- **CSV import** (`lib/actions/imports.ts`) and **manual entry** (`lib/actions/companies.ts`) — the user is the source; recorded as `source_type: 'MANUAL'` or `'IMPORT_CSV'` with `confidence: 'HIGH'`/`'MEDIUM'` respectively

## Company websites — Website Analyzer (implemented)

- **What we fetch:** exactly one page (the homepage) per analysis run, triggered manually by the user ("Analisar site" on the lead detail page)
- **What we extract:** title, meta description, presence of a contact page/CTA/blog link, phone/email/WhatsApp patterns found in the markup, social profile links, HTTPS, `sitemap.xml` presence — never the full HTML (only a truncated content hash is kept)
- **Method:** `lib/providers/website-analyzer.ts` — checks `robots.txt` first (`lib/providers/robots.ts`, fails open if unreachable, respects a blanket or path-specific `Disallow`), sends a descriptive `User-Agent`, 8s timeout, `GET` only, no authentication, no protection bypass
- **Storage:** flags/metadata into `company_analysis`; extracted contact/social info only fills fields that are currently empty on the company record — never overwrites existing data
- **Limits:** single-page, user-triggered (no site-wide crawling in V1)

## Not implemented (see ARCHITECTURE.md Roadmap)

- **Paid lead/enrichment APIs** (Apollo, Hunter, SerpAPI, Bright Data, etc.): deliberately never integrated — see `FREE_PLAN.md` Zero-Cost Guard.
