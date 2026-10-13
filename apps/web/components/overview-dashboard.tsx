"use client";

import { useState, type CSSProperties } from "react";
import { DashSection } from "./dash-section";
import { Building2, GraduationCap, Hospital, Layers, Map as MapIcon, Route, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, t, type Dict } from "@/lib/i18n";
import {
  availableMetrics, classRows, dayHeading, fmtCount, fmtKm, fmtRounded, numFmt, provinceRows, riskColor, riskName, shortDate, sumClasses,
  type BarRow, type DashMetric, RISK_COLORS,
} from "@/lib/overview";
import type { Lang, OverviewDay, OverviewSeries } from "@/lib/types";
import { cn } from "@/lib/utils";

const H3 = "text-xs font-semibold text-muted-foreground";
const RING = "inset 0 0 0 1px color-mix(in oklab, var(--foreground) 22%, transparent)";

interface Props {
  lang: Lang;
  series: OverviewSeries;
  d: OverviewDay;
  onDay: (h: number) => void;
  onSelect: (pcode: string) => void;
}

/** Stats tiles, 5-day trend, risk-class breakdown and top-province chart for the selected overview day. */
export function OverviewDashboard({ lang, series, d, onDay, onSelect }: Props) {
  const tr = t(lang);
  const avail = availableMetrics(d);
  const [pref, setPref] = useState<DashMetric>("people");
  const metric = avail.includes(pref) ? pref : (avail[0] ?? "people");
  return (
    <div>
      <DashSection k="key" title={tr.ovSecKey} desktopOpen phoneOpen testId="overview-key">
        <Tiles lang={lang} d={d} />
      </DashSection>
      {series.days.length > 1 && (
        <DashSection k="trend" title={tr.ovTrendTitle} desktopOpen phoneOpen={false}>
          <Trend lang={lang} series={series} day={d.h} onDay={onDay} />
        </DashSection>
      )}
      {avail.length > 0 && (
        <DashSection k="breakdown" title={tr.ovSecBreakdown} desktopOpen phoneOpen={false} testId="overview-breakdown">
          <MetricSwitch lang={lang} value={metric} options={avail} onChange={setPref} />
          <ClassChart lang={lang} d={d} metric={metric} />
          <ProvinceChart lang={lang} d={d} metric={metric} onSelect={onSelect} />
        </DashSection>
      )}
      <DashSection k="about" title={tr.ovSecAbout} desktopOpen={false} phoneOpen={false}>
        <p className="text-xs leading-snug text-muted-foreground" data-testid="overview-footnote">{tr.ovFoot}</p>
      </DashSection>
    </div>
  );
}

// ---------------------------------------------------------------- tiles

function Tile({ lang, Icon, label, value, sub, title, progress, testId }: { lang: Lang; Icon: LucideIcon; label: string; value: string | null; sub?: string; title?: string; progress?: number; testId: string }) {
  const tr = t(lang);
  return (
    <div className="min-w-0 rounded-xl bg-muted/70 px-3 py-1.5" data-testid={testId} title={title}>
      <dt className="flex items-start gap-1.5 text-xs leading-tight text-muted-foreground">
        <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="mt-0.5 text-lg leading-tight font-semibold tracking-tight tabular-nums">
        {value ?? <span className="text-muted-foreground" aria-label={tr.na}>—</span>}
      </dd>
      {progress != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, minWidth: progress > 0 ? 3 : 0 }} />
        </div>
      )}
      {sub && <p className="mt-1 text-xs leading-tight text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Tiles({ lang, d }: { lang: Lang; d: OverviewDay }) {
  const tr = t(lang);
  const nf = numFmt(lang);
  const { totals } = d;
  const susPeople = sumClasses(d, "people");
  const elev = totals.people_elevated;
  const el = d.elevated ?? null;
  const onSus = (v: string | null) => (v == null ? undefined : fmt(tr.ovOnSus, { n: v }));
  const susB = sumClasses(d, "buildings");
  const susH = sumClasses(d, "hospitals");
  const susS = sumClasses(d, "schools");
  const susR = sumClasses(d, "road_km");

  return (
    <div className="space-y-2" data-testid="overview-tiles">
      <dl className="grid grid-cols-2 gap-2">
        <Tile lang={lang} testId="tile-tambons" Icon={Layers} label={tr.ovTileTambons} value={`${nf.format(totals.triggered)} / ${nf.format(totals.tambons_total)}`} progress={totals.tambons_total ? totals.triggered / totals.tambons_total : 0} />
        <Tile lang={lang} testId="tile-provinces" Icon={MapIcon} label={tr.ovTileProvinces} value={`${nf.format(totals.provinces_triggered)} / ${nf.format(totals.provinces_total)}`} progress={totals.provinces_total ? totals.provinces_triggered / totals.provinces_total : 0} />
        {susPeople != null && (
          <Tile lang={lang} testId="tile-people-sus" Icon={Users} label={tr.ovTilePeopleSus} sub={tr.ovTilePeopleSusSub} title={nf.format(susPeople)}
            value={fmtRounded(susPeople, lang, { compact: true, approx: true })} />
        )}
        <Tile lang={lang} testId="tile-people-elev" Icon={TriangleAlert} label={tr.ovTilePeopleElev} sub={tr.ovTilePeopleElevSub}
          title={elev == null ? tr.na : elev > 0 && elev < 100 ? tr.ovFewPeople : nf.format(elev)}
          value={elev == null ? null : fmtRounded(elev, lang, { compact: true, approx: true })} />
      </dl>
      {el && (
        <>
          <h3 className={cn(H3, "pt-1")}>{tr.ovInfraTitle}</h3>
          <dl className="grid grid-cols-2 gap-2">
            <Tile lang={lang} testId="tile-buildings" Icon={Building2} label={tr.ovTileBuildings} value={fmtRounded(el.buildings, lang, { compact: true, approx: true })} title={nf.format(el.buildings)}
              sub={onSus(susB == null ? null : fmtRounded(susB, lang, { compact: true, approx: true }))} />
            <Tile lang={lang} testId="tile-hospitals" Icon={Hospital} label={tr.ovTileHospitals} value={nf.format(el.hospitals)} sub={onSus(susH == null ? null : fmtCount(susH, lang))} />
            <Tile lang={lang} testId="tile-schools" Icon={GraduationCap} label={tr.ovTileSchools} value={nf.format(el.schools)} sub={onSus(susS == null ? null : fmtCount(susS, lang))} />
            <Tile lang={lang} testId="tile-roads" Icon={Route} label={tr.ovTileRoads} value={fmtKm(el.road_km, lang, true)} sub={onSus(susR == null ? null : fmtKm(susR, lang, true))} />
          </dl>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- trend

interface TrendRow { i: number; h: number; date: string; v: number }

function Spark({ lang, title, rows, day, onDay, valueText }: { lang: Lang; title: string; rows: TrendRow[]; day: number; onDay: (h: number) => void; valueText: string }) {
  const vs = rows.map((r) => r.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = Math.max((hi - lo) * 0.25, hi * 0.05, 1);
  const cur = rows.find((r) => r.h === day) ?? rows[0];
  return (
    <div>
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{title}</span>
        <span className="shrink-0 font-semibold tabular-nums" data-testid="trend-value">{valueText}</span>
      </p>
      <div role="img" aria-label={`${title}: ${rows.map((r) => `${shortDate(r.date, lang)} ${numFmt(lang).format(r.v)}`).join(", ")}`} className="h-10 w-full cursor-pointer" data-testid="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 6, right: 0, bottom: 6, left: 0 }}
            onClick={(st) => {
              const i = Number(st?.activeTooltipIndex);
              if (Number.isInteger(i) && rows[i]) onDay(rows[i].h);
            }}
          >
            <CartesianGrid vertical={false} horizontal={false} />
            <XAxis type="number" dataKey="i" domain={[-0.5, rows.length - 0.5]} hide />
            <YAxis hide domain={[Math.max(0, lo - pad), hi + pad]} width={0} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as TrendRow | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
                    <div className="font-medium">{dayHeading(r.h, r.date, lang)}</div>
                    <div className="tabular-nums">{numFmt(lang).format(r.v)}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine x={cur.i} stroke="var(--primary)" strokeOpacity={0.45} />
            <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} isAnimationActive={false}
              dot={{ r: 2.5, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 1.5 }} activeDot={{ r: 4, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }} />
            <ReferenceDot x={cur.i} y={cur.v} r={5} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} ifOverflow="visible" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Trend({ lang, series, day, onDay }: { lang: Lang; series: OverviewSeries; day: number; onDay: (h: number) => void }) {
  const tr = t(lang);
  const nf = numFmt(lang);
  const tam: TrendRow[] = series.days.map((x, i) => ({ i, h: x.h, date: x.date, v: x.totals.triggered }));
  const ppl: TrendRow[] = series.days.flatMap((x, i) => (x.totals.people_elevated == null ? [] : [{ i, h: x.h, date: x.date, v: x.totals.people_elevated }]));
  const at = (rows: TrendRow[]) => rows.find((r) => r.h === day);
  return (
    <div role="group" aria-label={tr.ovTrendTitle} className="space-y-1.5" data-testid="overview-trend">
      <Spark lang={lang} title={tr.ovTrendTambons} rows={tam} day={day} onDay={onDay} valueText={at(tam) ? nf.format(at(tam)!.v) : "—"} />
      {ppl.length === series.days.length && (
        <Spark lang={lang} title={tr.ovTrendPeople} rows={ppl} day={day} onDay={onDay} valueText={at(ppl) ? fmtRounded(at(ppl)!.v, lang, { compact: true, approx: true }) : "—"} />
      )}
      <div className="grid grid-cols-[repeat(var(--n),minmax(0,1fr))] coarse:grid-cols-[repeat(var(--n),minmax(2.75rem,1fr))]" style={{ "--n": series.days.length } as CSSProperties} role="group" aria-label={tr.ovDay}>
        {series.days.map((x) => (
          <button
            key={x.h}
            type="button"
            aria-pressed={x.h === day}
            aria-label={fmt(tr.ovTrendDay, { date: dayHeading(x.h, x.date, lang) })}
            onClick={() => onDay(x.h)}
            data-testid={`trend-day-${x.h}`}
            className={cn("min-h-8 truncate rounded-[4px] px-0.5 text-center text-xs leading-tight coarse:min-h-11 text-muted-foreground tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", x.h === day && "bg-accent font-semibold text-foreground")}
          >
            {shortDate(x.date, lang)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{tr.ovTrendHint}</p>
    </div>
  );
}

// ---------------------------------------------------------------- breakdown charts

const METRIC_LABEL: Record<DashMetric, keyof Dict> = { people: "ovmPeople", buildings: "ovmBuildings", roads: "ovmRoads", facilities: "ovmFacilities", tambons: "ovmTambons" };
const A_TITLE: Record<DashMetric, keyof Dict> = { people: "ovAPeople", buildings: "ovABuildings", roads: "ovARoads", facilities: "ovAFacilities", tambons: "ovATambons" };
const C_TITLE: Record<DashMetric, keyof Dict> = { people: "ovCPeople", buildings: "ovCBuildings", roads: "ovCRoads", facilities: "ovCFacilities", tambons: "ovCTambons" };

function MetricSwitch({ lang, value, options, onChange }: { lang: Lang; value: DashMetric; options: DashMetric[]; onChange: (m: DashMetric) => void }) {
  const tr = t(lang);
  return (
    <div role="group" aria-label={tr.ovShowBy} className="flex flex-wrap gap-1">
      {options.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          data-testid={`dash-metric-${m}`}
          className={cn(
            "min-h-8 min-w-fit flex-1 basis-20 rounded-[4px] border px-2 py-1 text-center text-xs leading-tight font-medium coarse:min-h-11 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
          )}
        >
          {tr[METRIC_LABEL[m]]}
        </button>
      ))}
    </div>
  );
}

/** Value text of a class/province row for a metric. */
function valueText(v: number, metric: DashMetric, lang: Lang) {
  if (metric === "people" || metric === "buildings") return fmtRounded(v, lang);
  if (metric === "roads") return fmtKm(v, lang);
  return numFmt(lang).format(v);
}

/** One horizontal bar: linear scale, exact value in the label, a minimum visible width for tiny non-zero values. */
function Bar({ pct, color, ring }: { pct: number; color: string; ring?: boolean }) {
  return (
    <span className="relative block h-3.5 overflow-hidden rounded-[3px] bg-muted" aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${pct * 100}%`, minWidth: pct > 0 ? 4 : 0, background: color, boxShadow: ring ? RING : undefined }} />
    </span>
  );
}

function ClassChart({ lang, d, metric }: { lang: Lang; d: OverviewDay; metric: DashMetric }) {
  const tr = t(lang);
  const rows: BarRow[] = classRows(d, metric, lang);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div data-testid="overview-class-chart" data-metric={metric}>
      <h3 className={H3}>{tr[A_TITLE[metric]]}</h3>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.75rem] items-center gap-2 text-xs" data-testid="class-row">
            <span className="truncate" title={r.label}>{r.label}</span>
            <Bar pct={max > 0 ? r.value / max : 0} color={r.color} ring={r.ring} />
            <span className="text-right font-medium tabular-nums" data-testid="class-value" data-value={r.value}>{valueText(r.value, metric, lang)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProvinceChart({ lang, d, metric, onSelect }: { lang: Lang; d: OverviewDay; metric: DashMetric; onSelect: (pcode: string) => void }) {
  const tr = t(lang);
  const rows = provinceRows(d, metric, lang);
  const max = metric === "tambons" ? 1 : Math.max(...rows.map((r) => r.value), 0);
  return (
    <div data-testid="overview-province-chart" data-metric={metric}>
      <h3 className={H3}>{tr.ovTop10} <span className="font-normal">· {tr[C_TITLE[metric]]}</span></h3>
      {rows.length === 0 ? (
        <p className="mt-1.5 rounded-[4px] border border-dashed px-2.5 py-2 text-xs text-muted-foreground">{tr.ovCEmpty}</p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-0.5">
            {rows.map(({ pcode, name, value, p }) => {
              const text = metric === "tambons" ? fmt(tr.ovCTambonsOf, { n: numFmt(lang).format(p.triggered), m: numFmt(lang).format(p.tambons) }) : valueText(value, metric, lang);
              const risk = p.risk_class >= 1 ? ` · ${riskName(p.risk_class, lang)}` : "";
              return (
                <li key={pcode}>
                  <button
                    type="button"
                    onClick={() => onSelect(pcode)}
                    aria-label={fmt(tr.ovSelect, { name })}
                    title={`${name}${risk} · ${text}`}
                    data-testid="overview-top-row"
                    data-pcode={pcode}
                    className="grid min-h-8 w-full grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-[4px] px-1 py-1 text-left text-xs coarse:min-h-11 outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate font-medium">{name}</span>
                    <Bar pct={max > 0 ? value / max : 0} color={p.risk_class >= 1 ? riskColor(p.risk_class) : "color-mix(in oklab, var(--muted-foreground) 55%, transparent)"} ring />
                    <span className="min-w-[3.25rem] text-right tabular-nums" data-testid="top-value" data-value={value}>{text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
            <span>{tr.ovRiskKey}:</span>
            {RISK_COLORS.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-[2px]" style={{ background: c, boxShadow: RING }} aria-hidden />
                {riskName(i + 1, lang)}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
