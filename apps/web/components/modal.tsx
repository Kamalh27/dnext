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
        "m-auto w-[min(94vw,44rem)] max-h-[90dvh] overflow-hidden rounded-xl border bg-card p-0 text-card-foreground shadow-2xl",
        "backdrop:bg-black/55 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
