"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fmt, t } from "@/lib/i18n";
import { markTourSeen, placeCard, STEPS, TEXT, useTourPending, type Box, type TourStep } from "@/lib/tour";
import type { Lang } from "@/lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * A short walk through the screen, one highlighted control at a time. It opens by itself on the first visit (after the map controls have appeared)
 * and can be reopened from the help button. Skip, Escape or finishing marks it as seen.
 */
export function Tour({ lang, open, onClose, tab, onTab }: { lang: Lang; open: boolean; onClose: () => void; tab: "chat" | "map"; onTab: (t: "chat" | "map") => void }) {
  const pending = useTourPending();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(id);
  }, []);
  if (!(open || (pending && ready))) return null;
  return <TourRun lang={lang} tab={tab} onTab={onTab} onFinish={() => { markTourSeen(); onClose(); }} />;
}

function TourRun({ lang, tab, onTab, onFinish }: { lang: Lang; tab: "chat" | "map"; onTab: (t: "chat" | "map") => void; onFinish: () => void }) {
  const tr = t(lang);
  // The steps whose control exists on this screen right now (the slider only in the national overview, for example).
  const [list] = useState<TourStep[]>(() => STEPS.filter((s) => document.querySelector(s.selector)));
  const [i, setI] = useState(0);
  const [cur, setCur] = useState<{ i: number; el: Element; first: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dir = useRef(1);
  const first = useRef(-1);
  const startTab = useRef(tab);
  const tabNow = useRef(tab);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  const finish = () => {
    if (tabNow.current !== startTab.current) onTab(startTab.current);
    onFinish();
  };
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });

  // Find the control of step i (switching between the Chat and Map tabs on small screens) or move on when it is not there.
  useEffect(() => {
    let live = true;
    (async () => {
      let n = i;
      while (n >= 0 && n < list.length) {
        const s = list[n];
        if (s.tab && s.tab !== tabNow.current) { tabNow.current = s.tab; onTab(s.tab); await sleep(180); }
        const el = document.querySelector(s.selector);
        if (el && visible(el)) {
          if (!live) return;
          if (first.current < 0) first.current = n;
          el.scrollIntoView({ block: "nearest", inline: "nearest" });
          setCur({ i: n, el, first: first.current });
          return;
        }
        n += dir.current;
      }
      if (live) finishRef.current();
    })();
    return () => { live = false; };
  }, [i, list, onTab]);

  // Keep the highlight and the card on the control while the window changes.
  useEffect(() => {
    if (!cur) return;
    const update = () => {
      const r = cur.el.getBoundingClientRect();
      const c = card.current?.getBoundingClientRect();
      const b = { left: r.left, top: r.top, width: r.width, height: r.height };
      setBox(b);
      if (c) setPos(placeCard(b, { w: c.width, h: c.height }, { w: window.innerWidth, h: window.innerHeight }));
    };
    const raf = requestAnimationFrame(() => { update(); next.current?.focus({ preventScroll: true }); });
    const later = setTimeout(update, 250);   // after a tab switch or a scroll has settled
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const ro = new ResizeObserver(update);
    ro.observe(cur.el);
    return () => { cancelAnimationFrame(raf); clearTimeout(later); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); ro.disconnect(); };
  }, [cur]);

  const go = (d: 1 | -1) => { dir.current = d; setI((cur?.i ?? i) + d); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); finish(); }
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft" && cur && cur.i > cur.first) go(-1);
  };

  if (!cur) return <div className="fixed inset-0 z-[200]" aria-hidden />;
  const step = list[cur.i];
  const text = TEXT[lang][step.id];
  const last = cur.i >= list.length - 1;
  const pad = 6;

  return (
    <div className="fixed inset-0 z-[200]" onKeyDown={onKey} data-testid="tour">
      {box && (
        <div aria-hidden className="pointer-events-none fixed rounded-lg ring-2 ring-white transition-all duration-200"
          style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2, boxShadow: "0 0 0 9999px rgba(0,0,0,0.58)" }} />
      )}
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" data-step={step.id}
        className="fixed w-[min(20rem,calc(100vw-1rem))] rounded-xl border bg-card p-4 text-card-foreground shadow-2xl"
        style={{ left: pos?.left ?? 8, top: pos?.top ?? 8, visibility: pos ? "visible" : "hidden" }}>
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{fmt(tr.tourStep, { n: cur.i + 1, m: list.length })}</p>
        <h2 id="tour-title" className="mt-1 text-base font-semibold">{text.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={finish} data-testid="tour-skip" className="min-h-8 rounded-md px-1 text-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11">{tr.tourSkip}</button>
          <div className="flex gap-2">
            {cur.i > cur.first && <Button variant="outline" size="sm" onClick={() => go(-1)}>{tr.tourBack}</Button>}
            <Button ref={next} size="sm" onClick={() => (last ? finish() : go(1))} data-testid="tour-next">{last ? tr.tourDone : tr.tourNext}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
