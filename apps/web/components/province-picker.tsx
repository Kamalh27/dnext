"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, MapPin, Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { filterProvinces } from "@/lib/province-search";
import type { Lang, Province } from "@/lib/types";
import { cn } from "@/lib/utils";

const nameOf = (p: Province, lang: Lang) => (lang === "th" ? p.name_th || p.name : p.name);

/** A searchable province list in place of the browser's own select: type to filter (English or Thai), arrow keys and Enter to choose, Esc to close. */
export function ProvincePicker({ lang, provinces, selected, onSelect }: { lang: Lang; provinces: Province[]; selected: Province | null; onSelect: (pcode: string | null) => void }) {
  const tr = t(lang);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const sorted = useMemo(() => {
    const c = new Intl.Collator(lang === "th" ? "th" : "en");
    return [...provinces].sort((a, b) => c.compare(nameOf(a, lang), nameOf(b, lang)));
  }, [provinces, lang]);
  const found = useMemo(() => filterProvinces(sorted, query, lang), [sorted, query, lang]);
  // Row 0 is "All Thailand" while nothing is typed; the provinces follow.
  const rows: (Province | null)[] = useMemo(() => (query.trim() ? found : [null, ...found]), [found, query]);

  const show = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    setRect({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 256) });
    setQuery("");
    const at = selected ? sorted.findIndex((p) => p.pcode === selected.pcode) + 1 : 0;
    setActive(Math.max(0, at));
    setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const choose = (p: Province | null) => { onSelect(p ? p.pcode : null); close(); };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!trigger.current?.contains(n) && !document.getElementById(listId)?.contains(n)) close(false);
    };
    const shut = () => close(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", shut);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); window.removeEventListener("resize", shut); };
  }, [open, listId]);

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(Math.max(0, rows.length - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (rows.length) choose(rows[Math.min(active, rows.length - 1)]); }
    else if (e.key === "Tab") close(false);
  };

  return (
    <div className="relative flex min-w-0 flex-1">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={tr.provinceLabel}
        data-tour="province"
        data-testid="province-picker"
        onClick={() => (open ? close() : show())}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[4px] border bg-background pr-2 pl-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:pl-2.5 coarse:text-base"
      >
        <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{selected ? nameOf(selected, lang) : tr.allThailand}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && rect && (
        <div
          id={listId}
          style={{ left: rect.left, top: rect.top, width: rect.width }}
          className="fixed z-50 flex max-h-[min(20rem,calc(100dvh-8rem))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
          onKeyDown={onKey}
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={input}
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder={tr.provinceSearch}
              aria-label={tr.provinceSearch}
              aria-controls={`${listId}-list`}
              aria-activedescendant={rows.length ? `${listId}-opt-${active}` : undefined}
              autoComplete="off"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground coarse:h-11 coarse:text-base"
            />
          </div>
          <ul id={`${listId}-list`} ref={listRef} role="listbox" aria-label={tr.provinceLabel} className="min-h-0 overflow-y-auto overscroll-contain py-1">
            {rows.map((p, i) => {
              const on = p ? p.pcode === selected?.pcode : !selected;
              return (
                <li
                  key={p ? p.pcode : "all"}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={on}
                  data-row={i}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm coarse:min-h-11", i === active && "bg-accent", on && "font-semibold")}
                >
                  <span className="min-w-0 flex-1 truncate">{p ? nameOf(p, lang) : tr.allThailand}</span>
                  {on && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </li>
              );
            })}
            {rows.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground" role="presentation">{tr.provinceNone}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
