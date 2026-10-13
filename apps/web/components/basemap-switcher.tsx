"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Layers } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BaseMap = "terrain" | "satellite";
const THUMB: Record<BaseMap, string> = { terrain: "/basemap-terrain.svg", satellite: "/basemap-satellite.svg" };
const glass = "border bg-card/90 shadow-lg backdrop-blur-md";

/** Shows the selected base map as an image tile; click to choose another (image cards, radio semantics). */
export function BasemapSwitcher({ lang, value, onChange }: { lang: Lang; value: BaseMap; onChange: (v: BaseMap) => void }) {
  const tr = t(lang);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const label = (k: BaseMap) => tr[k];

  return (
    <div ref={root} className="relative" data-map-overlay="basemap">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${tr.basemap}: ${label(value)}`}
        onClick={() => setOpen((o) => !o)}
        className={cn("group relative block size-14 overflow-hidden rounded-[4px] p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring", glass)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
        <img src={THUMB[value]} alt="" className="size-full object-cover transition-transform group-hover:scale-105" />
        <span className="absolute top-1 left-1 grid size-4 place-items-center rounded-[3px] bg-black/45 text-white"><Layers className="size-2.5" aria-hidden /></span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pt-3 pb-0.5 text-center text-xs font-medium text-white">
          {label(value)}
        </span>
      </button>

      {open && (
        <div data-map-overlay="basemap-chooser" role="radiogroup" aria-label={tr.basemap} className={cn("absolute bottom-0 left-[62px] z-10 flex gap-1.5 rounded-[4px] p-1.5", glass)}>
          {(["terrain", "satellite"] as const).map((k) => {
            const sel = value === k;
            return (
              <button
                key={k}
                role="radio"
                aria-checked={sel}
                onClick={() => { onChange(k); setOpen(false); }}
                className={cn("flex w-16 flex-col gap-0.5 rounded-[4px] p-1 text-center text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring", sel ? "bg-accent" : "hover:bg-accent/60")}
              >
                <span className={cn("relative block h-10 overflow-hidden rounded-[3px] ring-2", sel ? "ring-primary" : "ring-transparent")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
                  <img src={THUMB[k]} alt="" className="size-full object-cover" />
                  {sel && <span className="absolute top-1 right-1 grid size-3.5 place-items-center rounded-[3px] bg-primary text-primary-foreground"><Check className="size-2.5" aria-hidden /></span>}
                </span>
                <span className={cn("font-medium", sel && "text-primary")}>{label(k)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
