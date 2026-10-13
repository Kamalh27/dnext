"use client";

import { Pause, Play } from "lucide-react";
import { fmt, t } from "@/lib/i18n";
import { dayHeading, runLabel, shortDate, type OverviewMetric } from "@/lib/overview";
import type { Lang, OverviewSeries } from "@/lib/types";
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

/** Map card: Risk | Rain switch, Play/Pause, a 0..5 day slider and one-line provenance captions. */
export function OverviewSlider({ lang, series, day, metric, playing, onDay, onMetric, onPlay }: Props) {
  const tr = t(lang);
  const steps = series.days.length - 1;
  const cur = series.days.find((d) => d.h === day) ?? series.days[0];
  const date = shortDate(cur.date, lang);
  const valueText = fmt(day === 0 ? tr.ovValueTextLatest : tr.ovValueText, { n: day, date });

  return (
    <div
      role="group"
      aria-label={tr.ovTitle}
      data-testid="overview-slider"
      className="pointer-events-auto w-full max-w-md space-y-2 rounded-[4px] border bg-card/90 p-3 text-xs shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] leading-snug font-semibold">{tr.ovTitle}</h2>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPlay}
          aria-label={playing ? tr.ovPause : tr.ovPlay}
          title={playing ? tr.ovPause : tr.ovPlay}
          aria-pressed={playing}
          data-testid="overview-play"
          className="grid size-8 shrink-0 place-items-center rounded-[4px] border bg-primary text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
        <div role="group" aria-label={tr.ovMetric} className="flex shrink-0 overflow-hidden rounded-[4px] border">
          {(["risk", "rain"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => onMetric(m)}
              data-testid={`overview-metric-${m}`}
              className={cn(
                "h-8 px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                metric === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
              )}
            >
              {m === "risk" ? tr.ovMetricRisk : tr.ovMetricRain}
            </button>
          ))}
        </div>
        <p className="ml-auto min-w-0 text-right text-xs leading-tight font-semibold tabular-nums @md:text-[13px]" aria-live="polite" data-testid="overview-day-label">
          {dayHeading(day, cur.date, lang)}
        </p>
      </div>

      <div>
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
          className="block h-5 w-full cursor-pointer accent-primary"
        />
        <div className="relative h-4 text-[10px] text-muted-foreground" aria-hidden>
          {Array.from({ length: steps + 1 }, (_, i) => {
            const pos = `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${i / steps})`;
            return (
              <span
                key={i}
                className={cn("absolute top-0 whitespace-nowrap", i === day && "font-semibold text-foreground")}
                style={{ left: pos, transform: i === 0 ? "translateX(-8px)" : i === steps ? "translateX(calc(-100% + 8px))" : "translateX(-50%)" }}
              >
                {i === 0 ? tr.ovLatest : fmt(tr.ovTick, { n: i })}
              </span>
            );
          })}
        </div>
      </div>

      <div className="space-y-0.5 text-[11px] leading-snug text-muted-foreground">
        <p>{fmt(tr.ovCaption, { date: series.date_of_data, run: runLabel(series.model_run_time) })}</p>
        <p>{metric === "risk" ? tr.ovRiskHint : tr.ovRainHint}</p>
      </div>
    </div>
  );
}
