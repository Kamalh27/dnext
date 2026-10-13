import { cn } from "@/lib/utils";

/** DNext mark: a ridge with debris sliding off the slope, on a brand tile. Colours come from CSS tokens, so it adapts to light/dark. */
export function LogoMark({ className, inverted }: { className?: string; inverted?: boolean }) {
  // On the brand-coloured (light) header the mark inverts; on the dark header it returns to the normal brand tile.
  const tile = inverted ? "fill-primary-foreground dark:fill-brand" : "fill-brand";
  const ink = inverted ? "fill-primary dark:fill-brand-fg" : "fill-brand-fg";
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="DNext" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className={tile} />
      <path d="M4 25.5 12 11.5l5 7.5 4-5.5 7 12Z" className={ink} />
      <circle cx="24.6" cy="9.4" r="2.1" className={ink} opacity=".85" />
      <circle cx="26.4" cy="17.6" r="1.25" className={ink} />
      <circle cx="28.2" cy="20.9" r="1" className={ink} opacity=".8" />
      <circle cx="29.4" cy="23.6" r=".75" className={ink} opacity=".65" />
    </svg>
  );
}

/** Two-line title sized to the 32px logo tile: 20px title line + 12px subtitle line, so the pair aligns top and bottom with the mark. */
export function Wordmark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex flex-col justify-center", className)}>
      <span className="text-[19px] leading-[20px] font-semibold tracking-tight">
        D<span className="font-normal">Next</span>
      </span>
      <span className={cn("hidden text-[11px] leading-[12px] font-medium tracking-[0.04em] sm:block", inverted ? "text-primary-foreground/80 dark:text-muted-foreground" : "text-muted-foreground")}>
        LandslideWatch TH
      </span>
    </span>
  );
}
