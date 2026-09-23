# Data Sources

Every source the product uses or is designed to use, and exactly how.

## Source matrix (Discovery Engine 2.0 — see DISCOVERY.md)

| Source | Status | Purpose | Limit | Data | Cost | Stores | Fallback role |
|---|---|---|---|---|---|---|---|
| Local DB (`local_db`) | working | companies already in the workspace, incl. the imported CNPJ base | none (range pages of 1000, cap 2000) | everything we hold | FREE | canonical | always queried first |
| Overture Maps (`places_overture`) | working | business places imported per city (`npm run places:sync`) — the free stand-in for a Google Maps listing | none at search time (reads `places_pois`); import downloads only the city's row groups | name, category, phones, websites, e-mails, socials, address, coords | FREE | yes (CDLA-Permissive-2.0) | primary; runs alongside the local DB |
| OSM Overpass (`osm_overpass`) | working, **unstable upstream** (504/429 seen) | tag/name search in the municipality boundary | public mirrors, per-IP quota; 1000 elements | name, category, address tags, phone, website, socials, coords | FREE | yes (ODbL) | primary geo source → falls back to Nominatim, Photon |
| OSM Nominatim (`osm_nominatim`) | working | geocoding + text POI search | ≤1 req/s; 40/page × 3 pages per term | name, address, extratags (phone/site), coords | FREE | yes (ODbL), geocodes cached 30d | fallback #1, geocoder #1 |
| OSM Photon (`osm_photon`) | working | text POI search, backup geocoder | fair use; 50 per term | name, address, coords | FREE | yes (ODbL) | fallback #2, geocoder #2 |
| CNPJ BrasilAPI (`cnpj_brasilapi`) | working | enrichment by CNPJ (no search by city) | no SLA; 3 req/s here | razão social, situação, CNAE, address, phone, email, QSA | FREE | yes (public registry) | enrichment only |
| Website (`website_discovery`) | working | homepage of the known official site | 1 page/company, 8s | phone, email, WhatsApp, socials | FREE | metadata only | enrichment only |
| Google Maps (`google_maps`) | working | open/validate links | no API calls | none | FREE | validation status + note only | never a data source |

## OpenStreetMap (implemented)

- **Services:** Overpass (3 mirrors), Nominatim, Photon — independent infrastructures, so one failing does not stop discovery. Details, root-cause analysis and limits in `OSM.md`.
- **Type:** Free, public, open-data (ODbL license)
- **What we fetch:** place name, category tags, coordinates, address tags, phone/website/social tags — for the tags/terms of the searched niche (`lib/discovery/industries.ts`)
- **Method:** `lib/discovery/http.ts` (timeout, retry, backoff, throttle, circuit breaker), descriptive `User-Agent`
- **Storage:** on import, normalized into `companies` + one `company_sources` row per OSM element (`source_record_id = node/<id>|way/<id>|relation/<id>`, linking back to openstreetmap.org), with field-level provenance in `companies.field_provenance`
- **Attribution:** the source URL is kept per-record; "© OpenStreetMap contributors" in the UI footer is a roadmap item

## Receita Federal — Dados Abertos CNPJ (implemented via local tool)

- **URL:** https://dadosabertos.rfb.gov.br/CNPJ/
- **Type:** Free, public, official government open data
- **What we fetch:** company registry fields (razão social, situação cadastral, CNAE, address, phone) — see `tools/cnpj-importer/cnpj_importer.py`
- **Method:** the app never scrapes the Receita Federal website. The user downloads the official bulk files and runs the local `tools/cnpj-importer` script, which filters by UF/CNAE and emits a small CSV. That CSV is uploaded through the normal **Imports** page.
- **Limits:** none beyond download bandwidth (files are large; the local tool is what makes this tractable — see `CNPJ_IMPORT.md`)
- **Storage:** filtered subset only, never the national dataset
- **Update cadence:** RFB republishes monthly; re-run the local tool and re-import for fresher data — `imports.dataset_version`/`source_date` track this per import batch

## Google Maps (implemented, validation-only — see MAPS.md)

- **Type:** Consultation/validation link only, generated from data we already hold
- **What we do NOT do:** scrape, store, cache, or replicate any Maps content (reviews, photos, place details)
- **Method:** `lib/domain/maps.ts` builds a `google.com/maps/search/?api=1&query=...` URL; opened in a new tab by the user, who then records `FOUND` / `NOT_FOUND` / `WRONG_RESULT` / `DUPLICATE` / `NEEDS_REVIEW` + a note on the company record

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
