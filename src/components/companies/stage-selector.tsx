"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { changeStageAction } from "@/lib/actions/companies";
import { NativeSelect } from "@/components/shared/native-select";

export function StageSelector({
  companyId,
  currentStageId,
  stages,
}: {
  companyId: string;
  currentStageId: string | null;
  stages: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <NativeSelect
      defaultValue={currentStageId ?? ""}
      disabled={pending}
      className="w-48"
      onChange={(e) => {
        const stageId = e.target.value;
        startTransition(async () => {
          const res = await changeStageAction(companyId, stageId);
          if (res.error) toast.error(res.error);
          else toast.success("Etapa atualizada.");
        });
      }}
    >
      {stages.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </NativeSelect>
  );
}
