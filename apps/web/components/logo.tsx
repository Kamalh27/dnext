import { cn } from "@/lib/utils";

/** DNext mark: a ridge with debris sliding off the slope, on a brand tile. Colours come from CSS tokens, so it adapts to light/dark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="DNext" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path d="M4 25.5 12 11.5l5 7.5 4-5.5 7 12Z" className="fill-brand-fg" />
      <circle cx="24.6" cy="9.4" r="2.1" className="fill-brand-fg" opacity=".85" />
      <circle cx="26.4" cy="17.6" r="1.25" className="fill-brand-fg" />
      <circle cx="28.2" cy="20.9" r="1" className="fill-brand-fg" opacity=".8" />
      <circle cx="29.4" cy="23.6" r=".75" className="fill-brand-fg" opacity=".65" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-col leading-none", className)}>
      <span className="text-[18px] font-semibold tracking-tight">
        D<span className="font-normal">Next</span>
      </span>
      <span className="mt-1 hidden text-[11px] tracking-wide text-muted-foreground sm:block">LandslideWatch TH</span>
    </span>
  );
}
