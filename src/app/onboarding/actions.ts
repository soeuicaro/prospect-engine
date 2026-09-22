"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/workspace";
import { workspaceCreateSchema } from "@/lib/validations/workspace";

export interface OnboardingState {
  error?: string;
}

export async function createWorkspaceAction(
  _prevState: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const parsed = workspaceCreateSchema.safeParse({
    name: formData.get("name"),
    city: formData.get("city"),
    state: formData.get("state"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const user = await getOwnerUser();
  if (!user) {
    return {
      error:
        "Não encontrei sua conta (profiles) ou não consegui falar com o Supabase. Confira as variáveis de ambiente (ENVIRONMENT.md) e tente de novo.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_city: parsed.data.city || null,
    p_state: parsed.data.state ? parsed.data.state.toUpperCase() : null,
    p_owner_id: user.id,
  });

  if (error || !data) {
    return { error: "Não foi possível criar o workspace. Tente novamente." };
  }

  redirect("/dashboard");
}
