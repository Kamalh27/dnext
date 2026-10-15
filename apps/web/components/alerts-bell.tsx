"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAlerts } from "@/lib/alerts-hooks";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** The notification bell in the header: unread count, a list of alerts, "mark all as read". Only for a signed-in account. */
export function AlertsBell({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const a = useAlerts();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!a.enabled) return null;
  const when = (iso: string) => new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" data-testid="alerts-bell" aria-label={a.unread ? `${tr.alertsTitle} (${a.unread})` : tr.alertsTitle} title={tr.alertsTitle} aria-expanded={open}
        className="relative text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
        onClick={() => setOpen((o) => !o)}>
        <Bell />
        {a.unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">{a.unread}</span>}
      </Button>
      {open && (
        <div role="dialog" aria-label={tr.alertsTitle} data-testid="alerts-panel"
          className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <p className="text-sm font-semibold">{tr.alertsTitle}</p>
            {a.unread > 0 && <button type="button" onClick={() => void a.markRead()} className="text-xs underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">{tr.alertsMarkRead}</button>}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {a.items.length === 0 && <li className="px-3 py-5 text-center text-sm text-muted-foreground">{tr.alertsEmpty}</li>}
            {a.items.map((i) => (
              <li key={i.id} className="border-b px-3 py-2.5 last:border-b-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">{!i.read && <span className="size-2 shrink-0 rounded-full bg-destructive" aria-label={tr.alertsUnread} />}{i.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{when(i.created)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
