"use client";

import { useState } from "react";
import { Building2, ChevronDown, CloudRain, GraduationCap, Hospital, House, MapPin, Route, Users, type LucideIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadBriefing } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { ChartData, Kpis, Lang, TableData } from "@/lib/types";

const SERIES_COLORS = ["#d95f0e", "#2c7fb8", "#7b3294", "#4d4d4d"]; // colour-blind-safe

export function ResultCards({ lang, kpis, charts, tables, loading }: { lang: Lang; kpis: Kpis | null; charts: ChartData[]; tables: TableData[]; loading: boolean }) {
  const tr = t(lang);
  const nf = new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState(false);

  if (!kpis && !charts.length && !tables.length) {
    return loading ? <Skeleton className="h-24 w-full" aria-label="Loading results" /> : null;
  }

  // null = layer not built yet: show "—", never a made-up 0.
  const num = (v: number | null | undefined, approx = false) => (v == null ? null : `${approx ? "~" : ""}${nf.format(v)}`);
  const tiles: { label: string; value: string | null; Icon: LucideIcon; est?: boolean }[] = kpis
    ? [
        { label: tr.kpiPeople, value: num(kpis.people, true), Icon: Users, est: true },
        { label: tr.kpiHouseholds, value: num(kpis.households_est, true), Icon: House, est: true },
        { label: tr.kpiBuildings, value: num(kpis.buildings), Icon: Building2 },
        { label: tr.kpiRoads, value: num(kpis.road_km), Icon: Route },
        { label: tr.kpiSchools, value: num(kpis.schools), Icon: GraduationCap },
        { label: tr.kpiHospitals, value: num(kpis.hospitals), Icon: Hospital },
      ]
    : [];

  // Optional extras: only shown when the API sent them. null/undefined = "—", never 0.
  const ex = kpis?.extras;
  const trig = ex && ex.triggered_tambons !== undefined
    ? { value: ex.triggered_tambons == null ? null : ex.tambons_total == null ? nf.format(ex.triggered_tambons) : `${nf.format(ex.triggered_tambons)} / ${nf.format(ex.tambons_total)}`,
        note: [ex.rain_window, ex.trigger_source && `${tr.triggerSource}: ${ex.trigger_source}`].filter(Boolean).join(" · ") }
    : null;

  const onExport = async () => {
    if (!kpis) return;
    setExporting(true);
    setExportErr(false);
    try { await downloadBriefing(kpis.scenario_id); } catch { setExportErr(true); } finally { setExporting(false); }
  };

  return (
    <div className="space-y-3">
      {kpis && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-base font-semibold">
              <MapPin className="size-4 text-primary" aria-hidden />
              {kpis.area_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-2">
              {tiles.map(({ label, value, Icon, est }) => (
                <div key={label} className="rounded-xl bg-muted/70 px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </dt>
                  <dd className="mt-1 flex items-baseline gap-1 text-[22px] leading-none font-semibold tracking-tight tabular-nums">
                    {value ?? <span className="text-muted-foreground" title={tr.na} aria-label={tr.na}>—</span>}
                    {est && value && <span className="text-[11px] font-normal tracking-normal text-muted-foreground">{tr.est}</span>}
                  </dd>
                </div>
              ))}
              {trig && (
                <div className="col-span-2 rounded-xl bg-muted/70 px-3 py-2.5" data-testid="kpi-triggered">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CloudRain className="size-3.5" aria-hidden />
                    {tr.kpiTriggered}
                  </dt>
                  <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[22px] leading-none font-semibold tracking-tight tabular-nums">
                    {trig.value ?? <span className="text-muted-foreground" title={tr.na} aria-label={tr.na}>—</span>}
                    {trig.note && <span className="text-[11px] font-normal tracking-normal text-muted-foreground">{trig.note}</span>}
                  </dd>
                </div>
              )}
            </dl>
            <Collapsible>
              <CollapsibleTrigger className="group flex items-center gap-1 rounded text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                {tr.about}
                <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2 text-xs text-muted-foreground">
                <p><b>{tr.sources}:</b></p>
                <ul className="list-disc pl-5">{kpis.data_sources.map((s) => <li key={s}>{s}</li>)}</ul>
                <p>{tr.resolution}: {kpis.resolution_m} m · {tr.dataDate}: {kpis.date_of_data}</p>
                <p><b>{tr.limitations}:</b></p>
                <ul className="list-disc pl-5">{kpis.limitations.map((s) => <li key={s}>{s}</li>)}</ul>
              </CollapsibleContent>
            </Collapsible>
            <span title={kpis.scenario_id ? undefined : tr.exportNA} className="inline-block">
              <Button variant="outline" size="default" disabled={!kpis.scenario_id || exporting} onClick={onExport} aria-label={tr.export}>
                {tr.export}
              </Button>
            </span>
            {exportErr && <p role="alert" className="text-xs text-destructive">{tr.error}</p>}
          </CardContent>
        </Card>
      )}
      {charts.filter((c) => c.data.length > 0).map((c) => <BarCard key={c.id} chart={c} />)}
      {tables.map((tb) => (
        <Card size="sm" key={tb.id}>
          <CardHeader><CardTitle className="text-sm font-semibold">{tb.title}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr>{tb.columns.map((c) => <th key={c} scope="col" className="border-b px-2 py-1 font-medium">{c}</th>)}</tr></thead>
              <tbody>
                {tb.rows.map((r, i) => (
                  <tr key={i} className="odd:bg-muted/50">{r.map((v, j) => <td key={j} className="px-2 py-1">{v ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BarCard({ chart }: { chart: ChartData }) {
  const series = [...new Set(chart.data.map((d) => d.series).filter((s): s is string => !!s))];
  const rows = chart.data.reduce<Record<string, string | number>[]>((acc, d) => {
    let row = acc.find((r) => r.label === d.label);
    if (!row) acc.push((row = { label: d.label }));
    row[d.series ?? "value"] = d.value;
    return acc;
  }, []);
  const keys = series.length ? series : ["value"];
  const horizontal = series.length === 0;   // single-series rankings read best as horizontal bars
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="text-sm font-semibold">{chart.title}</CardTitle></CardHeader>
      <CardContent>
        <div role="img" aria-label={chart.title} className="w-full" style={{ height: horizontal ? Math.max(150, rows.length * 32 + 24) : 208 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={horizontal ? { top: 4, right: 12, bottom: 4, left: 0 } : { top: 4, right: 8, bottom: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <YAxis type="category" dataKey="label" width={104} interval={0} tickLine={false} tick={{ fontSize: 11, fill: "var(--foreground)" }} stroke="var(--border)" />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" label={{ value: chart.x_label, position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" label={{ value: chart.y_label, angle: -90, position: "insideLeft", fontSize: 11, fill: "var(--muted-foreground)" }} />
                </>
              )}
              <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
              {series.length > 1 && <Legend verticalAlign="top" height={20} />}
              {keys.map((k, i) => <Bar key={k} dataKey={k} fill={series.length ? SERIES_COLORS[i % SERIES_COLORS.length] : "var(--brand)"} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
