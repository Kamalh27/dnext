"use client";

import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileDown, Pencil, X } from "lucide-react";
import { fetchOverviewReportData, fetchReportData, fetchTambonShapes } from "@/lib/api";
import { t } from "@/lib/i18n";
import { areaName, limitationsOf, pick } from "@/lib/lang";
import { dayHeading, numFmt, riskName, runLabel } from "@/lib/overview";
import { overviewSummary, scenarioSummary } from "@/lib/report-text";
import { classOfRisk } from "@/lib/svgmap";
import type { ChartData, Kpis, Lang, OverviewSeries, Province, ReportData, ReportFacility, TableData, TambonShapes } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ReportMap, type MapPoint, type MapShape } from "./report-map";
import { BarCard, TableCard } from "./result-cards";

export type ReportSource =
  | { mode: "scenario"; kpis: Kpis; charts: ChartData[]; tables: TableData[] }
  | { mode: "overview"; series: OverviewSeries; day: number };

/** Text the user can change before exporting: plain contenteditable, so what is on screen is what the PDF prints. */
function Editable({ as: Tag = "p", text, className }: { as?: ElementType; text: string; className?: string }) {
  return <Tag contentEditable suppressContentEditableWarning spellCheck={false} className={cn("report-edit rounded-sm outline-none", className)}>{text}</Tag>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="report-sec mt-6">
      <h2 className="mb-2 border-b border-neutral-300 pb-1 text-[15px] font-semibold text-emerald-800">{title}</h2>
      {children}
    </section>
  );
}

const facilityTable = (list: ReportFacility[], lang: Lang, withProvince: boolean): TableData | null => {
  if (!list.length) return null;
  const th = lang === "th";
  const kind = (k: string) => (th ? { hospital: "โรงพยาบาล", school: "โรงเรียน" }[k as "hospital" | "school"] ?? k : k === "hospital" ? "Hospital" : "School");
  const nm = (f: ReportFacility) => pick(lang, f.name, f.name_th);
  return {
    id: "report-facilities", title: th ? "โรงพยาบาลและโรงเรียนที่มีความเสี่ยง" : "Hospitals and schools at risk",
    columns: [th ? "ชื่อสถานที่" : "Name", th ? "ประเภท" : "Type", ...(withProvince ? [th ? "จังหวัด" : "Province"] : []), th ? "ตำบล" : "Tambon", th ? "ความเสี่ยง 0-5" : "Risk 0-5", th ? "ระดับ" : "Class"],
    rows: list.slice(0, 25).map((f) => [nm(f), kind(f.kind), ...(withProvince ? [pick(lang, f.province ?? "", f.province_th)] : []), pick(lang, f.tambon, f.tambon_th), f.risk,
      pick(lang, f.risk_class_name ?? "", f.risk_class_name_th)]),
  };
};

export function ReportModal({ lang, source, provinces, onClose }: { lang: Lang; source: ReportSource; provinces: Province[]; onClose: () => void }) {
  const tr = t(lang);
  const nf = numFmt(lang);
  const [data, setData] = useState<ReportData | null>(null);
  const [shapes, setShapes] = useState<TambonShapes | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const scenarioId = source.mode === "scenario" ? source.kpis.scenario_id : null;
  const areaCode = source.mode === "scenario" ? source.kpis.area_code?.slice(0, 4) : undefined;
  const day = source.mode === "overview" ? source.day : 0;

  useEffect(() => {
    let live = true;
    const load = scenarioId ? fetchReportData(scenarioId, lang) : fetchOverviewReportData(day, lang);
    load.then((d) => live && setData(d)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [scenarioId, day, lang]);
  useEffect(() => {
    if (!areaCode) return;
    let live = true;
    fetchTambonShapes(areaCode).then((s) => live && setShapes(s)).catch(() => {});   // the map falls back to the province outline
    return () => { live = false; };
  }, [areaCode]);

  // While open: Esc closes, the page behind does not scroll or print, and focus moves into the report.
  useEffect(() => {
    document.body.classList.add("report-open");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    root.current?.focus();
    return () => {
      document.body.classList.remove("report-open");
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const date = useMemo(() => new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { dateStyle: "long" }).format(new Date()), [lang]);

  // ---- what the document is made of, per mode
  let title = "", subtitle = "", summary = "", charts: ChartData[] = [], tables: TableData[] = [], limits: string[] = [], sources: string[] = [];
  let mapShapes: MapShape[] = [];
  let tiles: { label: string; value: string }[] = [];
  const points: MapPoint[] = (data?.facilities ?? []).filter((f) => f.kind === "hospital" || f.kind === "school").map((f) => ({ lat: f.lat, lng: f.lng, kind: f.kind, name: pick(lang, f.name, f.name_th) }));

  if (source.mode === "scenario") {
    const k = source.kpis;
    const area = areaName(k, lang);
    title = lang === "th" ? `รายงานความเสี่ยงดินถล่ม: ${area}` : `Landslide risk report: ${area}`;
    const when = k.kind === "forecast" ? (lang === "th" ? `พยากรณ์ ${k.horizon_days} วัน${k.model_run_time ? ` รอบ ${runLabel(k.model_run_time)}` : ""}` : `${k.horizon_days}-day forecast${k.model_run_time ? `, model run ${runLabel(k.model_run_time)}` : ""}`)
      : (lang === "th" ? `ฝน ${k.rainfall_mm} มม. ใน ${k.duration_h} ชม.` : `${k.rainfall_mm} mm over ${k.duration_h} h`);
    subtitle = `${when} · ${tr.dataDate}: ${k.date_of_data}`;
    summary = scenarioSummary(k, area, lang);
    charts = source.charts.filter((c) => c.data.length > 0);
    tables = source.tables;
    limits = [...new Set(limitationsOf(k, lang))];
    sources = k.data_sources;
    const cell = (v: number | null | undefined, approx = false) => (v == null ? "—" : `${approx ? "~" : ""}${nf.format(v)}`);
    tiles = [
      { label: tr.kpiPeople, value: cell(k.people, true) }, { label: tr.kpiHouseholds, value: cell(k.households_est, true) },
      { label: tr.kpiBuildings, value: cell(k.buildings, true) }, { label: tr.kpiRoads, value: cell(k.road_km) },
      { label: tr.kpiSchools, value: cell(k.schools) }, { label: tr.kpiHospitals, value: cell(k.hospitals) },
    ];
    const risks = new Map((data?.tambon_risks ?? []).map((r) => [r.code, r.risk]));
    if (shapes) mapShapes = Object.entries(shapes.tambons).map(([code, geometry]) => ({ key: code, geometry, cls: classOfRisk(risks.get(code) ?? 0) }));
    else {
      const p = provinces.find((x) => x.pcode === areaCode);
      if (p) mapShapes = [{ key: p.pcode, geometry: p.geometry, cls: 0 }];
    }
  } else {
    const d = source.series.days.find((x) => x.h === source.day) ?? source.series.days[0];
    const heading = d ? dayHeading(d.h, d.date, lang) : "";
    title = lang === "th" ? "ภาพรวมความเสี่ยงดินถล่มระดับประเทศ" : "National landslide risk overview";
    subtitle = `${heading} · ${tr.dataDate}: ${source.series.date_of_data}${d && d.h > 0 && source.series.model_run_time ? ` · ${runLabel(source.series.model_run_time)}` : ""}`;
    if (d) {
      summary = overviewSummary(d, heading, lang);
      const th = lang === "th";
      const risky = d.provinces.filter((p) => p.risk_class > 0);
      const byName = (p: (typeof d.provinces)[number]) => pick(lang, p.name ?? p.pcode, p.name_th);
      charts = [
        ...(d.provinces.some((p) => p.people_elevated > 0) ? [{
          id: "ov-people", kind: "bar" as const, title: th ? "จังหวัดที่มีประชากรในพื้นที่เสี่ยงสูงมากที่สุด" : "Provinces with the most people in the elevated zone",
          x_label: th ? "จังหวัด" : "Province", y_label: th ? "คน (ประมาณ)" : "People (est.)",
          data: [...d.provinces].filter((p) => p.people_elevated > 0).sort((a, b) => b.people_elevated - a.people_elevated).slice(0, 10).map((p) => ({ label: p.name ?? p.pcode, label_th: p.name_th, value: p.people_elevated })),
        }] : []),
      ];
      tables = [{
        id: "ov-provinces", title: th ? "จังหวัดเรียงตามความเสี่ยงสูงสุด" : "Provinces ranked by peak risk",
        columns: [th ? "จังหวัด" : "Province", th ? "ระดับ" : "Class", th ? "ความเสี่ยงสูงสุด 0-5" : "Peak risk 0-5", th ? "ตำบลที่เกินเกณฑ์" : "Tambons triggered", th ? "ประชากรในพื้นที่เสี่ยงสูง" : "People in elevated zone"],
        rows: [...risky].sort((a, b) => b.risk_max - a.risk_max || b.people_elevated - a.people_elevated).slice(0, 25)
          .map((p) => [byName(p), riskName(p.risk_class, lang), p.risk_max, `${nf.format(p.triggered)} / ${nf.format(p.tambons)}`, p.people_elevated]),
      }];
      mapShapes = provinces.map((p) => ({ key: p.pcode, geometry: p.geometry, cls: d.provinces.find((x) => x.pcode === p.pcode)?.risk_class ?? 0 }));
      const el = d.elevated;
      const cell = (v: number | null | undefined, approx = false) => (v == null ? "—" : `${approx ? "~" : ""}${nf.format(v)}`);
      tiles = [
        { label: tr.kpiTriggered, value: `${nf.format(d.totals.triggered)} / ${nf.format(d.totals.tambons_total)}` },
        { label: th ? "จังหวัดที่มีตำบลเกินเกณฑ์" : "Provinces with a triggered tambon", value: `${nf.format(d.totals.provinces_triggered)} / ${nf.format(d.totals.provinces_total)}` },
        { label: tr.kpiPeople, value: cell(d.totals.people_elevated, true) },
        ...(el ? [{ label: tr.kpiBuildings, value: cell(el.buildings, true) }, { label: tr.kpiHospitals, value: cell(el.hospitals) }, { label: tr.kpiSchools, value: cell(el.schools) }] : []),
      ];
    }
    limits = data?.limitations ?? [];
  }
  const facTable = facilityTable(data?.facilities ?? [], lang, source.mode === "overview");
  if (facTable && !tables.some((x) => x.id.includes("facilities"))) tables = [...tables, facTable];
  const g = data?.guidance;
  const mapLabel = source.mode === "scenario" ? (lang === "th" ? "แผนที่ความเสี่ยงระดับตำบล" : "Tambon risk map") : (lang === "th" ? "แผนที่ความเสี่ยงระดับจังหวัด" : "Province risk map");

  return createPortal(
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr.reportTitle} data-testid="report-modal"
      className="report-root fixed inset-0 z-[60] overflow-y-auto bg-neutral-900/70 outline-none">
      <div className="report-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2 text-card-foreground shadow-sm">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{tr.reportTitle}</h2>
        <p className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"><Pencil className="size-3.5" aria-hidden />{tr.reportHint}</p>
        <button type="button" onClick={() => window.print()} data-testid="report-export"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
          <FileDown className="size-4" aria-hidden />{tr.reportExport}
        </button>
        <button type="button" onClick={onClose} aria-label={tr.close} title={tr.close}
          className="inline-flex size-9 items-center justify-center rounded-md border bg-background outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /></button>
      </div>

      <article className="report-doc mx-auto my-5 w-[min(100%-1.5rem,860px)] rounded bg-white p-6 text-[13px] leading-relaxed text-neutral-900 shadow-xl sm:p-9">
        <header>
          <p className="text-[11px] font-semibold tracking-wide text-emerald-800 uppercase">DNext</p>
          <Editable as="h1" text={title} className="mt-1 text-2xl font-semibold" />
          <p className="mt-1 text-xs text-neutral-600">{subtitle}</p>
          <p className="text-xs text-neutral-500">{lang === "th" ? `จัดทำเมื่อ ${date}` : `Prepared on ${date}`}</p>
        </header>

        {summary && <Section title={tr.reportSummary}><Editable text={summary} /></Section>}

        {mapShapes.length > 0 && (
          <Section title={tr.reportMap}>
            <ReportMap shapes={mapShapes} points={source.mode === "scenario" ? points : []} lang={lang} label={mapLabel} maxHeight={source.mode === "overview" ? 480 : 400} />
          </Section>
        )}

        {tiles.length > 0 && (
          <Section title={tr.reportFigures}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tiles.map((x) => (
                <div key={x.label} className="rounded border border-neutral-300 px-3 py-2">
                  <dt className="text-[11px] text-neutral-600">{x.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{x.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {charts.length > 0 && <Section title={tr.reportCharts}><div className="space-y-3">{charts.map((c) => <BarCard key={c.id} chart={c} lang={lang} />)}</div></Section>}
        {tables.length > 0 && <Section title={tr.reportTables}><div className="space-y-3">{tables.map((tb) => <TableCard key={tb.id} table={tb} lang={lang} />)}</div></Section>}

        {g && (
          <Section title={g.title}>
            <Editable text={g.note} className="mb-2 text-xs text-neutral-600 italic" />
            {g.sections.map(([heading, bullets]) => (
              <div key={heading} className="report-block mt-3">
                <Editable as="h3" text={heading} className="font-semibold" />
                <ul className="mt-1 list-disc space-y-1 pl-5">{bullets.map((b) => <Editable key={b} as="li" text={b} />)}</ul>
              </div>
            ))}
          </Section>
        )}
        {!data && !failed && <p className="mt-6 text-xs text-neutral-500" role="status">{tr.reportLoading}</p>}
        {failed && <p className="mt-6 text-xs text-red-700" role="alert">{tr.reportPartial}</p>}

        <Section title={tr.reportNotes}>
          <Editable text="" className="report-notes min-h-16 rounded border border-dashed border-neutral-300 p-2" />
        </Section>

        {limits.length > 0 && (
          <Section title={tr.limitations}>
            <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-700">{limits.map((s, i) => <Editable key={i} as="li" text={s} />)}</ul>
          </Section>
        )}
        {sources.length > 0 && (
          <Section title={tr.sources}>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-700">{sources.map((s) => <li key={s}>{s}</li>)}</ul>
          </Section>
        )}
        <footer className="mt-8 border-t border-neutral-300 pt-2 text-[11px] text-neutral-500">{tr.reportFooter}</footer>
      </article>
    </div>,
    document.body,
  );
}
