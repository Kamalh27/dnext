"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chevron button that collapses/expands a map overlay panel (44px target on touch). */
export function PanelToggle({ kind, open, onToggle, controls, label, className }: {
  kind: string; open: boolean; onToggle: () => void; controls: string; label: string; className?: string;
}) {
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      data-panel-toggle={kind}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn("grid size-8 shrink-0 place-items-center rounded-[4px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:size-11", className)}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/** Height-animated region (grid-rows 0fr/1fr); closed content is inert and invisible. Respects prefers-reduced-motion. */
export function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return (
    <div
      id={id}
      className={cn(
        "grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "invisible grid-rows-[0fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden" inert={!open}>{children}</div>
    </div>
  );
}
