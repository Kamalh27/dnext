"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers } from "lucide-react";
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
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${tr.basemap}: ${label(value)}`}
        onClick={() => setOpen((o) => !o)}
        className={cn("group relative block h-[68px] w-[88px] overflow-hidden rounded-xl p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring", glass)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
        <img src={THUMB[value]} alt="" className="size-full object-cover transition-transform group-hover:scale-105" />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1 text-[11px] font-medium text-white">
          <span className="flex items-center gap-1"><Layers className="size-3" aria-hidden />{label(value)}</span>
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
        </span>
      </button>

      {open && (
        <div role="radiogroup" aria-label={tr.basemap} className={cn("absolute top-0 left-[96px] z-10 flex gap-2 rounded-2xl p-2", glass)}>
          {(["terrain", "satellite"] as const).map((k) => {
            const sel = value === k;
            return (
              <button
                key={k}
                role="radio"
                aria-checked={sel}
                onClick={() => { onChange(k); setOpen(false); }}
                className={cn("flex w-[84px] flex-col gap-1 rounded-xl p-1 text-center text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring", sel ? "bg-accent" : "hover:bg-accent/60")}
              >
                <span className={cn("relative block h-[56px] overflow-hidden rounded-lg ring-2", sel ? "ring-primary" : "ring-transparent")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG */}
                  <img src={THUMB[k]} alt="" className="size-full object-cover" />
                  {sel && <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" aria-hidden /></span>}
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
