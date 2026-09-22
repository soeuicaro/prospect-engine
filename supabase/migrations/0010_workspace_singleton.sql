-- =============================================================================
-- 0010_workspace_singleton.sql — requireWorkspace() (lib/workspace.ts)
-- auto-creates the one workspace the first time a request doesn't find one
-- (no onboarding form anymore — see 0009). Two concurrent first requests
-- can both see "no workspace yet" before either commits, and both call
-- create_workspace() — this actually happened once already, producing two
-- "Meu Workspace" rows. This constraint makes that impossible at the
-- database level: since this app is single-tenant (see SECURITY.md), at
-- most one row can ever exist in `workspaces`, full stop. A unique index on
-- a constant expression means every row indexes to the same value, so a
-- second insert always violates it.
-- =============================================================================

create unique index if not exists workspaces_singleton_idx on public.workspaces ((true));
