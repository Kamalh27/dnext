"use client";

import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { MQ, useMedia } from "@/lib/use-media";
import { usePersistedOpen } from "@/lib/panel-state";
import { cn } from "@/lib/utils";

/**
 * Accordion section of the overview dashboard. The open flag is remembered in localStorage per section; until the user chooses,
 * `desktopOpen` applies on desktop (>= 1024 px) and `phoneOpen` below that. Closed content is not rendered.
 */
export function DashSection({ k, title, desktopOpen, phoneOpen, testId, children }: {
  k: string; title: string; desktopOpen: boolean; phoneOpen: boolean; testId?: string; children: ReactNode;
}) {
  const id = useId();
  const desktop = useMedia(MQ.desktop);
  const [open, setOpen] = usePersistedOpen(`dash-${k}`, desktop ? desktopOpen : phoneOpen);
  return (
    <section data-testid={testId} data-section={k} className="border-t">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen(!open)}
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-[4px] py-1.5 text-left text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"
        >
          <span className="min-w-0">{title}</span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </h3>
      {open && <div id={`${id}-body`} role="region" aria-label={title} className="space-y-3 pb-3">{children}</div>}
    </section>
  );
}
