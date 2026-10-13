"use client";

import { fmt, t } from "@/lib/i18n";
import { dayHeading, numFmt, riskName, riskColor, riskTextOn, roundedPeople } from "@/lib/overview";
import { pick } from "@/lib/lang";
import type { Lang, OverviewSeries } from "@/lib/types";

/** Left-panel overview of the selected day: headline totals and the highest-risk provinces (each one selects that province). */
export function OverviewCard({ lang, series, day, onSelect }: { lang: Lang; series: OverviewSeries; day: number; onSelect: (pcode: string) => void }) {
  const tr = t(lang);
  const d = series.days.find((x) => x.h === day) ?? series.days[0];
  if (!d) return null;
  const nf = numFmt(lang);
  const { totals } = d;
  const top = d.top.slice(0, 5);

  return (
    <section aria-label={tr.ovCardTitle} data-testid="overview-card" className="w-full rounded-xl border bg-card p-3.5 text-left shadow-xs">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{tr.ovCardTitle}</h2>
      <p className="mt-1.5 text-sm leading-relaxed" data-testid="overview-headline" aria-live="polite">
        <span className="font-semibold">{dayHeading(d.h, d.date, lang)}:</span>{" "}
        {totals.triggered === 0
          ? tr.ovQuiet
          : fmt(tr.ovSummary, { n: nf.format(totals.triggered), m: nf.format(totals.tambons_total), p: nf.format(totals.provinces_triggered), pm: nf.format(totals.provinces_total) })}
      </p>
      {top.length > 0 && totals.triggered > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold text-muted-foreground">{tr.ovTop}</h3>
          <ul className="mt-1.5 space-y-1.5">
            {top.map((p) => {
              const people = roundedPeople(p.people_elevated);
              const name = pick(lang, p.name, p.name_th);
              return (
                <li key={p.pcode}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.pcode)}
                    aria-label={fmt(tr.ovSelect, { name })}
                    data-testid="overview-top-row"
                    className="flex w-full flex-col gap-0.5 rounded-[4px] border bg-background px-2.5 py-2 text-left text-sm outline-none transition hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{name}</span>
                      {p.risk_class >= 1 && (
                        <span className="shrink-0 rounded-[3px] px-1.5 py-0.5 text-[11px] leading-none font-semibold" style={{ background: riskColor(p.risk_class), color: riskTextOn(p.risk_class) }}>
                          {riskName(p.risk_class, lang)}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmt(tr.ovTambons, { n: nf.format(p.triggered), m: nf.format(p.tambons) })}
                      {" · "}
                      {people == null ? tr.ovPeopleNA : fmt(tr.ovPeople, { n: `~${nf.format(people)}` })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
