-- =============================================================================
-- 0005_compliance_ops.sql — suppression, consent, data verification, imports,
-- automation jobs, settings, exports, source runs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- suppression_list: hard "do not contact" gate — checked before any campaign
-- adds a lead, enforced by application code AND documented here for audit.
-- ---------------------------------------------------------------------------
create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  contact_id uuid references public.company_contacts (id) on delete cascade,
  channel text check (channel in ('whatsapp','email','phone','instagram','linkedin','all')),
  value text,
  reason text not null check (reason in (
    'opt_out','nao_quer_contato','numero_invalido','email_invalido',
    'reclamacao','bloqueado','duplicado','juridico','manual'
  )),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index suppression_company_idx on public.suppression_list (company_id);
create index suppression_workspace_idx on public.suppression_list (workspace_id);

-- ---------------------------------------------------------------------------
-- consents / LGPD awareness
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  contact_id uuid references public.company_contacts (id) on delete cascade,
  purpose text not null default 'prospeccao_b2b',
  data_category text,
  lawful_basis_note text,
  granted boolean,
  source text,
  recorded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- data_verification: VERIFIED / INVALID / UNKNOWN — never fabricated
-- ---------------------------------------------------------------------------
create table public.data_verification (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null check (entity_type in ('company','contact')),
  entity_id uuid not null,
  field text not null check (field in ('website','email','phone','whatsapp')),
  status text not null default 'UNKNOWN' check (status in ('VERIFIED','INVALID','UNKNOWN')),
  detail text,
  checked_at timestamptz not null default now(),
  checked_by uuid references public.profiles (id)
);

create index data_verification_entity_idx on public.data_verification (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- imports: CSV/XLSX/CNPJ dataset import jobs (idempotent, resumable)
-- ---------------------------------------------------------------------------
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  file_name text not null,
  source_type text not null check (source_type in ('CSV','XLSX','CNPJ_DATASET','OSM')),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','SUCCESS','FAILED','CANCELLED')),
  column_mapping jsonb not null default '{}'::jsonb,
  dataset_version text,
  source_date date,
  total_rows int not null default 0,
  processed_rows int not null default 0,
  created_count int not null default 0,
  updated_count int not null default 0,
  duplicate_count int not null default 0,
  error_count int not null default 0,
  checkpoint jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_by uuid references public.profiles (id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index imports_workspace_idx on public.imports (workspace_id, created_at desc);

create table public.import_errors (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports (id) on delete cascade,
  row_number int,
  error_message text not null,
  raw_row jsonb,
  created_at timestamptz not null default now()
);

create index import_errors_import_idx on public.import_errors (import_id);

-- ---------------------------------------------------------------------------
-- automation_jobs / automation_logs: generic background job queue.
-- Serverless-safe: jobs must be resumable via `checkpoint`, never assume
-- unlimited execution time (see ARCHITECTURE.md — serverless constraints).
-- ---------------------------------------------------------------------------
create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null check (type in (
    'DATA_IMPORT','DATA_ENRICHMENT','WEBSITE_ANALYSIS','SCORE_CALCULATION',
    'FOLLOWUP_REMINDER','DAILY_DIGEST','LEAD_REFRESH','DEDUPLICATION'
  )),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','SUCCESS','FAILED','CANCELLED')),
  priority int not null default 5,
  payload jsonb not null default '{}'::jsonb,
  checkpoint jsonb not null default '{}'::jsonb,
  attempts int not null default 0,
  max_attempts int not null default 3,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index automation_jobs_workspace_status_idx on public.automation_jobs (workspace_id, status, priority);

create table public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.automation_jobs (id) on delete cascade,
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  message text not null,
  created_at timestamptz not null default now()
);

create index automation_logs_job_idx on public.automation_logs (job_id);

-- ---------------------------------------------------------------------------
-- source_runs: discovery/enrichment provider run tracking (OSM, website, etc)
-- ---------------------------------------------------------------------------
create table public.source_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_type text not null check (source_type in ('OSM','WEBSITE_ANALYZER','CNPJ_IMPORT','MAPS_LINK')),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','SUCCESS','FAILED')),
  params jsonb not null default '{}'::jsonb,
  results_count int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- settings: generic per-workspace key/value config (Scoring Rules UI writes
-- here too for things that don't warrant their own table)
-- ---------------------------------------------------------------------------
create table public.settings (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

-- ---------------------------------------------------------------------------
-- exports: audit trail of what was exported, by whom, with which filters
-- ---------------------------------------------------------------------------
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  export_type text not null check (export_type in ('CSV','XLSX','JSON','WORKSPACE_BACKUP')),
  filters jsonb not null default '{}'::jsonb,
  row_count int,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
