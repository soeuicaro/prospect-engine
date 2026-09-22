-- =============================================================================
-- 0009_single_user_bootstrap.sql — this app runs single-user, session-less:
-- there is no login/signup flow, and every server request goes through the
-- service-role client (no Supabase Auth JWT, so auth.uid() is always null).
-- create_workspace() previously required auth.uid() and would reject every
-- call. It now accepts an explicit p_owner_id (the one fixed owner's
-- profiles.id) and falls back to auth.uid() only if that isn't passed, so
-- it still works unchanged for any future request that does carry a real
-- session.
-- =============================================================================

-- Adding a trailing parameter changes the function's signature, so
-- `create or replace` below would create a second overload instead of
-- replacing this one — drop it explicitly first.
drop function if exists public.create_workspace(text, text, text);

create or replace function public.create_workspace(
  p_name text,
  p_city text default null,
  p_state text default null,
  p_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_id uuid;
  v_uid uuid := coalesce(p_owner_id, auth.uid());
  v_ind_restaurante uuid;
  v_ind_clinica uuid;
  v_ind_academia uuid;
  v_offer_conteudo uuid;
begin
  if v_uid is null then
    raise exception 'create_workspace requires an owner (pass p_owner_id, or call with an authenticated session)';
  end if;

  insert into public.workspaces (name, city, state, created_by)
  values (p_name, p_city, p_state, v_uid)
  returning id into v_ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, v_uid, 'admin');

  -- ---- Pipeline stages (section 37) -----------------------------------
  insert into public.pipeline_stages (workspace_id, key, label, position, kind, color) values
    (v_ws_id, 'NEW', 'Novo', 1, 'open', '#64748b'),
    (v_ws_id, 'QUALIFIED', 'Qualificado', 2, 'open', '#3b82f6'),
    (v_ws_id, 'CONTACTED', 'Contatado', 3, 'open', '#6366f1'),
    (v_ws_id, 'REPLIED', 'Respondeu', 4, 'open', '#8b5cf6'),
    (v_ws_id, 'MEETING', 'Reunião', 5, 'open', '#a855f7'),
    (v_ws_id, 'PROPOSAL', 'Proposta', 6, 'open', '#d946ef'),
    (v_ws_id, 'NEGOTIATION', 'Negociação', 7, 'open', '#ec4899'),
    (v_ws_id, 'WON', 'Ganho', 8, 'won', '#22c55e'),
    (v_ws_id, 'LOST', 'Perdido', 9, 'lost', '#ef4444'),
    (v_ws_id, 'NURTURE', 'Nutrição', 10, 'open', '#f59e0b'),
    (v_ws_id, 'DO_NOT_CONTACT', 'Não Contatar', 11, 'do_not_contact', '#71717a');

  -- ---- Scoring category weights (section 7) ---------------------------
  insert into public.scoring_category_weights (workspace_id, category, weight) values
    (v_ws_id, 'digital_presence', 0.20),
    (v_ws_id, 'content_need', 0.25),
    (v_ws_id, 'purchase_capacity', 0.15),
    (v_ws_id, 'fit', 0.20),
    (v_ws_id, 'size', 0.10),
    (v_ws_id, 'local_proximity', 0.10),
    (v_ws_id, 'marketing_opportunity', 0.00);

  -- ---- Scoring rules (section 67 example, normalized 0-100) -----------
  insert into public.scoring_rules (workspace_id, key, label, category, points, weight) values
    (v_ws_id, 'no_website', 'Website ausente', 'digital_presence', 15, 1),
    (v_ws_id, 'weak_social_presence', 'Presença social fraca', 'digital_presence', 10, 1),
    (v_ws_id, 'visual_segment', 'Segmento visual', 'content_need', 10, 1),
    (v_ws_id, 'recurring_content_need', 'Necessidade recorrente de conteúdo', 'content_need', 10, 1),
    (v_ws_id, 'local_business', 'Negócio local', 'local_proximity', 5, 1),
    (v_ws_id, 'multi_unit', 'Múltiplas unidades', 'size', 10, 1),
    (v_ws_id, 'new_business', 'Empresa nova', 'fit', 10, 1),
    (v_ws_id, 'business_contact_available', 'Contato empresarial disponível', 'digital_presence', 5, 1),
    (v_ws_id, 'high_offer_fit', 'Oferta altamente aderente', 'fit', 15, 1),
    (v_ws_id, 'weak_marketing_signals', 'Sinais de marketing fraco', 'marketing_opportunity', 10, 1);

  -- ---- Starter industries: clone the 3 global samples into workspace --
  -- (Users can add unlimited custom niches from Settings > Niche Builder)
  select id into v_ind_restaurante from public.industries where slug = 'restaurante' and workspace_id is null;
  select id into v_ind_clinica from public.industries where slug = 'clinica' and workspace_id is null;
  select id into v_ind_academia from public.industries where slug = 'academia' and workspace_id is null;

  -- ---- Starter offer ----------------------------------------------------
  insert into public.offers (workspace_id, name, description, offer_type, argument, ticket_min, ticket_max)
  values (v_ws_id, 'Produção mensal de conteúdo', 'Pacote recorrente de fotos e vídeos para redes sociais', 'recurring',
    'Conteúdo consistente e profissional todo mês, sem a empresa precisar produzir nada internamente.', 800, 3000)
  returning id into v_offer_conteudo;

  insert into public.offers (workspace_id, name, description, offer_type, argument, ticket_min, ticket_max) values
    (v_ws_id, 'Filmagem institucional', 'Vídeo institucional único para apresentar a empresa', 'one_off', 'Autoridade e credibilidade para o site e redes.', 1500, 6000),
    (v_ws_id, 'Cobertura de eventos', 'Fotografia e vídeo de eventos pontuais', 'one_off', 'Registro profissional de lançamentos e eventos.', 900, 4000),
    (v_ws_id, 'Pacote de lançamento', 'Branding audiovisual para empresas novas', 'one_off', 'Primeira impressão forte para quem está abrindo.', 1200, 5000);

  -- ---- Starter message templates ---------------------------------------
  insert into public.message_templates (workspace_id, name, industry_id, stage, channel, objective, body, personalization_level) values
    (v_ws_id, 'Restaurant_FirstContact', v_ind_restaurante, 'first_contact', 'whatsapp', 'Primeiro contato',
      E'Olá, {first_name}! Tudo bem?\n\nVi a {company_name} e {observation}.\n\nTrabalho com produção de conteúdo e audiovisual para negócios da região. Tive uma ideia específica para vocês: {content_idea}.\n\nPosso te mandar mais detalhes?', 3),
    (v_ws_id, 'Restaurant_Followup1', v_ind_restaurante, 'followup_1', 'whatsapp', 'Follow-up 1',
      E'Oi, {first_name}! Passando para saber se viu minha mensagem sobre {content_idea} para a {company_name}. Faz sentido conversarmos essa semana?', 2),
    (v_ws_id, 'Clinic_FirstContact', v_ind_clinica, 'first_contact', 'whatsapp', 'Primeiro contato',
      E'Olá, {first_name}! Tudo bem?\n\nVi a {company_name} e {observation}.\n\nTrabalho com conteúdo de autoridade para clínicas na região — algo que ajuda a gerar confiança antes mesmo da primeira consulta.\n\nPosso te mostrar uma ideia rápida?', 3),
    (v_ws_id, 'Gym_FirstContact', v_ind_academia, 'first_contact', 'whatsapp', 'Primeiro contato',
      E'Olá, {first_name}! Tudo bem?\n\nVi a {company_name} e {observation}.\n\nTenho uma ideia de conteúdo de transformação/resultados que costuma funcionar muito bem para academias. Posso te mandar?', 3);

  -- ---- Starter content ideas ---------------------------------------------
  insert into public.content_ideas (workspace_id, industry_id, title, hook, format, objective, audience, cta, offer_id) values
    (v_ws_id, v_ind_restaurante, '3 pratos que você deveria experimentar', 'Ranking rápido e visual', 'Reels', 'Engajamento', 'Clientes locais', 'Chama no WhatsApp para reservar', v_offer_conteudo),
    (v_ws_id, v_ind_restaurante, 'Bastidores da cozinha', 'Curiosidade sobre o preparo', 'Reels', 'Conexão', 'Seguidores', 'Marque um amigo', v_offer_conteudo),
    (v_ws_id, v_ind_clinica, '3 dúvidas frequentes', 'Educar e gerar autoridade', 'Carrossel', 'Autoridade', 'Pacientes em potencial', 'Agende sua avaliação', v_offer_conteudo),
    (v_ws_id, v_ind_academia, 'Erros comuns no treino', 'Quebra de mito', 'Reels', 'Autoridade', 'Praticantes', 'Agende uma aula experimental', v_offer_conteudo);

  -- ---- Starter playbooks ---------------------------------------------
  insert into public.industry_playbooks (workspace_id, industry_id, pain_points, recommended_offers, channels, approach_notes, opportunity_signals) values
    (v_ws_id, v_ind_restaurante, array['Conteúdo visual recorrente', 'Baixa frequência de posts', 'Cardápio desatualizado nas redes'],
      array['Produção mensal de conteúdo'], array['whatsapp','instagram'], 'Abordagem visual e específica, citando um prato ou detalhe real do local.',
      array['Sem website', 'Poucos posts recentes', 'Fotos de baixa qualidade']),
    (v_ws_id, v_ind_clinica, array['Falta de autoridade digital', 'Pouca educação do paciente', 'Confiança antes da consulta'],
      array['Produção mensal de conteúdo'], array['whatsapp','instagram'], 'Abordagem consultiva focada em autoridade e humanização.',
      array['Sem Instagram ativo', 'Site sem seção de conteúdo/blog']);

  return v_ws_id;
end;
$$;

comment on function public.create_workspace is 'Atomic workspace bootstrap: creates workspace, adds owner as admin, seeds editable default pipeline/scoring/offers/templates. Pass p_owner_id explicitly when calling without a Supabase Auth session (this app has none).';
