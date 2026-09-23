"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Choice {
  value: string;
  label: string;
}

// Radix Select reserves "" for "no value"; map it to a sentinel.
const EMPTY = "__empty__";

/**
 * Styled dropdown (Radix Select) for client-state controls. Unlike
 * NativeSelect, the opened list follows the design system (theme, dark
 * mode, check mark). Not for GET-submitted forms — use NativeSelect there.
 */
export function ChoiceSelect({
  value,
  onValueChange,
  options,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Choice[];
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value === "" ? EMPTY : value} onValueChange={(v) => onValueChange(v === EMPTY ? "" : v)}>
      <SelectTrigger className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {options.map((o) => (
          <SelectItem key={o.value || EMPTY} value={o.value === "" ? EMPTY : o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
