import { z } from "zod";

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(120),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().length(2, "UF deve ter 2 letras").optional().or(z.literal("")),
});

export const scoringWeightsSchema = z.record(
  z.string(),
  z.coerce.number().min(0).max(1)
);

export const signInSchema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
});

export const signUpSchema = signInSchema.extend({
  full_name: z.string().trim().min(1, "Nome é obrigatório").max(120),
});
