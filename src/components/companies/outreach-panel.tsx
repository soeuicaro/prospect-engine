"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/shared/native-select";
import { Badge } from "@/components/ui/badge";
import { renderTemplate, type TemplateVariables } from "@/lib/domain/templates";
import { buildWhatsAppLink, buildMailtoLink } from "@/lib/domain/phone";
import { recordOutreachAction } from "@/lib/actions/outreach";
import type { MessageChannel } from "@/types/database";

interface TemplateOption {
  id: string;
  name: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
}

export function OutreachPanel({
  companyId,
  templates,
  variables,
  phone,
  whatsapp,
  email,
}: {
  companyId: string;
  templates: TemplateOption[];
  variables: TemplateVariables;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [edited, setEdited] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const template = templates.find((t) => t.id === templateId) ?? null;

  const rendered = useMemo(() => {
    if (!template) return { text: "", missingVariables: [] };
    return renderTemplate(template.body, variables);
  }, [template, variables]);

  const text = edited ?? rendered.text;
  const contactNumber = whatsapp || phone;

  function markSent(channel: MessageChannel | "manual") {
    startTransition(async () => {
      const res = await recordOutreachAction({
        companyId,
        channel,
        templateId: template?.id ?? null,
        messagePreview: text,
      });
      if (res.error) toast.error(res.error);
      else toast.success("Envio registrado. Follow-up agendado para daqui a 3 dias.");
    });
  }

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum template disponível para este nicho ainda.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <NativeSelect
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setEdited(null);
          }}
          className="w-64"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.channel})
            </option>
          ))}
        </NativeSelect>
        {rendered.missingVariables.length > 0 && (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            Variáveis sem evidência: {rendered.missingVariables.join(", ")}
          </Badge>
        )}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setEdited(e.target.value)}
        rows={6}
        className="font-mono text-sm"
      />

      <div className="flex flex-wrap gap-2">
        {contactNumber && (
          <Button asChild size="sm" disabled={pending}>
            <a
              href={buildWhatsAppLink(contactNumber, text)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => markSent("whatsapp")}
            >
              Abrir WhatsApp
            </a>
          </Button>
        )}
        {email && (
          <Button asChild size="sm" variant="outline" disabled={pending}>
            <a href={buildMailtoLink(email, template?.subject ?? undefined, text)} onClick={() => markSent("email")}>
              Abrir cliente de e-mail
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast.success("Mensagem copiada.");
          }}
        >
          Copiar mensagem
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => markSent("manual")}>
          Marcar como enviado (manual)
        </Button>
      </div>
      {!contactNumber && !email && (
        <p className="text-xs text-muted-foreground">
          Nenhum canal de contato disponível — adicione telefone, WhatsApp ou e-mail para habilitar o envio assistido.
        </p>
      )}
    </div>
  );
}
