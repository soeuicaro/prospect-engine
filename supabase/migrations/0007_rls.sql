-- =============================================================================
-- 0007_rls.sql — Row Level Security for every tenant-scoped table.
-- Rule: nothing is readable or writable unless the requesting user is a
-- member of the row's workspace. Service-role (server-only) bypasses RLS
-- and must never be exposed to the browser (see SECURITY.md).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Allow workspace members to see basic profile info of co-members (for
-- "assigned to" pickers etc.)
create policy profiles_select_co_members on public.profiles
  for select using (
    exists (
      select 1 from public.workspace_members wm1
      join public.workspace_members wm2 on wm1.workspace_id = wm2.workspace_id
      where wm1.user_id = auth.uid() and wm2.user_id = public.profiles.id
    )
  );

-- ---------------------------------------------------------------------------
-- workspaces / workspace_members
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy workspaces_select on public.workspaces
  for select using (public.is_workspace_member(id));

create policy workspaces_update on public.workspaces
  for update using (public.current_workspace_role(id) = 'admin')
  with check (public.current_workspace_role(id) = 'admin');

-- Inserts happen exclusively through create_workspace() (SECURITY DEFINER),
-- so no direct INSERT policy is granted to authenticated clients.

create policy workspace_members_select on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));

create policy workspace_members_insert on public.workspace_members
  for insert with check (public.current_workspace_role(workspace_id) = 'admin');

create policy workspace_members_delete on public.workspace_members
  for delete using (public.current_workspace_role(workspace_id) = 'admin');

-- ---------------------------------------------------------------------------
-- cnaes: public reference data, read-only for any authenticated user
-- ---------------------------------------------------------------------------
alter table public.cnaes enable row level security;

create policy cnaes_select_all on public.cnaes
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- industries: global (workspace_id null) rows are readable by everyone;
-- workspace-owned rows only by members.
-- ---------------------------------------------------------------------------
alter table public.industries enable row level security;
alter table public.industry_cnaes enable row level security;

create policy industries_select on public.industries
  for select using (workspace_id is null or public.is_workspace_member(workspace_id));

create policy industries_insert on public.industries
  for insert with check (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy industries_update on public.industries
  for update using (workspace_id is not null and public.is_workspace_member(workspace_id))
  with check (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy industries_delete on public.industries
  for delete using (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy industry_cnaes_select on public.industry_cnaes
  for select using (
    exists (
      select 1 from public.industries i where i.id = industry_id
        and (i.workspace_id is null or public.is_workspace_member(i.workspace_id))
    )
  );

create policy industry_cnaes_write on public.industry_cnaes
  for all using (
    exists (
      select 1 from public.industries i where i.id = industry_id
        and i.workspace_id is not null and public.is_workspace_member(i.workspace_id)
    )
  ) with check (
    exists (
      select 1 from public.industries i where i.id = industry_id
        and i.workspace_id is not null and public.is_workspace_member(i.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Uniform workspace_id-scoped tables: full CRUD for workspace members.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'companies','company_sources','company_contacts','company_social_profiles',
    'company_analysis','company_scores','company_score_factors',
    'campaigns','campaign_leads','lead_outreach','followups','tasks','notes',
    'lead_stage_history','suppression_list','consents','data_verification',
    'imports','automation_jobs','source_runs','settings','exports',
    'pipeline_stages','scoring_rules','scoring_category_weights','offers',
    'industry_playbooks','content_ideas','message_templates','outreach_sequences',
    'audit_logs'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);

    execute format(
      'create policy %1$I_select on public.%1$I for select using (public.is_workspace_member(workspace_id));',
      t
    );
    execute format(
      'create policy %1$I_insert on public.%1$I for insert with check (public.is_workspace_member(workspace_id));',
      t
    );
    execute format(
      'create policy %1$I_update on public.%1$I for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));',
      t
    );
    execute format(
      'create policy %1$I_delete on public.%1$I for delete using (public.is_workspace_member(workspace_id));',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Child tables without a direct workspace_id column: scope via parent join.
-- ---------------------------------------------------------------------------
alter table public.sequence_steps enable row level security;

create policy sequence_steps_all on public.sequence_steps
  for all using (
    exists (
      select 1 from public.outreach_sequences s
      where s.id = sequence_id and public.is_workspace_member(s.workspace_id)
    )
  ) with check (
    exists (
      select 1 from public.outreach_sequences s
      where s.id = sequence_id and public.is_workspace_member(s.workspace_id)
    )
  );

alter table public.import_errors enable row level security;

create policy import_errors_all on public.import_errors
  for all using (
    exists (
      select 1 from public.imports imp
      where imp.id = import_id and public.is_workspace_member(imp.workspace_id)
    )
  ) with check (
    exists (
      select 1 from public.imports imp
      where imp.id = import_id and public.is_workspace_member(imp.workspace_id)
    )
  );

alter table public.automation_logs enable row level security;

create policy automation_logs_all on public.automation_logs
  for all using (
    exists (
      select 1 from public.automation_jobs j
      where j.id = job_id and public.is_workspace_member(j.workspace_id)
    )
  ) with check (
    exists (
      select 1 from public.automation_jobs j
      where j.id = job_id and public.is_workspace_member(j.workspace_id)
    )
  );
