"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validations/workspace";

export interface AuthFormState {
  error?: string;
  /** Non-error feedback (e.g. "check your email") — rendered without the destructive style. */
  notice?: string;
}

const AUTH_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MESSAGE =
  "A conexão com o servidor demorou demais para responder. Verifique sua internet e tente novamente.";

class AuthTimeoutError extends Error {}

/**
 * supabase-js's auth methods don't accept an AbortSignal — if the network to
 * the Supabase Auth server stalls, the call just hangs, and with it the
 * form's "Entrando..."/"Criando..." state, with no error and no way out for
 * the user. Races the call against a hard timeout so the action always
 * settles and the form can show something actionable instead of freezing.
 */
function withTimeout<T>(promise: Promise<T>, ms = AUTH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

  let error;
  try {
    ({ error } = await withTimeout(supabase.auth.signInWithPassword(parsed.data)));
  } catch (err) {
    if (err instanceof AuthTimeoutError) return { error: AUTH_TIMEOUT_MESSAGE };
    throw err;
  }

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
    const message =
      error.code === "invalid_credentials"
        ? "E-mail ou senha incorretos."
        : error.code === "user_banned"
          ? "Esta conta foi suspensa. Entre em contato com o suporte."
          : error.code === "over_request_rate_limit"
            ? "Muitas tentativas em pouco tempo — aguarde um instante e tente de novo."
            : // Same gap this closed in signUpAction (a91ae74): anything else
              // (provider disabled, project misconfigured, unexpected_failure,
              // etc.) used to collapse into "E-mail ou senha incorretos.",
              // which sent users chasing a password reset for a problem that
              // had nothing to do with their password.
              error.message || "Não foi possível entrar.";
    return { error: message };
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

  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: { data: { full_name: parsed.data.full_name } },
      })
    ));
  } catch (err) {
    if (err instanceof AuthTimeoutError) return { error: AUTH_TIMEOUT_MESSAGE };
    throw err;
  }

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
  try {
    await withTimeout(supabase.auth.signOut());
  } catch (err) {
    if (!(err instanceof AuthTimeoutError)) throw err;
    // Timed out talking to Supabase — the local session cookie may still be
    // cleared client-side on next load either way; redirecting to /login is
    // still the right outcome instead of hanging on "saindo...".
  }
  redirect("/login");
}
