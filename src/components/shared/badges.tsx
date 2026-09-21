import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const OPPORTUNITY_STYLES: Record<string, string> = {
  MUITO_ALTO: "bg-emerald-600 text-white hover:bg-emerald-600",
  ALTO: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  MEDIO: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  BAIXO: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100",
};

const OPPORTUNITY_LABELS: Record<string, string> = {
  MUITO_ALTO: "Muito Alto",
  ALTO: "Alto",
  MEDIO: "Médio",
  BAIXO: "Baixo",
};

export function OpportunityBadge({ level }: { level: string | null }) {
  if (!level) return <Badge variant="outline">Não calculado</Badge>;
  return (
    <Badge className={cn("border-0", OPPORTUNITY_STYLES[level])}>
      {OPPORTUNITY_LABELS[level] ?? level}
    </Badge>
  );
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const value = score ?? 0;
  const color =
    value >= 80
      ? "bg-emerald-600 text-white"
      : value >= 60
      ? "bg-emerald-100 text-emerald-800"
      : value >= 40
      ? "bg-amber-100 text-amber-800"
      : "bg-zinc-100 text-zinc-600";
  return <Badge className={cn("border-0 font-mono", color)}>{value}</Badge>;
}

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "Alta confiança",
  MEDIUM: "Confiança média",
  LOW: "Baixa confiança",
  UNKNOWN: "Não verificado",
};

export function ConfidenceBadge({ confidence }: { confidence: string | null | undefined }) {
  const value = confidence ?? "UNKNOWN";
  const style =
    value === "HIGH"
      ? "border-emerald-300 text-emerald-700"
      : value === "MEDIUM"
      ? "border-amber-300 text-amber-700"
      : value === "LOW"
      ? "border-zinc-300 text-zinc-600"
      : "border-dashed text-muted-foreground";
  return (
    <Badge variant="outline" className={style}>
      {CONFIDENCE_LABELS[value] ?? value}
    </Badge>
  );
}

export function StageBadge({ label, color }: { label: string; color?: string | null }) {
  return (
    <Badge
      variant="outline"
      style={color ? { borderColor: color, color } : undefined}
    >
      {label}
    </Badge>
  );
}

export function TemperatureBadge({ temperature }: { temperature: string }) {
  const map: Record<string, string> = {
    HOT: "bg-red-100 text-red-700",
    WARM: "bg-orange-100 text-orange-700",
    COLD: "bg-sky-100 text-sky-700",
  };
  const labels: Record<string, string> = { HOT: "Quente", WARM: "Morno", COLD: "Frio" };
  return <Badge className={cn("border-0", map[temperature])}>{labels[temperature] ?? temperature}</Badge>;
}
