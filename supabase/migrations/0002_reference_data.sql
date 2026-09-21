-- =============================================================================
-- 0002_reference_data.sql — industries, CNAEs, pipeline stages, scoring rules,
-- offers, playbooks, content ideas, message templates, outreach sequences
-- =============================================================================

-- ---------------------------------------------------------------------------
-- CNAEs (Brazilian economic activity codes) — global reference table
-- ---------------------------------------------------------------------------
create table public.cnaes (
  code text primary key,
  description text not null
);

-- ---------------------------------------------------------------------------
-- industries: user-configurable niches (NOT hardcoded in application code)
-- workspace_id null = global/system default industry, cloned into a
-- workspace on first use if the user wants to customize it.
-- ---------------------------------------------------------------------------
create table public.industries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  pain_points text[] not null default '{}',
  keywords text[] not null default '{}',
  content_need_weight int not null default 50 check (content_need_weight between 0 and 100),
  is_visual_segment boolean not null default false,
  recurring_need boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table public.industry_cnaes (
  industry_id uuid not null references public.industries (id) on delete cascade,
  cnae_code text not null references public.cnaes (code) on delete cascade,
  primary key (industry_id, cnae_code)
);

-- ---------------------------------------------------------------------------
-- pipeline_stages: configurable CRM funnel per workspace
-- ---------------------------------------------------------------------------
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  label text not null,
  position int not null,
  kind text not null default 'open' check (kind in ('open','won','lost','do_not_contact')),
  color text default '#64748b',
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

-- ---------------------------------------------------------------------------
-- scoring_rules: configurable weights that drive the Prospect Score
-- category = which sub-score this rule contributes to.
-- ---------------------------------------------------------------------------
create table public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  label text not null,
  category text not null check (category in (
    'digital_presence','content_need','purchase_capacity',
    'marketing_opportunity','fit','size','local_proximity'
  )),
  points numeric not null default 0,
  weight numeric not null default 1,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

-- weights of each category towards the final Prospect Score (0-1, sums ~1)
create table public.scoring_category_weights (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  category text not null check (category in (
    'digital_presence','content_need','purchase_capacity',
    'marketing_opportunity','fit','size','local_proximity'
  )),
  weight numeric not null default 0,
  primary key (workspace_id, category)
);

-- ---------------------------------------------------------------------------
-- offers: services the agency sells, mapped to industries
-- ---------------------------------------------------------------------------
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  offer_type text default 'recurring' check (offer_type in ('recurring','one_off')),
  industry_id uuid references public.industries (id) on delete set null,
  argument text,
  ticket_min numeric,
  ticket_max numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- industry_playbooks: dores, ofertas, objeções, canais por nicho
-- ---------------------------------------------------------------------------
create table public.industry_playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  industry_id uuid not null references public.industries (id) on delete cascade,
  pain_points text[] not null default '{}',
  recommended_offers text[] not null default '{}',
  objections jsonb not null default '[]'::jsonb, -- [{objection, response}]
  channels text[] not null default '{}',
  approach_notes text,
  opportunity_signals text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, industry_id)
);

-- ---------------------------------------------------------------------------
-- content_ideas: rule/template-based (no AI) content idea library per niche
-- ---------------------------------------------------------------------------
create table public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  industry_id uuid references public.industries (id) on delete cascade,
  title text not null,
  hook text,
  format text,
  objective text,
  audience text,
  script_outline text,
  cta text,
  offer_id uuid references public.offers (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- message_templates: catalog by niche/stage/channel/objective, with
-- {variable} placeholders resolved by the Message Template Engine.
-- ---------------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  industry_id uuid references public.industries (id) on delete set null,
  stage text default 'first_contact' check (stage in ('first_contact','followup_1','followup_2','followup_3','custom')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp','email','phone_script','instagram','linkedin')),
  objective text,
  subject text,
  body text not null,
  personalization_level int not null default 2 check (personalization_level between 0 and 4),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- outreach_sequences + steps
-- ---------------------------------------------------------------------------
create table public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.outreach_sequences (id) on delete cascade,
  step_order int not null,
  day_offset int not null default 0,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','email','phone_script','instagram','linkedin')),
  template_id uuid references public.message_templates (id) on delete set null,
  send_mode text not null default 'ASSISTED' check (send_mode in ('MANUAL','ASSISTED','AUTOMATED_IF_SUPPORTED')),
  unique (sequence_id, step_order)
);
