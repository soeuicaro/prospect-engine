"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Megaphone,
  KanbanSquare,
  CalendarClock,
  ListChecks,
  Compass,
  Upload,
  FileText,
  BookOpen,
  Package,
  ShieldOff,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/companies", label: "Empresas", icon: Building2 },
  { href: "/campaigns", label: "Campanhas", icon: Megaphone },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/followups", label: "Follow-ups", icon: CalendarClock },
  { href: "/tasks", label: "Tarefas", icon: ListChecks },
  { href: "/discovery", label: "Discovery", icon: Compass },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/offers", label: "Ofertas", icon: Package },
  { href: "/suppression", label: "Suppression", icon: ShieldOff },
  { href: "/settings", label: "Configurações", icon: Settings },
];

export function Sidebar({ workspaceName }: { workspaceName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 md:flex">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <span className="text-lg font-semibold tracking-tight">Prospect Engine</span>
      </div>
      <div className="border-b px-6 py-3">
        <p className="truncate text-sm font-medium">{workspaceName}</p>
        <p className="text-xs text-muted-foreground">De empresas locais a oportunidades</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
