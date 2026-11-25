import { cn } from "@/lib/utils";

/** Wordmark: a clock face whose hand points at "the right moment". */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" className="size-6 text-brand" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <path d="M12 12 L16.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </svg>
      {withText && <span>Kairos</span>}
    </span>
  );
}
