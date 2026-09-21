-- =============================================================================
-- 0008_seed_reference.sql — GLOBAL reference data (not fake/demo data):
-- CNAE codes and starter industries (workspace_id = null → visible to every
-- workspace, clonable/editable per workspace via the Niche Builder).
--
-- NOTE: CNAE codes below are commonly-known official IBGE subclasses used as
-- a practical starting set. Verify against the current IBGE CNAE table
-- (https://concla.ibge.gov.br/) before relying on them for legal/fiscal use
-- — see DATA_SOURCES.md.
-- =============================================================================

insert into public.cnaes (code, description) values
  ('5611-2/01', 'Restaurantes e similares'),
  ('5611-2/03', 'Bares e outros estabelecimentos especializados em servir bebidas'),
  ('5611-2/04', 'Lanchonetes, casas de chá, de sucos e similares'),
  ('4721-1/02', 'Padaria e confeitaria com predominância de produção própria'),
  ('8630-5/03', 'Atividade médica ambulatorial com recursos para realização de exames complementares'),
  ('8630-5/04', 'Atividade odontológica'),
  ('8650-0/03', 'Atividades de psicologia e psicanálise'),
  ('8650-0/06', 'Atividades de fisioterapia'),
  ('8650-0/07', 'Atividades de terapia ocupacional e nutrição'),
  ('9313-1/00', 'Atividades de condicionamento físico'),
  ('8593-7/00', 'Ensino de idiomas'),
  ('8591-1/00', 'Ensino de esportes'),
  ('5510-8/01', 'Hotéis'),
  ('5510-8/02', 'Apart-hotéis'),
  ('5510-8/03', 'Pousadas'),
  ('6821-8/01', 'Corretagem na compra e venda e avaliação de imóveis'),
  ('6821-8/02', 'Corretagem no aluguel de imóveis'),
  ('4120-4/00', 'Construção de edifícios'),
  ('9602-5/01', 'Cabeleireiros, manicure e pedicure'),
  ('9602-5/02', 'Atividades de estética e outros serviços de cuidados com a beleza'),
  ('7420-0/01', 'Atividades de produção de fotografias'),
  ('4789-0/05', 'Comércio varejista de animais vivos e artigos e alimentos para animais de estimação'),
  ('7500-1/00', 'Atividades veterinárias'),
  ('4781-4/00', 'Comércio varejista de artigos do vestuário e acessórios'),
  ('4754-7/01', 'Comércio varejista de móveis'),
  ('4520-0/01', 'Serviços de manutenção e reparação mecânica de veículos automotores'),
  ('7111-1/00', 'Serviços de arquitetura'),
  ('7112-0/00', 'Serviços de engenharia'),
  ('8230-0/01', 'Serviços de organização de feiras, congressos, exposições e festas'),
  ('8599-6/04', 'Treinamento em desenvolvimento profissional e gerencial')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Global starter industries
-- ---------------------------------------------------------------------------
insert into public.industries (workspace_id, name, slug, description, pain_points, keywords, content_need_weight, is_visual_segment, recurring_need) values
  (null, 'Restaurante', 'restaurante',
    'Restaurantes, hamburguerias, pizzarias e casas de comida em geral',
    array['Conteúdo visual recorrente','Cardápio desatualizado nas redes','Baixa frequência de posts'],
    array['restaurante','hamburgueria','pizzaria','bar','cantina','churrascaria'], 90, true, true),
  (null, 'Cafeteria', 'cafeteria',
    'Cafeterias, padarias e casas de chá',
    array['Ambiente pouco explorado nas redes','Falta de recorrência de conteúdo'],
    array['cafeteria','padaria','confeitaria'], 85, true, true),
  (null, 'Clínica Médica', 'clinica',
    'Clínicas médicas, consultórios e centros de saúde',
    array['Falta de autoridade digital','Pouca educação do paciente','Confiança antes da consulta'],
    array['clínica','consultório','médico','saúde'], 75, false, true),
  (null, 'Odontologia', 'odontologia',
    'Consultórios e clínicas odontológicas',
    array['Medo/insegurança do paciente','Falta de prova social','Baixa autoridade digital'],
    array['dentista','odontologia','ortodontia'], 75, false, true),
  (null, 'Psicologia', 'psicologia',
    'Psicólogos e clínicas de psicologia',
    array['Estigma e desinformação','Necessidade de humanização','Baixa presença digital'],
    array['psicólogo','psicoterapia','saúde mental'], 70, false, true),
  (null, 'Fisioterapia', 'fisioterapia',
    'Clínicas e profissionais de fisioterapia',
    array['Falta de prova de resultado','Baixa autoridade digital'],
    array['fisioterapia','reabilitação'], 70, false, true),
  (null, 'Academia', 'academia',
    'Academias, boxes de crossfit e estúdios de treino',
    array['Falta de prova social/transformação','Baixa recorrência de conteúdo'],
    array['academia','crossfit','musculação','personal trainer'], 90, true, true),
  (null, 'Escola / Curso', 'escola',
    'Escolas, cursos livres e faculdades',
    array['Estrutura pouco divulgada','Falta de conteúdo institucional','Baixa presença de eventos'],
    array['escola','curso','faculdade','idiomas'], 65, false, true),
  (null, 'Hotel / Pousada', 'hotelaria',
    'Hotéis, pousadas e hospedagem',
    array['Experiência pouco divulgada','Fotos desatualizadas'],
    array['hotel','pousada','hospedagem'], 85, true, true),
  (null, 'Imobiliária', 'imobiliaria',
    'Imobiliárias e corretores de imóveis',
    array['Anúncios sem vídeo/tour','Baixa produção de conteúdo de imóveis'],
    array['imobiliária','corretor','imóveis'], 90, true, true),
  (null, 'Construção Civil', 'construcao',
    'Construtoras e empresas de reforma',
    array['Obras sem registro de progresso','Falta de prova social'],
    array['construtora','reforma','engenharia civil'], 70, true, true),
  (null, 'Salão de Beleza', 'salao-beleza',
    'Salões de beleza, barbearias e estética',
    array['Baixa frequência de posts','Portfólio de resultados fraco'],
    array['salão','barbearia','estética','cabeleireiro'], 90, true, true),
  (null, 'Pet Shop / Veterinária', 'pet',
    'Pet shops e clínicas veterinárias',
    array['Conteúdo pouco explorado','Baixa recorrência'],
    array['pet shop','veterinária','banho e tosa'], 85, true, true),
  (null, 'Loja / Varejo', 'varejo',
    'Lojas de roupas, móveis, eletrônicos e varejo em geral',
    array['Catálogo desatualizado nas redes','Baixa conversão via Instagram'],
    array['loja','varejo','moda','móveis'], 75, true, true),
  (null, 'Oficina / Concessionária', 'automotivo',
    'Oficinas mecânicas e concessionárias',
    array['Baixa confiança digital','Falta de prova de serviço'],
    array['oficina','concessionária','mecânica'], 60, false, true),
  (null, 'Arquitetura / Engenharia', 'arquitetura',
    'Escritórios de arquitetura e engenharia',
    array['Portfólio pouco visual','Baixa autoridade digital'],
    array['arquiteto','engenheiro','projetos'], 80, true, false),
  (null, 'Eventos / Cerimonial', 'eventos',
    'Cerimonialistas e empresas de eventos',
    array['Portfólio de eventos desatualizado','Baixa prova social em vídeo'],
    array['eventos','cerimonial','casamento'], 90, true, false),
  (null, 'Empresa B2B / Serviços', 'b2b-servicos',
    'Escritórios e empresas de serviços B2B em geral',
    array['Falta de posicionamento institucional','Baixa autoridade digital'],
    array['escritório','consultoria','serviços B2B'], 55, false, false)
on conflict (workspace_id, slug) do nothing;

-- Map industries to a representative CNAE set (best-effort; editable per workspace)
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.industries where slug = 'restaurante' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '5611-2/01'), (v_id, '5611-2/03'), (v_id, '5611-2/04')
  on conflict do nothing;

  select id into v_id from public.industries where slug = 'cafeteria' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '4721-1/02') on conflict do nothing;

  select id into v_id from public.industries where slug = 'clinica' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '8630-5/03') on conflict do nothing;

  select id into v_id from public.industries where slug = 'odontologia' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '8630-5/04') on conflict do nothing;

  select id into v_id from public.industries where slug = 'psicologia' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '8650-0/03') on conflict do nothing;

  select id into v_id from public.industries where slug = 'fisioterapia' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '8650-0/06') on conflict do nothing;

  select id into v_id from public.industries where slug = 'academia' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '9313-1/00') on conflict do nothing;

  select id into v_id from public.industries where slug = 'escola' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '8593-7/00'), (v_id, '8591-1/00') on conflict do nothing;

  select id into v_id from public.industries where slug = 'hotelaria' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '5510-8/01'), (v_id, '5510-8/02'), (v_id, '5510-8/03') on conflict do nothing;

  select id into v_id from public.industries where slug = 'imobiliaria' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '6821-8/01'), (v_id, '6821-8/02') on conflict do nothing;

  select id into v_id from public.industries where slug = 'construcao' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '4120-4/00') on conflict do nothing;

  select id into v_id from public.industries where slug = 'salao-beleza' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '9602-5/01'), (v_id, '9602-5/02') on conflict do nothing;

  select id into v_id from public.industries where slug = 'pet' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '4789-0/05'), (v_id, '7500-1/00') on conflict do nothing;

  select id into v_id from public.industries where slug = 'varejo' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '4781-4/00'), (v_id, '4754-7/01') on conflict do nothing;

  select id into v_id from public.industries where slug = 'automotivo' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '4520-0/01') on conflict do nothing;

  select id into v_id from public.industries where slug = 'arquitetura' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code)
    values (v_id, '7111-1/00'), (v_id, '7112-0/00') on conflict do nothing;

  select id into v_id from public.industries where slug = 'eventos' and workspace_id is null;
  insert into public.industry_cnaes (industry_id, cnae_code) values (v_id, '8230-0/01') on conflict do nothing;
end $$;
