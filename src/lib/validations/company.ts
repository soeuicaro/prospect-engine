import { z } from "zod";

export const companyCreateSchema = z.object({
  legal_name: z.string().trim().min(1, "Razão social é obrigatória").max(200).optional().or(z.literal("")),
  trade_name: z.string().trim().min(1, "Nome fantasia é obrigatório").max(200),
  cnpj: z.string().trim().max(20).optional().or(z.literal("")),
  industry_id: z.string().uuid().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido").max(200).optional().or(z.literal("")),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(30).optional().or(z.literal("")),
  street: z.string().trim().max(200).optional().or(z.literal("")),
  street_number: z.string().trim().max(20).optional().or(z.literal("")),
  neighborhood: z.string().trim().max(120).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Cidade é obrigatória").max(120),
  state: z.string().trim().length(2, "UF deve ter 2 letras"),
  postal_code: z.string().trim().max(12).optional().or(z.literal("")),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

export const noteSchema = z.object({
  company_id: z.string().uuid(),
  body: z.string().trim().min(1, "Nota não pode ser vazia").max(4000),
});

export const taskSchema = z.object({
  company_id: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(1, "Título é obrigatório").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  due_at: z.string().optional().or(z.literal("")),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const followupSchema = z.object({
  company_id: z.string().uuid(),
  follow_up_at: z.string().min(1, "Data obrigatória"),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const suppressionSchema = z.object({
  company_id: z.string().uuid().optional().or(z.literal("")),
  contact_id: z.string().uuid().optional().or(z.literal("")),
  channel: z.enum(["whatsapp", "email", "phone", "instagram", "linkedin", "all"]).default("all"),
  value: z.string().trim().max(200).optional().or(z.literal("")),
  reason: z.enum([
    "opt_out",
    "nao_quer_contato",
    "numero_invalido",
    "email_invalido",
    "reclamacao",
    "bloqueado",
    "duplicado",
    "juridico",
    "manual",
  ]),
});
