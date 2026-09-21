"use client";

import { useTransition } from "react";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { archiveCompanyAction, softDeleteCompanyAction } from "@/lib/actions/companies";

export function ArchiveDeleteMenu({ companyId }: { companyId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" disabled={pending}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            startTransition(async () => {
              const res = await archiveCompanyAction(companyId);
              if (res?.error) toast.error(res.error);
            })
          }
        >
          Arquivar empresa
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => {
            if (!confirm("Excluir esta empresa? Esta ação pode ser revertida apenas por um administrador.")) return;
            startTransition(async () => {
              const res = await softDeleteCompanyAction(companyId);
              if (res?.error) toast.error(res.error);
            });
          }}
        >
          Excluir empresa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
