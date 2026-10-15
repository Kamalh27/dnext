"use client";

import { Bell, BellRing, FileText, RotateCcw } from "lucide-react";
import { ProvincePicker } from "./province-picker";
import { fmt, t } from "@/lib/i18n";
import { runLabel } from "@/lib/overview";
import type { Kpis, Lang, Province } from "@/lib/types";

export const provinceName = (p: Province, lang: Lang) => (lang === "th" ? p.name_th || p.name : p.name);

/** Chips describing the current result, built only from fields the API sent (a missing value never turns into 0). */
function chipsOf(kpis: Kpis, lang: Lang): string[] {
  const tr = t(lang);
  const out: string[] = [];
  if (kpis.kind === "forecast") {
    if (kpis.horizon_days != null)
      out.push(kpis.model_run_time
        ? fmt(tr.chipForecast, { n: kpis.horizon_days, run: runLabel(kpis.model_run_time) })
        : fmt(tr.chipForecastNoRun, { n: kpis.horizon_days }));
  } else if (kpis.rainfall_mm != null && kpis.duration_h != null) {
    out.push(fmt(tr.chipWhatIf, { mm: kpis.rainfall_mm, h: kpis.duration_h }));
  }
  if (kpis.date_of_data) out.push(fmt(tr.chipObserved, { date: kpis.date_of_data }));
  const ex = kpis.extras;
  if (ex?.triggered_tambons != null) {
    const nf = new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US");
    out.push(ex.tambons_total != null
      ? fmt(tr.chipTriggered, { n: nf.format(ex.triggered_tambons), m: nf.format(ex.tambons_total) })
      : fmt(tr.chipTriggeredNoTotal, { n: nf.format(ex.triggered_tambons) }));
  }
  return out;
}

/** Pinned above the chat: province picker plus a one-glance description of the active scenario. */
export function ScenarioBar({ lang, provinces, selected, kpis, hasResults, onSelect, onReset, report, watch }: {
  lang: Lang;
  provinces: Province[];
  selected: Province | null;
  kpis: Kpis | null;
  hasResults: boolean;
  onSelect: (pcode: string | null) => void;
  onReset: () => void;
  /** The report button: for the shown result when there is one, otherwise for the national overview. */
  report: { target: "scenario" | "overview" | null; busy: boolean; error: string | null; onClick: () => void };
  /** Alerts for the selected province (signed-in accounts only). */
  watch: { enabled: boolean; watching: boolean; full: boolean; busy: boolean; onToggle: () => void };
}) {
  const tr = t(lang);
  const chips = selected && kpis ? chipsOf(kpis, lang) : [];

  return (
    <section aria-label={tr.scenarioSummary} className="shrink-0 space-y-1.5 border-b bg-card px-3 py-2 short:flex short:items-center short:gap-2 short:space-y-0" data-testid="scenario-bar">
      <div className="flex items-center gap-2 short:min-w-0 short:flex-1">
        <ProvincePicker lang={lang} provinces={provinces} selected={selected} onSelect={onSelect} />
        <button
          type="button"
          onClick={report.onClick}
          data-tour="report"
          disabled={!report.target || report.busy}
          data-testid="report-button"
          aria-label={tr.export}
          title={report.target === "scenario" ? tr.reportScenarioTip : report.target === "overview" ? tr.reportOverviewTip : tr.reportNone}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 coarse:h-11 coarse:px-3.5 coarse:text-sm"
        >
          <FileText className="size-3.5" aria-hidden />
          <span className="max-[380px]:sr-only">{tr.exportShort}</span>
        </button>
        {selected && watch.enabled && (
          <button
            type="button"
            onClick={watch.onToggle}
            disabled={watch.busy || (watch.full && !watch.watching)}
            aria-pressed={watch.watching}
            data-testid="watch-button"
            aria-label={watch.watching ? tr.watchOn : tr.watchOff}
            title={watch.watching ? tr.watchOn : watch.full ? tr.watchFull : tr.watchOff}
            className="flex h-8 shrink-0 items-center rounded-[4px] border bg-background px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-pressed:border-primary aria-pressed:text-primary coarse:h-11 coarse:px-3"
          >
            {watch.watching ? <BellRing className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
            <span className="ml-1.5 text-xs font-medium max-[430px]:sr-only coarse:text-sm">{watch.watching ? tr.watchingShort : tr.watchShort}</span>
          </button>
        )}
        {selected && hasResults && (
          <button
            type="button"
            onClick={onReset}
            title={tr.resetTitle}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:px-3.5 coarse:text-sm"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {tr.reset}
          </button>
        )}
      </div>
      {report.error && <p role="alert" className="text-xs text-destructive">{report.error}</p>}
      {!selected ? (
        <p className="text-xs text-muted-foreground short:max-w-[40%] short:truncate" title={tr.chooseHint}>{tr.chooseHint}</p>
      ) : chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1 short:max-w-[50%] short:flex-nowrap short:overflow-hidden short:[&>li:not(:first-child)]:hidden" aria-label={tr.scenarioSummary}>
          {chips.map((c) => (
            <li key={c} className="max-w-full truncate rounded-[4px] bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground" title={c}>{c}</li>
          ))}
        </ul>
      ) : hasResults ? null : (
        <p className="text-xs text-muted-foreground short:max-w-[40%] short:truncate" title={tr.noScenario}>{tr.noScenario}</p>
      )}
    </section>
  );
}
