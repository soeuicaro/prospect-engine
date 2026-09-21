-- =============================================================================
-- 0001_core.sql — Extensions, helper functions, profiles, workspaces, audit log
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- workspaces (multi-tenancy root)
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  city text,
  state text,
  logo_url text,
  signature text,
  tone_of_voice text default 'consultivo' check (tone_of_voice in
    ('direto','amigavel','profissional','premium','consultivo','descontraido')),
  business_profile jsonb not null default '{}'::jsonb,
  -- business_profile: { commercial_name, description, services[], regions[],
  --   phone, email, website, instagram, whatsapp, sender_name }
  cost_mode text not null default 'FREE_ONLY' check (cost_mode in ('FREE_ONLY','MANUAL_OVERRIDE')),
  feature_flags jsonb not null default '{
    "MAPS_LINKS": true,
    "WEB_ANALYSIS": true,
    "OSM_DISCOVERY": true,
    "CNPJ_IMPORT": true,
    "EMAIL_ASSIST": true,
    "WHATSAPP_ASSIST": true,
    "AI_DISABLED": true,
    "LOCAL_AI": false,
    "ADVANCED_AUTOMATION": false
  }'::jsonb,
  contact_limits jsonb not null default '{
    "max_contacts_per_day": 40,
    "max_new_contacts_per_day": 20,
    "max_followups_per_day": 30
  }'::jsonb,
  data_retention jsonb not null default '{
    "raw_crawl_days": 30,
    "analysis": "while_lead_active",
    "suppression": "indefinite"
  }'::jsonb,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin','vendedor','sdr','visualizador')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- RLS helper: is the current auth user a member of this workspace?
-- SECURITY DEFINER avoids infinite recursion when workspace_members itself
-- has RLS enabled.
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.current_workspace_role(ws_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.workspace_members
  where workspace_id = ws_id and user_id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- audit_logs: append-only record of sensitive actions
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);

comment on table public.workspaces is 'Tenant root. Every commercial record hangs off a workspace_id and is isolated by RLS.';
comment on function public.is_workspace_member is 'SECURITY DEFINER: used inside RLS policies without recursing into workspace_members RLS.';
