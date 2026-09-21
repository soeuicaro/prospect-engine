# Google Maps Usage

## What the system does

One button, two places:

- **"Abrir no Google Maps"** on a company's detail page — opens `https://www.google.com/maps/search/?api=1&query=<name, address, city, state>` in a new tab, built from data already in our own database (`lib/domain/maps.ts`).
- **"Validar no Maps"** — after the user visually checks the place on Maps themselves, they click this to record `maps_validation_status = VALIDATED_BY_USER` and `maps_last_validated_at = now()` on the company. A separate "Reportar discrepância" button records `DISCREPANCY_FOUND` instead.

That's the entire integration.

## What the system does NOT do

- Does not scrape Google Maps results, reviews, photos, or place details
- Does not store any content fetched from Google Maps
- Does not use any unofficial/reverse-engineered Maps API
- Does not automate clicking through or navigating Maps programmatically
- Does not treat Google Maps as a canonical data source — Maps is validation/reference only

## Why

Google's Terms of Service restrict scraping and bulk storage of Maps content. The product's canonical data comes from sources we can legitimately store in full: OpenStreetMap (ODbL open data), the official Receita Federal CNPJ dataset, user-provided CSV imports, and manual entry — see `DATA_SOURCES.md`.

## How to validate a prospect

1. Open the company's detail page.
2. Click "Abrir no Google Maps."
3. Compare what you see (name, address, hours, photos) against the record in the app.
4. Come back and click "Validar no Maps" if it matches, or "Reportar discrepância" if something's off — this updates `maps_validation_status` so the team knows the record's freshness at a glance.

## If a future Maps API integration is ever added

Before adding one: re-check Google's current Maps Platform Terms of Service and Places API terms for what content classes may be cached/stored and for how long. Only implement methods explicitly compatible with those terms. Do not build around rate limits or restrictions.
