"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_W = 280;
const MARGIN = 8;

/**
 * Info icon with a small tooltip-style popover. Hover (mouse) and keyboard focus show it, click/tap toggles it (touch has no hover),
 * Esc and an outside press close it. The popover is portalled to <body> (fixed, 4px corners, glass style, max 280px) and flips above/below
 * so it never leaves the viewport.
 */
export function InfoPopover({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);   // Esc closes even while the pointer rests on the icon
  const open = (hover || focus || pinned) && !dismissed;

  const place = (el: HTMLDivElement | null) => {
    const b = btn.current?.getBoundingClientRect();
    if (!el || !b) return;
    const vw = document.documentElement.clientWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const w = Math.min(MAX_W, vw - 2 * MARGIN);
    el.style.width = `${w}px`;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(b.left + b.width / 2 - w / 2, MARGIN), vw - MARGIN - w);
    const below = b.bottom + 6;
    const above = b.top - 6 - h;
    const top = below + h <= vh - MARGIN ? below : above >= MARGIN ? above : Math.min(Math.max(below, MARGIN), vh - MARGIN - h);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  };

  useEffect(() => {
    if (!open) return;
    const again = () => place(pop.current);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setDismissed(true); setPinned(false); setFocus(false); } };
    const away = (e: PointerEvent) => { if (!btn.current?.contains(e.target as Node)) setPinned(false); };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    document.addEventListener("keydown", esc);
    document.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
      document.removeEventListener("keydown", esc);
      document.removeEventListener("pointerdown", away);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-info-btn
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => { setDismissed(false); setPinned((p) => !p); }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") { clearTimeout(timer.current); timer.current = setTimeout(() => setHover(true), 120); } }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") { clearTimeout(timer.current); setHover(false); setDismissed(false); } }}
        onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) { setDismissed(false); setFocus(true); } }}
        onBlur={() => { setFocus(false); setDismissed(false); }}
        className={cn("grid size-8 shrink-0 place-items-center rounded-[4px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:size-11", open && "bg-accent text-foreground", className)}
      >
        <Info className="size-4" aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={(el) => { pop.current = el; place(el); }}
          id={id}
          role="tooltip"
          style={{ visibility: "hidden", width: MAX_W }}
          className="pointer-events-none fixed z-[70] space-y-1.5 rounded-[4px] border bg-card/95 p-3 text-xs leading-snug text-card-foreground shadow-lg backdrop-blur-md"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
