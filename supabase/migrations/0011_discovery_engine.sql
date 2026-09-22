-- =============================================================================
-- 0011_discovery_engine.sql — Multi-source Discovery Engine (see DISCOVERY.md)
--
-- * discovery_searches   : search log / history / saved searches / result cache
-- * source_health        : circuit breaker + health per source (and per
--                          Overpass mirror). Serverless instances share no
--                          memory, so breaker state lives here.
-- * source_request_logs  : one row per external request attempt (endpoint,
--                          query, HTTP status, latency, attempt n/N, error
--                          kind, fallback flag) — internal diagnostics only.
-- * geocode_cache        : Nominatim/Photon city geocodes (caching is
--                          explicitly allowed by Nominatim's usage policy).
-- * companies            : Maps validation statuses FOUND / NOT_FOUND /
--                          WRONG_RESULT / DUPLICATE / NEEDS_REVIEW + note,
--                          field-level provenance and data conflicts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- discovery_searches
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  cache_key text not null,
  name text,
  saved boolean not null default false,
  query_text text,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check (status in (
    'QUEUED','SEARCHING','MERGING','ENRICHING','SCORING','COMPLETED','PARTIAL','FAILED','CANCELLED'
  )),
  outcome text check (outcome in ('SUCCESS','SUCCESS_WITH_WARNINGS','PARTIAL','NO_RESULTS','FAILED')),
  sources_used text[] not null default '{}',
  sources_failed text[] not null default '{}',
  counts jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  funnel jsonb not null default '[]'::jsonb,
  source_runs jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  -- Unified result snapshot, for cache / re-open / export. Only OSM (ODbL)
  -- and our own data — never Google Maps content. Cleared when the entry
  -- expires unless the search is saved (see lib/discovery/store.ts).
  results jsonb not null default '[]'::jsonb,
  final_count int not null default 0,
  quality_score int,
  duration_ms int,
  error text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);

create index if not exists discovery_searches_workspace_idx on public.discovery_searches (workspace_id, created_at desc);
create index if not exists discovery_searches_cache_idx on public.discovery_searches (workspace_id, cache_key, created_at desc);

-- ---------------------------------------------------------------------------
-- source_health
-- ---------------------------------------------------------------------------
create table if not exists public.source_health (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_key text not null,
  breaker_state text not null default 'CLOSED' check (breaker_state in ('CLOSED','OPEN','HALF_OPEN')),
  consecutive_failures int not null default 0,
  opened_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_error_kind text,
  last_status text,
  last_latency_ms int,
  avg_latency_ms int,
  success_count int not null default 0,
  failure_count int not null default 0,
  recent_outcomes jsonb not null default '[]'::jsonb,
  total_results bigint not null default 0,
  runs int not null default 0,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, source_key)
);

-- ---------------------------------------------------------------------------
-- source_request_logs (retention: 30 days, pruned by the app)
-- ---------------------------------------------------------------------------
create table if not exists public.source_request_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  search_id uuid references public.discovery_searches (id) on delete cascade,
  source_key text not null,
  endpoint text,
  query text,
  http_status int,
  latency_ms int,
  attempt int,
  max_attempts int,
  error_kind text,
  error_message text,
  results_count int,
  fallback_activated boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists source_request_logs_workspace_idx on public.source_request_logs (workspace_id, created_at desc);
create index if not exists source_request_logs_search_idx on public.source_request_logs (search_id);
create index if not exists source_request_logs_source_idx on public.source_request_logs (workspace_id, source_key, created_at desc);

-- ---------------------------------------------------------------------------
-- geocode_cache (global: a city's coordinates are not tenant data)
-- ---------------------------------------------------------------------------
create table if not exists public.geocode_cache (
  cache_key text primary key,
  result jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- companies: Maps validation v2, provenance, conflicts
-- ---------------------------------------------------------------------------
alter table public.companies drop constraint if exists companies_maps_validation_status_check;

update public.companies set maps_validation_status = 'FOUND' where maps_validation_status = 'VALIDATED_BY_USER';
update public.companies set maps_validation_status = 'WRONG_RESULT' where maps_validation_status = 'DISCREPANCY_FOUND';

alter table public.companies
  add constraint companies_maps_validation_status_check
  check (maps_validation_status in ('NOT_VALIDATED','FOUND','NOT_FOUND','WRONG_RESULT','DUPLICATE','NEEDS_REVIEW'));

alter table public.companies add column if not exists maps_validation_note text;
-- { field: { value, source, confidence, collected_at, verified_at } }
alter table public.companies add column if not exists field_provenance jsonb not null default '{}'::jsonb;
-- [ { field, chosen: {...}, alternatives: [{...}] } ]
alter table public.companies add column if not exists data_conflicts jsonb not null default '[]'::jsonb;

create index if not exists company_sources_record_idx on public.company_sources (workspace_id, source_type, source_record_id);

-- ---------------------------------------------------------------------------
-- RLS (service-role bypasses it today — see 0009 — kept consistent with 0007)
-- ---------------------------------------------------------------------------
alter table public.discovery_searches enable row level security;
alter table public.source_health enable row level security;
alter table public.source_request_logs enable row level security;
alter table public.geocode_cache enable row level security;

create policy discovery_searches_member on public.discovery_searches
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy source_health_member on public.source_health
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy source_request_logs_member on public.source_request_logs
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy geocode_cache_read on public.geocode_cache
  for select using (auth.role() = 'authenticated');

comment on table public.discovery_searches is 'Discovery search log/history/cache. results holds only OSM (ODbL) + own data, never Google Maps content.';
comment on table public.source_health is 'Circuit breaker + health per discovery/enrichment source and per Overpass mirror.';
comment on column public.companies.maps_validation_status is 'User-recorded Maps check. No Maps content is stored.';
