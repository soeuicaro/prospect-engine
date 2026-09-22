# Google Maps

Google Maps is part of the workflow as **navigation and manual validation** — never as a scraped or
stored data source (Google's terms restrict scraping and bulk storage of Maps content).

## What the system does

- **Abrir no Google Maps** — everywhere a company appears: companies table, pipeline cards, company
  detail header, discovery results, admin test page. Built by `buildGoogleMapsLinks()` (`src/lib/domain/maps.ts`)
  using the official Maps URLs format `https://www.google.com/maps/search/?api=1&query=…` — no API key,
  works even when we have no official Maps URL for the business.
  - name + address → `Nome, Rua X 123, Bairro, Cidade - UF`
  - name only → `Nome, Cidade - UF`
  - no name, coordinates → `lat,lon`
- **Ver coordenadas** — a second link pinning our stored coordinates (from OSM), when available.
- **Validar no Google Maps** (company page) — the user opens Maps, checks, and records one of
  `FOUND`, `NOT_FOUND`, `WRONG_RESULT`, `DUPLICATE`, `NEEDS_REVIEW` (or clears it), plus an optional note.
  Stored: `maps_validation_status`, `maps_last_validated_at` (the "validated at"), `maps_validation_note`.
  Migration 0011 maps the old `VALIDATED_BY_USER` → `FOUND` and `DISCREPANCY_FOUND` → `WRONG_RESULT`.

## Contact action bar

`src/components/shared/contact-actions.tsx` — only renders buttons backed by valid data:
Maps · Coordenadas · Website (new tab) · WhatsApp (explicit WhatsApp number, or a BR **mobile** phone;
opens the chat, never sends) · Ligar (`tel:` on touch devices, copy to clipboard on desktop) ·
E-mail (`mailto:`) · Instagram · Facebook · TikTok · LinkedIn · YouTube.

## What the system does NOT do

No Maps/Places API calls, no scraping, no storing reviews/photos/place details, no automated navigation.

Test page: `/admin/integrations/maps` (generated URL, encoded query, strategy, open behaviour).
If a Places API integration is ever added, re-check the current Maps Platform terms first.
