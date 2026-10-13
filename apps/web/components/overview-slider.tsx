"use client";

import { useId } from "react";
import { Pause, Play } from "lucide-react";
import { InfoPopover } from "./info-popover";
import { Collapse, PanelToggle } from "./panel-toggle";
import { fmt, t } from "@/lib/i18n";
import { usePersistedOpen } from "@/lib/panel-state";
import { dayHeading, runLabel, shortDate, type OverviewMetric } from "@/lib/overview";
import type { Lang, OverviewSeries } from "@/lib/types";
import { MQ, useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

interface Props {
  lang: Lang;
  series: OverviewSeries;
  day: number;
  metric: OverviewMetric;
  playing: boolean;
  onDay: (d: number) => void;
  onMetric: (m: OverviewMetric) => void;
  onPlay: () => void;
}

const THUMB = 16; // px, matches the native range thumb so tick labels line up with it

/**
 * Map card: title row (title, info popover with the provenance captions, collapse chevron), then Play/Pause, Risk | Rain switch,
 * the 0..5 day slider and the selected day. Collapsed = one slim row: short title, Play, selected day, chevron.
 * Expanded by default on desktop/tablet, collapsed on phones and short screens; the choice is remembered.
 */
export function OverviewSlider({ lang, series, day, metric, playing, onDay, onMetric, onPlay }: Props) {
  const tr = t(lang);
  const bodyId = useId();
  const compact = useMedia(MQ.compactMap);
  const [open, setOpen] = usePersistedOpen("panel-slider", !compact);
  const steps = series.days.length - 1;
  const noForecast = steps === 0;      // only the observed day is available (forecast data out of date): no slider, no Play
  const cur = series.days.find((d) => d.h === day) ?? series.days[0];
  const date = shortDate(cur.date, lang);
  const valueText = fmt(day === 0 ? tr.ovValueTextLatest : tr.ovValueText, { n: day, date });
  const dayText = dayHeading(day, cur.date, lang);
  // The collapsed row is narrow: "Latest obs. · 11 Oct" / "+2 d · 14 Oct".
  const dayShort = `${day === 0 ? tr.ovLatest : fmt(tr.ovTick, { n: day })} · ${date}`;

  const play = noForecast ? null : (
    <button
      type="button"
      onClick={onPlay}
      aria-label={playing ? tr.ovPause : tr.ovPlay}
      title={playing ? tr.ovPause : tr.ovPlay}
      aria-pressed={playing}
      data-testid="overview-play"
      className="grid size-8 shrink-0 place-items-center rounded-[4px] border bg-primary text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring coarse:size-11"
    >
      {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={tr.ovTitle}
      data-testid="overview-slider"
      data-map-overlay="slider"
      data-open={open}
      className="@container/sl pointer-events-auto w-full max-w-md rounded-[4px] border bg-card/90 text-xs shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center gap-1 pl-3">
        <h2 className={cn("min-w-0 flex-1 py-2 text-[13px] leading-snug font-semibold", open ? "break-words" : "truncate @max-[22rem]/sl:sr-only")} title={noForecast ? tr.ovTitleObserved : tr.ovTitle}>{open ? (noForecast ? tr.ovTitleObserved : tr.ovTitle) : (noForecast ? tr.ovTitleObserved : tr.ovTitleShort)}</h2>
        {!open && play}
        {!open && <p className="min-w-0 shrink truncate px-1 py-0.5 text-xs leading-snug font-semibold tabular-nums @max-[22rem]/sl:flex-1" aria-live="polite" data-testid="overview-day-label" title={dayText}>{dayShort}</p>}
        {open && (
          <InfoPopover label={tr.ovInfo}>
            <p>{fmt(tr.ovCaption, { date: series.date_of_data, run: runLabel(series.model_run_time) })}</p>
            <p>{metric === "risk" ? tr.ovRiskHint : tr.ovRainHint}</p>
          </InfoPopover>
        )}
        <PanelToggle kind="slider" open={open} onToggle={() => setOpen(!open)} controls={bodyId} label={open ? tr.panelCollapse : tr.panelExpand} />
      </div>

      <Collapse open={open} id={bodyId}>
        <div className="space-y-1 px-3 pb-3">
          <div className="flex items-center gap-2">
            {play}
            <div role="group" aria-label={tr.ovMetric} className="flex shrink-0 overflow-hidden rounded-[4px] border">
              {(["risk", "rain"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={metric === m}
                  onClick={() => onMetric(m)}
                  data-testid={`overview-metric-${m}`}
                  className={cn(
                    "h-8 px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring coarse:h-11 coarse:min-w-11 coarse:text-sm",
                    metric === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
                  )}
                >
                  {m === "risk" ? tr.ovMetricRisk : tr.ovMetricRain}
                </button>
              ))}
            </div>
            <p className="ml-auto min-w-0 truncate py-0.5 text-right text-xs leading-snug font-semibold tabular-nums" aria-live="polite" data-testid="overview-day-label" title={dayText}>
              {dayText}
            </p>
          </div>

          {noForecast && <p className="py-1 text-xs leading-snug text-muted-foreground" role="status" data-testid="overview-no-forecast">{tr.ovNoForecast}</p>}
          <div className={cn(noForecast && "hidden")}>
            <input
              type="range"
              min={0}
              max={steps}
              step={1}
              value={day}
              onChange={(e) => onDay(Number(e.target.value))}
              aria-label={tr.ovDay}
              aria-valuetext={valueText}
              data-testid="overview-range"
              className="block h-8 w-full cursor-pointer accent-primary coarse:h-11"
            />
            <div className="relative h-4 text-xs text-muted-foreground short:hidden" aria-hidden>
              {Array.from({ length: steps + 1 }, (_, i) => {
                const pos = `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${i / steps})`;
                return (
                  <span
                    key={i}
                    className={cn("absolute top-0 whitespace-nowrap", i === day && "font-semibold text-foreground")}
                    style={{ left: pos, transform: i === 0 ? "translateX(-8px)" : i === steps ? "translateX(calc(-100% + 8px))" : "translateX(-50%)" }}
                  >
                    {i === 0 ? (
                      <>
                        <span className="@sm/sl:hidden">{tr.ovLatestShort}</span>
                        <span className="hidden @sm/sl:inline">{tr.ovLatest}</span>
                      </>
                    ) : fmt(tr.ovTick, { n: i })}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </Collapse>
    </div>
  );
}
