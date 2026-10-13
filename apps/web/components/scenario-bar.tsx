"use client";

import { useMemo } from "react";
import { MapPin, RotateCcw } from "lucide-react";
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
export function ScenarioBar({ lang, provinces, selected, kpis, hasResults, onSelect, onReset }: {
  lang: Lang;
  provinces: Province[];
  selected: Province | null;
  kpis: Kpis | null;
  hasResults: boolean;
  onSelect: (pcode: string | null) => void;
  onReset: () => void;
}) {
  const tr = t(lang);
  const sorted = useMemo(() => {
    const c = new Intl.Collator(lang === "th" ? "th" : "en");
    return [...provinces].sort((a, b) => c.compare(provinceName(a, lang), provinceName(b, lang)));
  }, [provinces, lang]);
  const chips = selected && kpis ? chipsOf(kpis, lang) : [];

  return (
    <section aria-label={tr.scenarioSummary} className="shrink-0 space-y-1.5 border-b bg-card px-3 py-2" data-testid="scenario-bar">
      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <MapPin className="pointer-events-none absolute left-2 size-4 text-primary" aria-hidden />
          <select
            aria-label={tr.provinceLabel}
            value={selected?.pcode ?? ""}
            onChange={(e) => onSelect(e.target.value || null)}
            className="h-8 w-full min-w-0 rounded-[4px] border bg-background pr-2 pl-8 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{tr.allThailand}</option>
            {sorted.map((p) => <option key={p.pcode} value={p.pcode}>{provinceName(p, lang)}</option>)}
          </select>
        </label>
        {selected && hasResults && (
          <button
            type="button"
            onClick={onReset}
            title={tr.resetTitle}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {tr.reset}
          </button>
        )}
      </div>
      {!selected ? (
        <p className="text-xs text-muted-foreground">{tr.chooseHint}</p>
      ) : chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={tr.scenarioSummary}>
          {chips.map((c) => (
            <li key={c} className="max-w-full truncate rounded-[4px] bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground" title={c}>{c}</li>
          ))}
        </ul>
      ) : hasResults ? null : (
        <p className="text-xs text-muted-foreground">{tr.noScenario}</p>
      )}
    </section>
  );
}
