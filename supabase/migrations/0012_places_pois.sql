-- =============================================================================
-- 0012_places_pois.sql — open POI datasets as a Discovery source
--
-- * places_pois : business places imported offline from Overture Maps Places
--                 (CDLA-Permissive-2.0; aggregated from Meta, Microsoft,
--                 Foursquare, AllThePlaces) by tools/places-importer. Free,
--                 no API key. It is a prospecting BASE: rows are read by the
--                 Discovery source "places_overture" and only become
--                 companies when the user sends them to the pipeline.
-- * company_sources.source_type gains 'OVERTURE'.
-- =============================================================================

create table if not exists public.places_pois (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source text not null default 'overture',
  source_id text not null,
  release text,
  name text not null,
  category text,
  -- primary + alternate + taxonomy hierarchy + basic category, for niche matching
  categories text[] not null default '{}',
  confidence real,
  operating_status text,
  phones text[] not null default '{}',
  websites text[] not null default '{}',
  emails text[] not null default '{}',
  socials text[] not null default '{}',
  street text,
  postcode text,
  city text not null,
  state text not null,
  latitude double precision,
  longitude double precision,
  datasets text[] not null default '{}',
  imported_at timestamptz not null default now(),
  unique (workspace_id, source, source_id)
);

create index if not exists places_pois_city_idx on public.places_pois (workspace_id, state, city);
create index if not exists places_pois_categories_idx on public.places_pois using gin (categories);

alter table public.places_pois enable row level security;
create policy places_pois_member on public.places_pois
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

comment on table public.places_pois is 'Open POI data (Overture Maps Places, CDLA-Permissive-2.0) imported per city by tools/places-importer. Discovery source places_overture.';

alter table public.company_sources drop constraint if exists company_sources_source_type_check;
alter table public.company_sources add constraint company_sources_source_type_check
  check (source_type in ('CNPJ','OSM','WEBSITE','MANUAL','IMPORT_CSV','IMPORT_XLSX','MAPS_VALIDATION','OVERTURE','OTHER'));
