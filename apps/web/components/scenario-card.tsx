"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { t } from "@/lib/i18n";
import type { Kpis, Lang } from "@/lib/types";

const DURATIONS = [6, 12, 24, 48, 72, 120];

export function ScenarioCard({ lang, kpis, busy, error, onRun }: { lang: Lang; kpis: Kpis | null; busy: boolean; error: string | null; onRun: (mm: number, h: number) => void }) {
  const tr = t(lang);
  const [mm, setMm] = useState(250);
  const [h, setH] = useState(72);
  const disabled = !kpis || busy;
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="text-sm font-semibold">{tr.scenario}{kpis ? ` · ${kpis.area_name}` : ""}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between"><label id="rain-l" className="text-xs text-muted-foreground">{tr.rainfall}</label><output className="text-xl font-semibold tracking-tight tabular-nums">{mm}<span className="ml-0.5 text-xs font-normal text-muted-foreground"> mm</span></output></div>
          <Slider aria-labelledby="rain-l" min={50} max={500} step={10} value={[mm]} onValueChange={(v) => setMm(Array.isArray(v) ? v[0] : v)} disabled={disabled} />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            {tr.duration}
            <select value={h} onChange={(e) => setH(Number(e.target.value))} disabled={disabled} className="h-9 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {DURATIONS.map((d) => <option key={d} value={d}>{d} {tr.hours}</option>)}
            </select>
          </label>
          <span title={kpis ? undefined : tr.scenarioNA}>
            <Button size="lg" disabled={disabled} onClick={() => onRun(mm, h)}>{busy ? tr.running : tr.run}</Button>
          </span>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{tr.error}: {error}</p>}
      </CardContent>
    </Card>
  );
}
