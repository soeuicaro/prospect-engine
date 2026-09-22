"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validations/workspace";

export interface AuthFormState {
  error?: string;
  /** Non-error feedback (e.g. "check your email") — rendered without the destructive style. */
  notice?: string;
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
    // Supabase returns this specific code when the account exists and the
    // password is right but the e-mail was never confirmed — collapsing it
    // into "wrong e-mail or password" sent users on a pointless password
    // reset hunt instead of telling them to check their inbox.
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada (e o spam) e clique no link de confirmação antes de entrar.",
      };
    }
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
  const { data, error } = await supabase.auth.signUp({
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

  // When this Supabase project requires e-mail confirmation (the default,
  // and the case here), signUp() succeeds but returns no session — the
  // account can't do anything until the confirmation link is clicked. This
  // used to redirect straight to /onboarding regardless, which — with no
  // session — just bounced silently back to /login (via requireUser()) with
  // no explanation at all, looking exactly like a broken login. Also covers
  // re-signing up with an already-registered-but-unconfirmed e-mail:
  // Supabase intentionally returns a fake success (no session, empty
  // identities) there instead of an error, to avoid leaking which e-mails
  // are registered.
  if (!data.session) {
    return {
      notice:
        "Quase lá! Enviamos um e-mail de confirmação — clique no link para ativar sua conta e continuar o cadastro.",
    };
  }

  redirect("/onboarding");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
