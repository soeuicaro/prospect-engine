import { z } from "zod";

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1, "Nome da campanha é obrigatório").max(200),
  cities: z.array(z.string().trim().min(1)).min(1, "Selecione ao menos uma cidade"),
  state: z.string().trim().length(2).optional().or(z.literal("")),
  niches: z.array(z.string().uuid()).min(1, "Selecione ao menos um nicho"),
  radius_km: z.coerce.number().min(0).max(500).optional(),
  min_score: z.coerce.number().min(0).max(100).default(0),
  target_count: z.coerce.number().min(1).max(5000).optional(),
  offer_id: z.string().uuid().optional().or(z.literal("")),
  template_id: z.string().uuid().optional().or(z.literal("")),
  sequence_id: z.string().uuid().optional().or(z.literal("")),
});

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const messageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industry_id: z.string().uuid().optional().or(z.literal("")),
  stage: z.enum(["first_contact", "followup_1", "followup_2", "followup_3", "custom"]).default("first_contact"),
  channel: z.enum(["whatsapp", "email", "phone_script", "instagram", "linkedin"]).default("whatsapp"),
  subject: z.string().trim().max(200).optional().or(z.literal("")),
  body: z.string().trim().min(1, "Corpo da mensagem é obrigatório").max(4000),
});

export const offerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  offer_type: z.enum(["recurring", "one_off"]).default("recurring"),
  industry_id: z.string().uuid().optional().or(z.literal("")),
  argument: z.string().trim().max(1000).optional().or(z.literal("")),
  ticket_min: z.coerce.number().min(0).optional(),
  ticket_max: z.coerce.number().min(0).optional(),
});
