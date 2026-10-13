"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Accessible modal on the native <dialog>: focus trap, Esc to close and inert background come from the browser. */
export function Modal({
  open, onClose, title, closeLabel, children, className,
}: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}   // click on the backdrop
      className={cn(
        // Phones (< 640px): a bottom sheet with rounded top corners, up to the full screen height. Larger screens: a centred dialog.
        "m-auto w-[min(94vw,44rem)] max-h-[90dvh] overflow-hidden rounded-xl border bg-card p-0 text-card-foreground shadow-2xl short:max-h-[calc(100dvh-1rem)]",
        "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:m-0 max-sm:max-h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
        "backdrop:bg-black/55 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pr-[max(1.25rem,env(safe-area-inset-right,0px))] pl-[max(1.25rem,env(safe-area-inset-left,0px))] sm:pt-2">
            <h2 id={titleId} className="min-w-0 text-base font-semibold break-words">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]">{children}</div>
        </div>
      )}
    </dialog>
  );
}
