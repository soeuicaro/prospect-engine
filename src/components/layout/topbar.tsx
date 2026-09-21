"use client";

import { useTransition } from "react";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/(auth)/actions";
import { NAV_ITEMS } from "./sidebar";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function Topbar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();

  const currentPage = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-6 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <p className="truncate text-sm font-semibold tracking-tight text-foreground">
        {currentPage?.label ?? "Prospect Engine"}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 pr-3 pl-2">
            <Avatar size="sm">
              <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                {initials(userName)}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-40 truncate">{userName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {userEmail}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pending}
            onClick={() => startTransition(() => signOutAction())}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
