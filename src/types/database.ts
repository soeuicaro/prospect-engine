/**
 * Hand-authored types mirroring supabase/migrations/*.sql.
 *
 * This project has no live Supabase project yet, so these were NOT generated
 * with `supabase gen types typescript`. Once a project is linked, regenerate
 * with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 * and re-apply the JSDoc header + any hand-added convenience types.
 */

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type UnknownableConfidence = Confidence | "UNKNOWN";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type BusinessProfile = {
  commercial_name?: string;
  description?: string;
  services?: string[];
  regions?: string[];
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  whatsapp?: string;
  sender_name?: string;
}

export type Workspace = {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  signature: string | null;
  tone_of_voice: string;
  business_profile: BusinessProfile;
  cost_mode: "FREE_ONLY" | "MANUAL_OVERRIDE";
  feature_flags: Record<string, boolean>;
  contact_limits: {
    max_contacts_per_day: number;
    max_new_contacts_per_day: number;
    max_followups_per_day: number;
  };
  data_retention: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "admin" | "vendedor" | "sdr" | "visualizador";
  created_at: string;
}

export type Cnae = {
  code: string;
  description: string;
}

export type Industry = {
  id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  pain_points: string[];
  keywords: string[];
  content_need_weight: number;
  is_visual_segment: boolean;
  recurring_need: boolean;
  created_at: string;
}

export type ScoringCategory =
  | "digital_presence"
  | "content_need"
  | "purchase_capacity"
  | "marketing_opportunity"
  | "fit"
  | "size"
  | "local_proximity";

export type PipelineStage = {
  id: string;
  workspace_id: string;
  key: string;
  label: string;
  position: number;
  kind: "open" | "won" | "lost" | "do_not_contact";
  color: string | null;
  created_at: string;
}

export type ScoringRule = {
  id: string;
  workspace_id: string;
  key: string;
  label: string;
  category: ScoringCategory;
  points: number;
  weight: number;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

export type ScoringCategoryWeight = {
  workspace_id: string;
  category: ScoringCategory;
  weight: number;
}

export type OfferType = "recurring" | "one_off";

export type Offer = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  offer_type: OfferType;
  industry_id: string | null;
  argument: string | null;
  ticket_min: number | null;
  ticket_max: number | null;
  active: boolean;
  created_at: string;
}

export type IndustryPlaybook = {
  id: string;
  workspace_id: string;
  industry_id: string;
  pain_points: string[];
  recommended_offers: string[];
  objections: { objection: string; response: string }[];
  channels: string[];
  approach_notes: string | null;
  opportunity_signals: string[];
  created_at: string;
}

export type ContentIdea = {
  id: string;
  workspace_id: string;
  industry_id: string | null;
  title: string;
  hook: string | null;
  format: string | null;
  objective: string | null;
  audience: string | null;
  script_outline: string | null;
  cta: string | null;
  offer_id: string | null;
  created_at: string;
}

export type MessageChannel =
  | "whatsapp"
  | "email"
  | "phone_script"
  | "instagram"
  | "linkedin";

export type MessageTemplate = {
  id: string;
  workspace_id: string;
  name: string;
  industry_id: string | null;
  stage: "first_contact" | "followup_1" | "followup_2" | "followup_3" | "custom";
  channel: MessageChannel;
  objective: string | null;
  subject: string | null;
  body: string;
  personalization_level: 0 | 1 | 2 | 3 | 4;
  active: boolean;
  created_at: string;
}

export type OutreachSequence = {
  id: string;
  workspace_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export type SendMode = "MANUAL" | "ASSISTED" | "AUTOMATED_IF_SUPPORTED";

export type SequenceStep = {
  id: string;
  sequence_id: string;
  step_order: number;
  day_offset: number;
  channel: MessageChannel;
  template_id: string | null;
  send_mode: SendMode;
}

export type OfficialSize = {
  value?: "MEI" | "ME" | "EPP" | "DEMAIS";
  source?: string;
  source_date?: string;
  confidence?: UnknownableConfidence;
}

export type EstimatedSize = "MICRO_LOCAL" | "PEQUENA" | "MEDIA" | "GRANDE_REGIONAL";

export type Company = {
  id: string;
  workspace_id: string;
  legal_name: string | null;
  trade_name: string | null;
  cnpj: string | null;
  cnpj_status: "ATIVA" | "SUSPENSA" | "INAPTA" | "BAIXADA" | "NULA" | "UNKNOWN" | null;
  cnpj_status_date: string | null;
  opened_at: string | null;
  legal_nature: string | null;
  cnae_primary: string | null;
  cnae_secondary: string[];
  industry_id: string | null;
  official_size: OfficialSize;
  estimated_size: EstimatedSize | null;
  estimated_size_confidence: UnknownableConfidence;
  estimated_size_signals: unknown[];
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  geo_source: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  website: string | null;
  website_domain: string | null;
  whatsapp: string | null;
  maps_validation_status: "NOT_VALIDATED" | "VALIDATED_BY_USER" | "DISCREPANCY_FOUND";
  maps_last_validated_at: string | null;
  data_quality_score: number;
  last_verified_at: string | null;
  pipeline_stage_id: string | null;
  lead_temperature: "HOT" | "WARM" | "COLD";
  next_best_action: string | null;
  sales_readiness: "READY" | "POTENTIAL" | "LOW" | "UNKNOWN";
  client_since: string | null;
  won_offer_id: string | null;
  won_value: number | null;
  won_recurring_value: number | null;
  lost_reason: string | null;
  tags: string[];
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SourceType =
  | "CNPJ"
  | "OSM"
  | "WEBSITE"
  | "MANUAL"
  | "IMPORT_CSV"
  | "IMPORT_XLSX"
  | "MAPS_VALIDATION"
  | "OTHER";

export type CompanySource = {
  id: string;
  workspace_id: string;
  company_id: string;
  source_type: SourceType;
  source_name: string;
  source_url: string | null;
  source_record_id: string | null;
  collected_at: string;
  last_verified_at: string | null;
  confidence: Confidence;
  raw_ref: Record<string, unknown>;
}

export type ContactType =
  | "RESPONSAVEL_CADASTRAL"
  | "SOCIO"
  | "DECISOR_ESTIMADO"
  | "CONTATO_COMERCIAL";

export type CompanyContact = {
  id: string;
  workspace_id: string;
  company_id: string;
  name: string | null;
  role: string | null;
  contact_type: ContactType;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  channel_priority: number;
  evidence_source: string | null;
  confidence: Confidence;
  notes: string | null;
  created_at: string;
}

export type SocialChannel =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "whatsapp"
  | "other";

export type CompanySocialProfile = {
  id: string;
  workspace_id: string;
  company_id: string;
  channel: SocialChannel;
  handle_or_url: string | null;
  status: "FOUND" | "NOT_FOUND" | "UNKNOWN" | "NOT_CHECKED";
  source: string | null;
  confidence: Confidence;
  checked_at: string | null;
}

export type CompanyAnalysis = {
  id: string;
  workspace_id: string;
  company_id: string;
  website_status: "ACTIVE" | "INACTIVE" | "TIMEOUT" | "DNS_ERROR" | "HTTPS_ERROR" | "UNKNOWN";
  website_flags: string[];
  has_blog: boolean | null;
  has_https: boolean | null;
  has_sitemap: boolean | null;
  content_presence: "PRESENT" | "WEAK" | "ABSENT" | "NOT_VERIFIED";
  summary: Record<string, unknown>;
  last_analyzed_at: string | null;
  content_hash: string | null;
  created_at: string;
}

export type CompanyScores = {
  id: string;
  workspace_id: string;
  company_id: string;
  digital_presence_score: number;
  content_need_score: number;
  purchase_capacity_score: number;
  marketing_opportunity_score: number;
  fit_score: number;
  size_score: number;
  local_proximity_score: number;
  prospect_score: number;
  contactability_score: number;
  opportunity_level: "MUITO_ALTO" | "ALTO" | "MEDIO" | "BAIXO";
  rule_version: string | null;
  computed_at: string;
}

export type CompanyScoreFactor = {
  id: string;
  workspace_id: string;
  company_id: string;
  factor_key: string;
  factor_label: string;
  category: string;
  points: number;
  evidence: string | null;
  confidence: Confidence;
  computed_at: string;
}

export type CampaignStatus = "DRAFT" | "READY" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export type Campaign = {
  id: string;
  workspace_id: string;
  name: string;
  cities: string[];
  state: string | null;
  niches: string[];
  radius_km: number | null;
  min_score: number | null;
  target_count: number | null;
  size_filter: string[];
  offer_id: string | null;
  template_id: string | null;
  sequence_id: string | null;
  status: CampaignStatus;
  channel_send_mode: SendMode;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignLead = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  company_id: string;
  status:
    | "QUEUED"
    | "SKIPPED_SUPPRESSED"
    | "SKIPPED_DUPLICATE"
    | "SKIPPED_NO_CONTACT"
    | "SKIPPED_INSUFFICIENT_DATA"
    | "SENT"
    | "DONE";
  added_at: string;
}

export type ResponseType =
  | "INTERESTED"
  | "NOT_NOW"
  | "NO_INTEREST"
  | "ASKED_PRICE"
  | "ASKED_DETAILS"
  | "MEETING_REQUESTED"
  | "WRONG_CONTACT"
  | "OPT_OUT"
  | "UNKNOWN";

export type LeadOutreach = {
  id: string;
  workspace_id: string;
  company_id: string;
  campaign_id: string | null;
  sequence_step_id: string | null;
  channel: MessageChannel | "manual";
  template_id: string | null;
  message_preview: string | null;
  send_mode: SendMode;
  status: "PENDING" | "MARKED_SENT" | "DELIVERED_UNKNOWN" | "FAILED";
  response_type: ResponseType | null;
  sent_at: string | null;
  responded_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type Followup = {
  id: string;
  workspace_id: string;
  company_id: string;
  lead_outreach_id: string | null;
  follow_up_at: string;
  follow_up_type: "manual" | "assisted" | "automatic";
  status: "PENDING" | "DONE" | "RESCHEDULED" | "CANCELLED" | "NO_RESPONSE" | "INTERESTED" | "OPT_OUT";
  note: string | null;
  assigned_to: string | null;
  created_at: string;
  completed_at: string | null;
}

export type Task = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "OPEN" | "DONE" | "CANCELLED";
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export type Note = {
  id: string;
  workspace_id: string;
  company_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export type LeadStageHistory = {
  id: string;
  workspace_id: string;
  company_id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  changed_by: string | null;
  changed_at: string;
  note: string | null;
}

export type SuppressionReason =
  | "opt_out"
  | "nao_quer_contato"
  | "numero_invalido"
  | "email_invalido"
  | "reclamacao"
  | "bloqueado"
  | "duplicado"
  | "juridico"
  | "manual";

export type SuppressionEntry = {
  id: string;
  workspace_id: string;
  company_id: string | null;
  contact_id: string | null;
  channel: MessageChannel | "phone" | "all" | null;
  value: string | null;
  reason: SuppressionReason;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

export type ImportJob = {
  id: string;
  workspace_id: string;
  file_name: string;
  source_type: "CSV" | "XLSX" | "CNPJ_DATASET" | "OSM";
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  column_mapping: Record<string, string>;
  dataset_version: string | null;
  source_date: string | null;
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  duplicate_count: number;
  error_count: number;
  checkpoint: Record<string, unknown>;
  idempotency_key: string | null;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type ImportError = {
  id: string;
  import_id: string;
  row_number: number | null;
  error_message: string;
  raw_row: Record<string, unknown> | null;
  created_at: string;
}

export type AutomationJob = {
  id: string;
  workspace_id: string;
  type:
    | "DATA_IMPORT"
    | "DATA_ENRICHMENT"
    | "WEBSITE_ANALYSIS"
    | "SCORE_CALCULATION"
    | "FOLLOWUP_REMINDER"
    | "DAILY_DIGEST"
    | "LEAD_REFRESH"
    | "DEDUPLICATION";
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  priority: number;
  payload: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type AuditLog = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Minimal Supabase-js compatible generic. Loose Insert/Update (Partial<Row>)
 * to keep hand-authored types practical — tighten once real generated types
 * replace this file. `Rel` carries the FK edges actually used by embedded
 * selects (`.select("..., related(...)")`) in application code — without
 * this, postgrest-js cannot type-check/type-infer embedded resources.
 */
type GenericRelationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Rel extends GenericRelationship[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Rel;
};

type Fk<
  Name extends string,
  Cols extends readonly string[],
  Ref extends string,
  RefCols extends readonly string[] = ["id"],
  OneToOne extends boolean = false
> = { foreignKeyName: Name; columns: [...Cols]; isOneToOne: OneToOne; referencedRelation: Ref; referencedColumns: [...RefCols] };

type CompaniesRel = [
  Fk<"companies_industry_id_fkey", ["industry_id"], "industries">,
  Fk<"companies_pipeline_stage_id_fkey", ["pipeline_stage_id"], "pipeline_stages">,
  Fk<"companies_won_offer_id_fkey", ["won_offer_id"], "offers">
];
type CompanyChildRel<Name extends string> = [Fk<Name, ["company_id"], "companies">];
type CompanyChildRelOneToOne<Name extends string> = [Fk<Name, ["company_id"], "companies", ["id"], true>];

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      workspaces: Table<Workspace>;
      workspace_members: Table<WorkspaceMember>;
      cnaes: Table<Cnae>;
      industries: Table<Industry>;
      pipeline_stages: Table<PipelineStage>;
      scoring_rules: Table<ScoringRule>;
      scoring_category_weights: Table<ScoringCategoryWeight>;
      offers: Table<Offer, [Fk<"offers_industry_id_fkey", ["industry_id"], "industries">]>;
      industry_playbooks: Table<IndustryPlaybook, [Fk<"industry_playbooks_industry_id_fkey", ["industry_id"], "industries">]>;
      content_ideas: Table<
        ContentIdea,
        [
          Fk<"content_ideas_industry_id_fkey", ["industry_id"], "industries">,
          Fk<"content_ideas_offer_id_fkey", ["offer_id"], "offers">
        ]
      >;
      message_templates: Table<MessageTemplate, [Fk<"message_templates_industry_id_fkey", ["industry_id"], "industries">]>;
      outreach_sequences: Table<OutreachSequence>;
      sequence_steps: Table<
        SequenceStep,
        [
          Fk<"sequence_steps_sequence_id_fkey", ["sequence_id"], "outreach_sequences">,
          Fk<"sequence_steps_template_id_fkey", ["template_id"], "message_templates">
        ]
      >;
      companies: Table<Company, CompaniesRel>;
      company_sources: Table<CompanySource, CompanyChildRel<"company_sources_company_id_fkey">>;
      company_contacts: Table<CompanyContact, CompanyChildRel<"company_contacts_company_id_fkey">>;
      company_social_profiles: Table<CompanySocialProfile, CompanyChildRel<"company_social_profiles_company_id_fkey">>;
      company_analysis: Table<CompanyAnalysis, CompanyChildRel<"company_analysis_company_id_fkey">>;
      company_scores: Table<CompanyScores, CompanyChildRelOneToOne<"company_scores_company_id_fkey">>;
      company_score_factors: Table<CompanyScoreFactor, CompanyChildRel<"company_score_factors_company_id_fkey">>;
      campaigns: Table<
        Campaign,
        [
          Fk<"campaigns_offer_id_fkey", ["offer_id"], "offers">,
          Fk<"campaigns_template_id_fkey", ["template_id"], "message_templates">,
          Fk<"campaigns_sequence_id_fkey", ["sequence_id"], "outreach_sequences">
        ]
      >;
      campaign_leads: Table<
        CampaignLead,
        [
          Fk<"campaign_leads_campaign_id_fkey", ["campaign_id"], "campaigns">,
          Fk<"campaign_leads_company_id_fkey", ["company_id"], "companies">
        ]
      >;
      lead_outreach: Table<LeadOutreach, CompanyChildRel<"lead_outreach_company_id_fkey">>;
      followups: Table<Followup, CompanyChildRel<"followups_company_id_fkey">>;
      tasks: Table<Task, CompanyChildRel<"tasks_company_id_fkey">>;
      notes: Table<Note, CompanyChildRel<"notes_company_id_fkey">>;
      lead_stage_history: Table<LeadStageHistory, CompanyChildRel<"lead_stage_history_company_id_fkey">>;
      suppression_list: Table<
        SuppressionEntry,
        [
          Fk<"suppression_list_company_id_fkey", ["company_id"], "companies">,
          Fk<"suppression_list_contact_id_fkey", ["contact_id"], "company_contacts">
        ]
      >;
      imports: Table<ImportJob>;
      import_errors: Table<ImportError, [Fk<"import_errors_import_id_fkey", ["import_id"], "imports">]>;
      automation_jobs: Table<AutomationJob>;
      audit_logs: Table<AuditLog>;
    };
    Views: Record<string, never>;
    Functions: {
      create_workspace: {
        Args: { p_name: string; p_city?: string | null; p_state?: string | null };
        Returns: string;
      };
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean };
    };
  };
}
