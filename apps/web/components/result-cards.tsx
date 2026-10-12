"use client";

import { useState } from "react";
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

  const tiles: { label: string; value: string; est?: boolean }[] = kpis
    ? [
        { label: tr.kpiPeople, value: `~${nf.format(kpis.people)}`, est: true },
        { label: tr.kpiHouseholds, value: `~${nf.format(kpis.households_est)}`, est: true },
        { label: tr.kpiBuildings, value: nf.format(kpis.buildings) },
        { label: tr.kpiRoads, value: nf.format(kpis.road_km) },
        { label: tr.kpiSchools, value: nf.format(kpis.schools) },
        { label: tr.kpiHospitals, value: nf.format(kpis.hospitals) },
      ]
    : [];

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
          <CardHeader><CardTitle>{kpis.area_name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tiles.map((k) => (
                <div key={k.label} className="rounded-lg bg-muted px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{k.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {k.value}
                    {k.est && <span className="ml-1 text-xs font-normal text-muted-foreground">{tr.est}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <Collapsible>
              <CollapsibleTrigger className="text-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                {tr.about}
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
              <Button variant="outline" size="sm" disabled={!kpis.scenario_id || exporting} onClick={onExport} aria-label={tr.export}>
                {tr.export}
              </Button>
            </span>
            {exportErr && <p role="alert" className="text-xs text-destructive">{tr.error}</p>}
          </CardContent>
        </Card>
      )}
      {charts.map((c) => <BarCard key={c.id} chart={c} />)}
      {tables.map((tb) => (
        <Card size="sm" key={tb.id}>
          <CardHeader><CardTitle>{tb.title}</CardTitle></CardHeader>
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
  return (
    <Card size="sm">
      <CardHeader><CardTitle>{chart.title}</CardTitle></CardHeader>
      <CardContent>
        <div role="img" aria-label={chart.title} className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} label={{ value: chart.x_label, position: "insideBottom", offset: -10, fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: chart.y_label, angle: -90, position: "insideLeft", fontSize: 11 }} />
              <Tooltip />
              {series.length > 1 && <Legend verticalAlign="top" height={20} />}
              {keys.map((k, i) => <Bar key={k} dataKey={k} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[3, 3, 0, 0]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
