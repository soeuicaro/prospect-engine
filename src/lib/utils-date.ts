/** Minimal relative-time formatter (pt-BR), no external date library needed. */
export function formatDistanceToNow(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (Math.abs(diffMin) < 1) return "agora";
  if (Math.abs(diffMin) < 60) return relative(diffMin, "minuto");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return relative(diffHour, "hora");
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 30) return relative(diffDay, "dia");
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return relative(diffMonth, "mês", "meses");
  const diffYear = Math.round(diffMonth / 12);
  return relative(diffYear, "ano");
}

function relative(value: number, unit: string, pluralUnit?: string): string {
  const abs = Math.abs(value);
  const label = abs === 1 ? unit : pluralUnit ?? `${unit}s`;
  return value >= 0 ? `há ${abs} ${label}` : `em ${abs} ${label}`;
}

export function formatDateBR(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function formatDateTimeBR(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}
