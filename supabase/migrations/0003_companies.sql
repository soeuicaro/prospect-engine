-- =============================================================================
-- 0003_companies.sql — companies + enrichment (sources, contacts, social,
-- analysis, scores). This is the canonical commercial entity of the product.
-- =============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- Identity
  legal_name text,
  trade_name text,
  cnpj text,
  cnpj_status text check (cnpj_status in ('ATIVA','SUSPENSA','INAPTA','BAIXADA','NULA','UNKNOWN')),
  cnpj_status_date date,
  opened_at date,
  legal_nature text,
  cnae_primary text references public.cnaes (code),
  cnae_secondary text[] not null default '{}',
  industry_id uuid references public.industries (id) on delete set null,

  -- Porte oficial: {value, source, source_date, confidence}
  official_size jsonb not null default '{}'::jsonb,

  -- Tamanho operacional estimado
  estimated_size text check (estimated_size in ('MICRO_LOCAL','PEQUENA','MEDIA','GRANDE_REGIONAL')),
  estimated_size_confidence text check (estimated_size_confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')) default 'UNKNOWN',
  estimated_size_signals jsonb not null default '[]'::jsonb,

  -- Address / geo
  street text,
  street_number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  postal_code text,
  country text not null default 'BR',
  latitude numeric(10,7),
  longitude numeric(10,7),
  geo_source text,

  -- Contact (company-level, business channels only)
  phone text,
  phone_normalized text,
  email text,
  website text,
  website_domain text,
  whatsapp text,

  -- Google Maps: validation/reference only, never canonical
  maps_validation_status text not null default 'NOT_VALIDATED'
    check (maps_validation_status in ('NOT_VALIDATED','VALIDATED_BY_USER','DISCREPANCY_FOUND')),
  maps_last_validated_at timestamptz,

  -- Data quality / freshness
  data_quality_score int not null default 0 check (data_quality_score between 0 and 100),
  last_verified_at timestamptz,

  -- CRM
  pipeline_stage_id uuid references public.pipeline_stages (id) on delete set null,
  lead_temperature text default 'COLD' check (lead_temperature in ('HOT','WARM','COLD')),
  next_best_action text,
  sales_readiness text default 'UNKNOWN' check (sales_readiness in ('READY','POTENTIAL','LOW','UNKNOWN')),

  -- Won data
  client_since date,
  won_offer_id uuid references public.offers (id) on delete set null,
  won_value numeric,
  won_recurring_value numeric,
  lost_reason text,

  tags text[] not null default '{}',

  -- soft delete / archive
  archived_at timestamptz,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_workspace_idx on public.companies (workspace_id) where deleted_at is null;
create index companies_city_state_idx on public.companies (workspace_id, state, city);
create index companies_cnpj_idx on public.companies (workspace_id, cnpj);
create index companies_trade_name_trgm_idx on public.companies using gin (trade_name gin_trgm_ops);
create index companies_legal_name_trgm_idx on public.companies using gin (legal_name gin_trgm_ops);
create index companies_stage_idx on public.companies (workspace_id, pipeline_stage_id);
create index companies_industry_idx on public.companies (workspace_id, industry_id);
create index companies_tags_idx on public.companies using gin (tags);

-- ---------------------------------------------------------------------------
-- company_sources: full source traceability for every record we hold
-- ---------------------------------------------------------------------------
create table public.company_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  source_type text not null check (source_type in ('CNPJ','OSM','WEBSITE','MANUAL','IMPORT_CSV','IMPORT_XLSX','MAPS_VALIDATION','OTHER')),
  source_name text not null,
  source_url text,
  source_record_id text,
  collected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  confidence text not null default 'MEDIUM' check (confidence in ('HIGH','MEDIUM','LOW')),
  raw_ref jsonb not null default '{}'::jsonb
);

create index company_sources_company_idx on public.company_sources (company_id);

-- ---------------------------------------------------------------------------
-- company_contacts: decision-maker intelligence, never fabricated
-- ---------------------------------------------------------------------------
create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  name text,
  role text,
  contact_type text not null default 'CONTATO_COMERCIAL'
    check (contact_type in ('RESPONSAVEL_CADASTRAL','SOCIO','DECISOR_ESTIMADO','CONTATO_COMERCIAL')),
  phone text,
  phone_normalized text,
  email text,
  channel_priority int not null default 5,
  evidence_source text,
  confidence text not null default 'MEDIUM' check (confidence in ('HIGH','MEDIUM','LOW')),
  notes text,
  created_at timestamptz not null default now()
);

create index company_contacts_company_idx on public.company_contacts (company_id);

-- ---------------------------------------------------------------------------
-- company_social_profiles
-- ---------------------------------------------------------------------------
create table public.company_social_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  channel text not null check (channel in ('instagram','facebook','tiktok','youtube','linkedin','whatsapp','other')),
  handle_or_url text,
  status text not null default 'NOT_CHECKED' check (status in ('FOUND','NOT_FOUND','UNKNOWN','NOT_CHECKED')),
  source text,
  confidence text not null default 'MEDIUM' check (confidence in ('HIGH','MEDIUM','LOW')),
  checked_at timestamptz,
  unique (company_id, channel)
);

-- ---------------------------------------------------------------------------
-- company_analysis: website/digital-presence analyzer output (metadata only,
-- never raw HTML dumps — see DATABASE.md storage economy policy)
-- ---------------------------------------------------------------------------
create table public.company_analysis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade unique,
  website_status text default 'UNKNOWN' check (website_status in ('ACTIVE','INACTIVE','TIMEOUT','DNS_ERROR','HTTPS_ERROR','UNKNOWN')),
  website_flags text[] not null default '{}',
  -- e.g. NO_WEBSITE, NO_CONTACT_PAGE, NO_WHATSAPP, NO_SOCIAL_LINKS,
  -- WEBSITE_OUTDATED, LOW_CONTENT_SIGNAL, MISSING_CTA, MISSING_SOCIAL,
  -- BROKEN_LINK, SLOW_RESPONSE
  has_blog boolean,
  has_https boolean,
  has_sitemap boolean,
  content_presence text default 'NOT_VERIFIED' check (content_presence in ('PRESENT','WEAK','ABSENT','NOT_VERIFIED')),
  summary jsonb not null default '{}'::jsonb,
  last_analyzed_at timestamptz,
  content_hash text,
  created_at timestamptz not null default now()
);

create index company_analysis_company_idx on public.company_analysis (company_id);

-- ---------------------------------------------------------------------------
-- company_scores: latest computed score snapshot (history in score_factors)
-- ---------------------------------------------------------------------------
create table public.company_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade unique,
  digital_presence_score int not null default 0,
  content_need_score int not null default 0,
  purchase_capacity_score int not null default 0,
  marketing_opportunity_score int not null default 0,
  fit_score int not null default 0,
  size_score int not null default 0,
  local_proximity_score int not null default 0,
  prospect_score int not null default 0,
  contactability_score int not null default 0,
  opportunity_level text default 'BAIXO' check (opportunity_level in ('MUITO_ALTO','ALTO','MEDIO','BAIXO')),
  rule_version text,
  computed_at timestamptz not null default now()
);

create index company_scores_prospect_idx on public.company_scores (workspace_id, prospect_score desc);

-- ---------------------------------------------------------------------------
-- company_score_factors: evidence trail behind "Why this lead?"
-- ---------------------------------------------------------------------------
create table public.company_score_factors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  factor_key text not null,
  factor_label text not null,
  category text not null,
  points numeric not null default 0,
  evidence text,
  confidence text default 'MEDIUM' check (confidence in ('HIGH','MEDIUM','LOW')),
  computed_at timestamptz not null default now()
);

create index company_score_factors_company_idx on public.company_score_factors (company_id);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();
