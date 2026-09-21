-- =============================================================================
-- 0004_campaigns_crm.sql — campaigns, outreach, tasks, notes, followups,
-- pipeline history
-- =============================================================================

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  cities text[] not null default '{}',
  state text,
  niches uuid[] not null default '{}', -- industry ids
  radius_km numeric,
  min_score int default 0,
  target_count int,
  size_filter text[] not null default '{}', -- estimated_size values
  offer_id uuid references public.offers (id) on delete set null,
  template_id uuid references public.message_templates (id) on delete set null,
  sequence_id uuid references public.outreach_sequences (id) on delete set null,
  status text not null default 'DRAFT' check (status in ('DRAFT','READY','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  channel_send_mode text not null default 'ASSISTED' check (channel_send_mode in ('MANUAL','ASSISTED','AUTOMATED_IF_SUPPORTED')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_workspace_idx on public.campaigns (workspace_id);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status text not null default 'QUEUED' check (status in ('QUEUED','SKIPPED_SUPPRESSED','SKIPPED_DUPLICATE','SKIPPED_NO_CONTACT','SKIPPED_INSUFFICIENT_DATA','SENT','DONE')),
  added_at timestamptz not null default now(),
  unique (campaign_id, company_id)
);

create index campaign_leads_campaign_idx on public.campaign_leads (campaign_id);
create index campaign_leads_company_idx on public.campaign_leads (company_id);

-- ---------------------------------------------------------------------------
-- lead_outreach: every assisted/manual/automated send attempt
-- ---------------------------------------------------------------------------
create table public.lead_outreach (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  sequence_step_id uuid references public.sequence_steps (id) on delete set null,
  channel text not null check (channel in ('whatsapp','email','phone','instagram','linkedin','manual')),
  template_id uuid references public.message_templates (id) on delete set null,
  message_preview text,
  send_mode text not null default 'ASSISTED' check (send_mode in ('MANUAL','ASSISTED','AUTOMATED_IF_SUPPORTED')),
  status text not null default 'PENDING' check (status in ('PENDING','MARKED_SENT','DELIVERED_UNKNOWN','FAILED')),
  response_type text check (response_type in (
    'INTERESTED','NOT_NOW','NO_INTEREST','ASKED_PRICE','ASKED_DETAILS',
    'MEETING_REQUESTED','WRONG_CONTACT','OPT_OUT','UNKNOWN'
  )),
  sent_at timestamptz,
  responded_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index lead_outreach_company_idx on public.lead_outreach (company_id, created_at desc);
create index lead_outreach_campaign_idx on public.lead_outreach (campaign_id);

-- ---------------------------------------------------------------------------
-- followups
-- ---------------------------------------------------------------------------
create table public.followups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  lead_outreach_id uuid references public.lead_outreach (id) on delete set null,
  follow_up_at timestamptz not null,
  follow_up_type text default 'manual' check (follow_up_type in ('manual','assisted','automatic')),
  status text not null default 'PENDING' check (status in ('PENDING','DONE','RESCHEDULED','CANCELLED','NO_RESPONSE','INTERESTED','OPT_OUT')),
  note text,
  assigned_to uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index followups_workspace_due_idx on public.followups (workspace_id, follow_up_at) where status = 'PENDING';
create index followups_company_idx on public.followups (company_id);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  status text not null default 'OPEN' check (status in ('OPEN','DONE','CANCELLED')),
  assigned_to uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index tasks_workspace_due_idx on public.tasks (workspace_id, due_at) where status = 'OPEN';
create index tasks_company_idx on public.tasks (company_id);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id uuid references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index notes_company_idx on public.notes (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- lead_stage_history: every pipeline move, for the lead activity timeline
-- ---------------------------------------------------------------------------
create table public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages (id),
  to_stage_id uuid references public.pipeline_stages (id),
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  note text
);

create index lead_stage_history_company_idx on public.lead_stage_history (company_id, changed_at desc);
