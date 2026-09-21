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
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Prospecção",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/companies", label: "Empresas", icon: Building2 },
      { href: "/campaigns", label: "Campanhas", icon: Megaphone },
      { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
      { href: "/discovery", label: "Discovery", icon: Compass },
    ],
  },
  {
    label: "Operação",
    items: [
      { href: "/followups", label: "Follow-ups", icon: CalendarClock },
      { href: "/tasks", label: "Tarefas", icon: ListChecks },
      { href: "/imports", label: "Imports", icon: Upload },
    ],
  },
  {
    label: "Conteúdo",
    items: [
      { href: "/templates", label: "Templates", icon: FileText },
      { href: "/playbooks", label: "Playbooks", icon: BookOpen },
      { href: "/offers", label: "Ofertas", icon: Package },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/suppression", label: "Suppression", icon: ShieldOff },
      { href: "/settings", label: "Configurações", icon: Settings },
    ],
  },
];

/** Flat list, reused by the Topbar to derive the current page's title. */
export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

export function Sidebar({ workspaceName }: { workspaceName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Target className="size-4.5" />
        </span>
        <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
          Prospect Engine
        </p>
      </div>

      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-3.5">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-sidebar-foreground">{workspaceName}</p>
          <p className="truncate text-xs text-muted-foreground">Workspace ativo</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground/70 uppercase">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
