# places-importer

Imports the business places of a city from **Overture Maps Places** into `places_pois`, where the
Discovery source **Overture Maps** (`places_overture`) finds them.

Overture Places is open data (CDLA-Permissive-2.0: store and use commercially, keep attribution)
aggregated from Meta (Facebook business pages), Microsoft, Foursquare and AllThePlaces. Per place:
name, category, phones, websites, e-mails, social profiles (mostly Facebook), address and coordinates —
the closest free equivalent of a Google Maps listing. No API key, no account, no billing, no scraping.

Measured, Sobral/CE (release 2026-08-19.0): 4,821 places inside the municipal boundary, 3,817 with
phone, 1,785 with website, 1,714 with e-mail, 4,724 with a social profile — in ~20 s.

## Run

```bash
pip install duckdb        # once (free, local)
npm run places:sync -- --uf CE --municipio Sobral
npm run places:sync -- --uf CE --municipio Sobral --municipio Forquilha
npm run places:sync -- --uf CE --municipio Sobral --dry-run --output sobral.csv
```

- Reads GeoParquet straight from the public S3 bucket (`overturemaps-us-west-2`) with DuckDB; only the
  row groups overlapping the city are downloaded.
- The municipality polygon comes from Nominatim (1 request per city); places outside it are dropped.
- Places flagged closed are skipped (`--include-closed` keeps them).
- Idempotent: upsert on the Overture id. Overture publishes a release roughly monthly — re-run to refresh.
- Writes with the service role from `.env.local` (same as `cnpj_sync.py`). Needs migration `0012_places_pois.sql`.

## What it does NOT give

No CNPJ, no owner/partners, no ratings/reviews/opening hours. Owners come from the CNPJ base
(`npm run cnpj:sync -- ... --socios`); Discovery merges both by phone/name/location.
