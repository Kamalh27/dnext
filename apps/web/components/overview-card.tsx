"use client";

import { ArrowDown } from "lucide-react";
import { fmt, t } from "@/lib/i18n";
import { dayHeading, numFmt, runLabel } from "@/lib/overview";
import type { Lang, OverviewSeries } from "@/lib/types";
import { OverviewDashboard } from "./overview-dashboard";

/** Left-panel national overview of the selected day: headline, key figures, trend, breakdown charts and top provinces. */
export function OverviewCard({ lang, series, day, onDay, onSelect, onAsk }: { lang: Lang; series: OverviewSeries; day: number; onDay: (h: number) => void; onSelect: (pcode: string) => void; onAsk?: () => void }) {
  const tr = t(lang);
  const d = series.days.find((x) => x.h === day) ?? series.days[0];
  if (!d) return null;
  const nf = numFmt(lang);
  const { totals } = d;

  return (
    <section aria-label={tr.ovCardTitle} data-testid="overview-card" data-day={d.h} className="w-full space-y-3 rounded-xl border bg-card p-3.5 text-left shadow-xs">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{tr.ovCardTitle}</h2>
          {onAsk && (
            <button type="button" onClick={onAsk} data-testid="overview-ask" title={tr.jumpToChat} className="-my-1 -mr-1 inline-flex min-h-8 shrink-0 items-center gap-1 rounded-[4px] px-2 text-xs font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11">
              {tr.ovAsk}<ArrowDown className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed" data-testid="overview-headline" aria-live="polite">
          <span className="font-semibold">{dayHeading(d.h, d.date, lang)}:</span>{" "}
          {totals.triggered === 0
            ? tr.ovQuiet
            : fmt(tr.ovSummary, { n: nf.format(totals.triggered), m: nf.format(totals.tambons_total), p: nf.format(totals.provinces_triggered), pm: nf.format(totals.provinces_total) })}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground" data-testid="overview-asof">{series.days.length > 1 ? fmt(tr.ovAsOf, { date: series.date_of_data, run: runLabel(series.model_run_time) }) : fmt(tr.ovAsOfObserved, { date: series.date_of_data })}</p>
      </div>
      <OverviewDashboard lang={lang} series={series} d={d} onDay={onDay} onSelect={onSelect} />
    </section>
  );
}
