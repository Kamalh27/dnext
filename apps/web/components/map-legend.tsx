"use client";

import { useId } from "react";
import { Collapse, PanelToggle } from "./panel-toggle";
import { t } from "@/lib/i18n";
import { usePersistedOpen } from "@/lib/panel-state";
import type { Lang } from "@/lib/types";
import { MQ, useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

/**
 * Bottom-left legend card (overview and scenario layers). Title row with a collapse chevron; collapsed = a compact chip with just the title.
 * Expanded by default on desktop/tablet, collapsed on phones and short screens; the choice is remembered. Two columns on short screens.
 */
export function MapLegend({ lang, title, items, overview }: { lang: Lang; title: string; items: { label: string; color: string }[]; overview?: boolean }) {
  const tr = t(lang);
  const bodyId = useId();
  const compact = useMedia(MQ.compactMap);
  const [open, setOpen] = usePersistedOpen("panel-legend", !compact);
  return (
    <div
      data-map-overlay="legend"
      data-testid="legend-card"
      data-legend={overview ? "overview" : undefined}
      data-open={open}
      className={cn("rounded-[4px] border bg-card/90 text-xs shadow-lg backdrop-blur-md short:order-last", open ? "w-60 short:w-80" : "w-fit max-w-60")}
    >
      <div className="flex items-center gap-1 pl-3">
        <p className="min-w-0 flex-1 truncate py-2 text-[13px] leading-snug font-semibold" title={title}>{title}</p>
        <PanelToggle kind="legend" open={open} onToggle={() => setOpen(!open)} controls={bodyId} label={open ? tr.panelCollapse : tr.panelExpand} />
      </div>
      <Collapse open={open} id={bodyId}>
        {items.length > 0 && (
          <ul aria-label={tr.legend} className={cn("grid gap-1 px-3 pb-3", compact && "grid-cols-2")}>
            {items.map((l) => (
              <li key={l.label} className="flex min-w-0 items-center gap-2">
                <span className="size-3 shrink-0 rounded-[2px] border border-black/20" style={{ background: l.color }} aria-hidden />
                <span className="min-w-0 break-words">{l.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Collapse>
    </div>
  );
}
