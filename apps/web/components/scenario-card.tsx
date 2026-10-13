"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import type { ApiError } from "@/lib/api-error";
import { useBurstLeft } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { apiErrorText } from "@/lib/limit-text";
import type { Lang, Province } from "@/lib/types";
import { provinceName } from "./scenario-bar";

const DURATIONS = [6, 12, 24, 48, 72, 120];
const HORIZONS = [3, 5, 7];

export type RunKind = "scenario" | "forecast";
export interface RunError { kind: RunKind; message: string; apiError?: ApiError }

const selectCls = "h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:text-base";

export function ScenarioCard({ lang, province, busy, error, onRun, onForecast }: {
  lang: Lang;
  province: Province | null;
  busy: RunKind | null;
  error: RunError | null;
  onRun: (mm: number, h: number) => void;
  onForecast: (days: number) => void;
}) {
  const tr = t(lang);
  const [mm, setMm] = useState(250);
  const [h, setH] = useState(72);
  const [days, setDays] = useState(5);
  const burstLeft = useBurstLeft();
  const disabled = !province || busy !== null || burstLeft > 0;
  const na = province ? undefined : tr.scenarioNA;
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="min-w-0 text-sm font-semibold break-words">{tr.scenario}{province ? ` · ${provinceName(province, lang)}` : ""}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between"><label id="rain-l" className="text-xs text-muted-foreground">{tr.rainfall}</label><output className="text-xl font-semibold tracking-tight tabular-nums">{mm}<span className="ml-0.5 text-xs font-normal text-muted-foreground"> mm</span></output></div>
          <Slider aria-labelledby="rain-l" min={50} max={500} step={10} value={[mm]} onValueChange={(v) => setMm(Array.isArray(v) ? v[0] : v)} disabled={disabled} />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            {tr.duration}
            <select value={h} onChange={(e) => setH(Number(e.target.value))} disabled={disabled} className={selectCls}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} {tr.hours}</option>)}
            </select>
          </label>
          <span title={na}>
            <Button size="lg" disabled={disabled} onClick={() => onRun(mm, h)}>{busy === "scenario" ? tr.running : tr.run}</Button>
          </span>
        </div>
        <RunMessage error={error?.kind === "scenario" ? error : null} lang={lang} burstLeft={burstLeft} />
        <div className="flex items-end gap-2 border-t pt-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            {tr.forecastHorizon}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={disabled} className={selectCls}>
              {HORIZONS.map((d) => <option key={d} value={d}>{d} {tr.days}</option>)}
            </select>
          </label>
          <span title={na}>
            <Button size="lg" variant="outline" disabled={disabled} onClick={() => onForecast(days)}>{busy === "forecast" ? tr.running : tr.forecast}</Button>
          </span>
        </div>
        <RunMessage error={error?.kind === "forecast" ? error : null} lang={lang} burstLeft={burstLeft} />
      </CardContent>
    </Card>
  );
}

/** A failed run: limit errors read as plain sentences (burst ones count down live and disappear when the wait is over), others keep the "Something went wrong" prefix. */
function RunMessage({ error, lang, burstLeft }: { error: RunError | null; lang: Lang; burstLeft: number }) {
  if (!error) return null;
  const tr = t(lang);
  const api = error.apiError;
  if (api && (api.isBurst || api.isDaily)) {
    if (api.isBurst && burstLeft === 0) return null;
    return <p role={api.isBurst ? "status" : "alert"} data-testid="run-limit" className="text-xs text-destructive">{apiErrorText(api, lang, burstLeft)}</p>;
  }
  return <p role="alert" className="text-xs text-destructive">{tr.error}: {error.message}</p>;
}
