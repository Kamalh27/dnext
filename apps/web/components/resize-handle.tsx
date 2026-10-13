"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

import { CHAT_MIN_W as MIN_W, CHAT_W_KEY as KEY } from "@/lib/layout";

export { MIN_W };
const MAX_W = 760;
const MAX_FRACTION = 0.7;   // never take more than 70% of the row, so the map stays usable
const STEP = 24;

export const clampWidth = (w: number, rowWidth: number) => Math.round(Math.min(Math.max(w, MIN_W), Math.min(MAX_W, rowWidth * MAX_FRACTION)));

/** Sets the chat width (px) as a CSS variable on <html> and persists it; null resets to the default. */
export function setChatWidth(w: number | null, persist = true) {
  const root = document.documentElement.style;
  if (w == null) root.removeProperty("--chat-w");
  else root.setProperty("--chat-w", `${w}px`);
  if (!persist) return;
  try {
    if (w == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(w));
  } catch { /* storage blocked */ }
}

/**
 * Vertical drag handle on the chat/map boundary (desktop only). Pointer-capture drag, arrow keys (Shift = bigger step),
 * double-click or Enter to reset. `row` is the flex/grid container whose left edge is the chat panel's left edge.
 */
export function ResizeHandle({ row, label }: { row: RefObject<HTMLElement | null>; label: string }) {
  const onChange = setChatWidth;
  const [drag, setDrag] = useState(false);
  const last = useRef(MIN_W);
  const [measured, setMeasured] = useState(0);
  // The real chat width, whether it is the CSS default or a stored px value.
  const base = () => row.current?.firstElementChild?.getBoundingClientRect().width ?? MIN_W;

  const widthAt = (clientX: number) => {
    const r = row.current?.getBoundingClientRect();
    return r ? clampWidth(clientX - r.left, r.width) : MIN_W;
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = base();
    setDrag(true);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    last.current = widthAt(e.clientX);
    onChange(last.current, false);
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(false);
    onChange(last.current, true);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = row.current?.getBoundingClientRect();
    if (!r) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    if (e.key === "ArrowLeft") onChange(clampWidth(base() - step, r.width));
    else if (e.key === "ArrowRight") onChange(clampWidth(base() + step, r.width));
    else if (e.key === "Home") onChange(MIN_W);
    else if (e.key === "End") onChange(clampWidth(Infinity, r.width));
    else if (e.key === "Enter") onChange(null);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={measured}
      aria-valuemin={MIN_W}
      aria-valuemax={MAX_W}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onFocus={() => setMeasured(Math.round(base()))}
      onDoubleClick={() => onChange(null)}
      title={label}
      style={{ left: "var(--chat-col)" }}
      className={cn(
        "group absolute inset-y-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none lg:block",
      )}
    >
      <span className={cn("absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary", drag && "w-0.5 bg-primary")} />
      <span className={cn("absolute top-1/2 left-1/2 grid h-8 w-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[4px] border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", drag && "opacity-100")}>
        <GripVertical className="size-3" aria-hidden />
      </span>
    </div>
  );
}
