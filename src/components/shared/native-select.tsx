import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

/**
 * Plain native <select>. Used inside GET-submitted filter forms where a
 * Radix-based Select (no native `name`/form participation) would silently
 * fail to submit its value.
 *
 * Styled to match `Input`/the Radix `Select` trigger (same height, radius,
 * border and focus ring) with `appearance-none` + an overlaid chevron
 * replacing the browser's own arrow, so the closed control looks like the
 * rest of the design system instead of bare OS chrome. The opened *list* is
 * still rendered natively by the OS/browser — that part can't be restyled
 * without dropping native form submission, which is the reason this
 * component exists.
 *
 * `className` sizes the wrapper (e.g. `w-48`, `col-span-1`), not the
 * `<select>` itself, since the chevron needs a positioning container.
 */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative inline-block", className)}>
      <select
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 dark:disabled:bg-input/80"
        {...props}
      />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
