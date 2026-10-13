"use client";

import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Chat | Map switch for screens below 1024px. `bar` = full-width tab bar under the header; otherwise a compact pill that sits in the header (short screens). */
export function ViewTabs({ lang, tab, onTab, bar, className }: { lang: Lang; tab: "chat" | "map"; onTab: (t: "chat" | "map") => void; bar?: boolean; className?: string }) {
  const tr = t(lang);
  return (
    <div
      role="tablist"
      aria-label={tr.viewLabel}
      className={cn(
        bar ? "flex border-b bg-background px-[env(safe-area-inset-left,0px)]" : "flex rounded-full bg-primary-foreground/15 p-0.5 text-sm font-medium dark:bg-muted",
        className,
      )}
    >
      {(["chat", "map"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          id={`tab-${bar ? "bar" : "pill"}-${k}`}
          aria-selected={tab === k}
          aria-controls={`panel-${k}`}
          onClick={() => onTab(k)}
          className={cn(
            "outline-none focus-visible:ring-2 focus-visible:ring-ring",
            bar
              ? cn("min-h-10 flex-1 text-sm font-medium coarse:min-h-11", tab === k ? "border-b-2 border-primary text-foreground" : "text-muted-foreground")
              : cn("min-h-8 rounded-full px-4 coarse:min-h-11 coarse:px-5", tab === k ? "bg-primary-foreground text-primary shadow-sm dark:bg-card dark:text-foreground" : "text-primary-foreground/80 hover:text-primary-foreground dark:text-muted-foreground dark:hover:text-foreground"),
          )}
        >
          {tr[k]}
        </button>
      ))}
    </div>
  );
}
