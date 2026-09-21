"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validations/workspace";

export interface AuthFormState {
  error?: string;
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "E-mail ou senha incorretos." };
  }

  redirect("/dashboard");
}

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name } },
  });

  if (error) {
    const message =
      error.code === "user_already_exists" || error.message === "User already registered"
        ? "E-mail já cadastrado."
        : error.code === "email_address_invalid"
          ? "Endereço de e-mail inválido."
          : error.code === "weak_password"
            ? "Senha muito fraca — use ao menos 6 caracteres, com letras e números."
            : error.code === "over_email_send_rate_limit"
              ? "Muitas tentativas em pouco tempo — aguarde um instante e tente de novo."
              : // Surface the real Supabase message for anything else (misconfigured
                // project, signups disabled, etc.) instead of a generic dead end.
                error.message || "Não foi possível criar a conta.";
    return { error: message };
  }

  redirect("/onboarding");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
