"use client";

import { toast } from "sonner";
import {
  Briefcase,
  Camera,
  Clapperboard,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Music2,
  Navigation,
  Phone,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildGoogleMapsLinks } from "@/lib/domain/maps";
import { displayPhone, mailtoLink, socialLink, telLink, websiteLink, whatsappLink } from "@/lib/domain/contact-links";
import type { SocialMap } from "@/lib/discovery/types";
import { cn } from "@/lib/utils";

export interface ContactTarget {
  name: string | null;
  legalName?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lon?: number | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  socials?: SocialMap | null;
}

interface Action {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  external?: boolean;
}

/** Only actions backed by valid data are returned (§6: show a button only when it works). */
export function contactActionsFor(t: ContactTarget): Action[] {
  const maps = buildGoogleMapsLinks({
    trade_name: t.name,
    legal_name: t.legalName,
    street: t.street,
    street_number: t.houseNumber,
    neighborhood: t.neighborhood,
    city: t.city,
    state: t.state,
    latitude: t.lat,
    longitude: t.lon,
  });
  const actions: Action[] = [{ key: "maps", label: "Abrir no Google Maps", icon: MapPin, href: maps.searchUrl, external: true }];
  if (maps.pinUrl && maps.strategy !== "coordinates") {
    actions.push({ key: "pin", label: "Ver localização (coordenadas)", icon: Navigation, href: maps.pinUrl, external: true });
  }
  const site = websiteLink(t.website);
  if (site) actions.push({ key: "website", label: "Abrir website", icon: Globe, href: site, external: true });
  const wa = whatsappLink({ whatsapp: t.whatsapp, phone: t.phone });
  if (wa) {
    actions.push({
      key: "whatsapp",
      label: wa.source === "whatsapp" ? "Abrir WhatsApp" : "Abrir WhatsApp (celular do cadastro)",
      icon: MessageCircle,
      href: wa.url,
      external: true,
    });
  }
  const tel = telLink(t.phone ?? t.whatsapp);
  if (tel) {
    const shown = displayPhone(t.phone ?? t.whatsapp) ?? "";
    actions.push({
      key: "call",
      label: `Ligar / copiar ${shown}`,
      icon: Phone,
      onClick: () => {
        // §108: tel: on touch devices, copy on desktop.
        const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
        if (coarse) {
          window.location.href = tel;
          return;
        }
        navigator.clipboard
          ?.writeText(shown)
          .then(() => toast.success(`Telefone copiado: ${shown}`))
          .catch(() => toast.message(shown));
      },
    });
  }
  const mail = mailtoLink(t.email);
  if (mail) actions.push({ key: "email", label: `Enviar e-mail (${t.email})`, icon: Mail, href: mail });
  const socials: [keyof SocialMap, string, LucideIcon][] = [
    ["instagram", "Abrir Instagram", Camera],
    ["facebook", "Abrir Facebook", ThumbsUp],
    ["tiktok", "Abrir TikTok", Music2],
    ["linkedin", "Abrir LinkedIn", Briefcase],
    ["youtube", "Abrir YouTube", Clapperboard],
  ];
  for (const [net, label, icon] of socials) {
    const url = socialLink(net, t.socials?.[net]);
    if (url) actions.push({ key: net, label, icon, href: url, external: true });
  }
  return actions;
}

export function ContactActions({
  target,
  compact = false,
  className,
}: {
  target: ContactTarget;
  compact?: boolean;
  className?: string;
}) {
  const actions = contactActionsFor(target);
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} onClick={(e) => e.stopPropagation()}>
      {actions.map((a) => {
        const Icon = a.icon;
        const content = compact ? (
          <Icon className="size-3.5" />
        ) : (
          <>
            <Icon className="size-3.5" />
            <span>{a.key === "maps" ? "Maps" : a.label.replace(/^Abrir /, "").replace(/ \(.*\)$/, "")}</span>
          </>
        );
        const button = a.href ? (
          <Button asChild variant="outline" size={compact ? "icon-xs" : "xs"} aria-label={a.label}>
            <a href={a.href} target={a.external ? "_blank" : undefined} rel={a.external ? "noopener noreferrer" : undefined}>
              {content}
            </a>
          </Button>
        ) : (
          <Button type="button" variant="outline" size={compact ? "icon-xs" : "xs"} aria-label={a.label} onClick={a.onClick}>
            {content}
          </Button>
        );
        return (
          <Tooltip key={a.key}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{a.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
