import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes } from "react";

/**
 * Plain native <select>. Used inside GET-submitted filter forms where a
 * Radix-based Select (no native `name`/form participation) would silently
 * fail to submit its value.
 */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "border-input flex h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  );
}
