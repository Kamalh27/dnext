"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Building2, CalendarDays, CloudRain, FileDown, GraduationCap, Hospital, House, Info, ListChecks, MapPin, Map as MapIcon, Pencil, Route, ShieldCheck, Table2, TriangleAlert, Users, X } from "lucide-react";
import { fetchOverviewReportData, fetchReportData, fetchTambonShapes } from "@/lib/api";
import { t } from "@/lib/i18n";
import { areaName, limitationsOf, pick } from "@/lib/lang";
import { dayHeading, numFmt, riskName, runLabel } from "@/lib/overview";
import { dayRainScale, rain30Scale, riskClassScale, riskScale, shareScale, triggerScale } from "@/lib/report-maps";
import { overviewSummary, overviewTakeaways, scenarioSummary, scenarioTakeaways, type PriorityRow } from "@/lib/report-text";
import { classOfRisk } from "@/lib/svgmap";
import type { Kpis, Lang, OverviewSeries, Province, ReportData, ReportFacility, TambonShapes } from "@/lib/types";
import { Callout, Editable, KpiTile, BarList, ReportHeader, ReportTable, SectionHeading, type Cell } from "./report-parts";
import { ReportMap, type MapBadge, type MapPoint, type MapShape } from "./report-map";

export type ReportSource =
  | { mode: "scenario"; kpis: Kpis }
  | { mode: "overview"; series: OverviewSeries; day: number };

const ICON = "size-3.5";
const TILE = "size-[18px]";

export function ReportModal({ lang, source, provinces, onClose }: { lang: Lang; source: ReportSource; provinces: Province[]; onClose: () => void }) {
  const tr = t(lang);
  const th = lang === "th";
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
  const cell = (v: number | null | undefined, approx = false) => (v == null ? "—" : `${approx ? "~" : ""}${nf.format(v)}`);
  const facilities: ReportFacility[] = data?.facilities ?? [];
  const points: MapPoint[] = facilities.filter((f) => f.kind === "hospital" || f.kind === "school").map((f) => ({ lat: f.lat, lng: f.lng, kind: f.kind, name: pick(lang, f.name, f.name_th) }));
  const kindLabel = (k: string) => (th ? ({ hospital: "โรงพยาบาล", school: "โรงเรียน" } as Record<string, string>)[k] ?? k : k === "hospital" ? "Hospital" : "School");
  const facilityRows: (string | number | Cell)[][] = facilities.slice(0, 25).map((f, i) => [
    i + 1, pick(lang, f.name, f.name_th), kindLabel(f.kind), ...(source.mode === "overview" ? [pick(lang, f.province ?? "", f.province_th)] : []), pick(lang, f.tambon, f.tambon_th),
    f.risk, { text: pick(lang, f.risk_class_name ?? "", f.risk_class_name_th), chip: riskClassScale(lang).colorOf(f.risk_class) },
  ]);
  const facilityCols = ["#", th ? "ชื่อสถานที่" : "Name", th ? "ประเภท" : "Type", ...(source.mode === "overview" ? [th ? "จังหวัด" : "Province"] : []), th ? "ตำบล" : "Tambon", th ? "ความเสี่ยง 0-5" : "Risk 0-5", th ? "ระดับ" : "Class"];

  // ---- pieces of the document, per mode
  let title = "", summary = "", takeaways: string[] = [];
  let chips: { icon: React.ReactNode; text: string }[] = [];
  let tiles: { icon: React.ReactNode; label: string; value: string }[] = [];
  let mapMain: React.ReactNode = null;
  let mapExtra: React.ReactNode = null;
  let charts: React.ReactNode = null;
  let ranking: React.ReactNode = null;
  let limits: string[] = [], sources: string[] = [];
  let badgeNote = "";

  if (source.mode === "scenario") {
    const k = source.kpis;
    const area = areaName(k, lang);
    title = th ? `รายงานความเสี่ยงดินถล่ม: ${area}` : `Landslide risk report: ${area}`;
    const when = k.kind === "forecast"
      ? (th ? `พยากรณ์ ${k.horizon_days} วัน` : `${k.horizon_days}-day forecast`) + (k.model_run_time ? (th ? ` รอบ ${runLabel(k.model_run_time)}` : `, model run ${runLabel(k.model_run_time)}`) : "")
      : (th ? `ฝน ${k.rainfall_mm} มม. ใน ${k.duration_h} ชม.` : `${k.rainfall_mm} mm over ${k.duration_h} h`);
    chips = [{ icon: <MapPin className={ICON} />, text: area }, { icon: <CloudRain className={ICON} />, text: when },
      { icon: <CalendarDays className={ICON} />, text: `${tr.dataDate}: ${k.date_of_data}` }];
    summary = scenarioSummary(k, area, lang);
    limits = [...new Set(limitationsOf(k, lang))];
    sources = k.data_sources;
    tiles = [
      { icon: <Users className={TILE} />, label: tr.kpiPeople, value: cell(k.people, true) }, { icon: <House className={TILE} />, label: tr.kpiHouseholds, value: cell(k.households_est, true) },
      { icon: <Building2 className={TILE} />, label: tr.kpiBuildings, value: cell(k.buildings, true) }, { icon: <Route className={TILE} />, label: tr.kpiRoads, value: cell(k.road_km) },
      { icon: <GraduationCap className={TILE} />, label: tr.kpiSchools, value: cell(k.schools) }, { icon: <Hospital className={TILE} />, label: tr.kpiHospitals, value: cell(k.hospitals) },
    ];
    const tr_ = data?.tambon_risks ?? [];
    const rscale = riskScale(lang), rain = rain30Scale(lang), trig = triggerScale(lang);
    const ranked = [...tr_].filter((x) => x.risk > 0 || x.trigger > 0).sort((a, b) => b.risk - a.risk || (b.people ?? 0) - (a.people ?? 0) || (b.rain ?? 0) - (a.rain ?? 0)).slice(0, 10);
    const place = (x: (typeof tr_)[number]) => `${pick(lang, x.name ?? x.code, x.name_th)} (${pick(lang, x.amphoe ?? "", x.amphoe_th)})`;
    const priority: PriorityRow[] = ranked.filter((x) => x.risk > 0).map((x) => ({ name: pick(lang, x.name ?? x.code, x.name_th), place: place(x), risk: x.risk, people: x.people ?? 0, className: riskName(Math.max(1, classOfRisk(x.risk)), lang) }));
    takeaways = scenarioTakeaways(priority, tr_.filter((x) => x.risk >= 2).length, data?.facilities_named ?? {}, lang);
    const mk = (pick: (x: (typeof tr_)[number]) => number | null | undefined, sc: typeof rscale): MapShape[] =>
      shapes ? Object.entries(shapes.tambons).map(([code, geometry]) => ({ key: code, geometry, fill: sc.colorOf(pick(tr_.find((x) => x.code === code) ?? ({} as (typeof tr_)[number]))) })) : [];
    const outline = provinces.find((x) => x.pcode === areaCode);
    const riskShapes: MapShape[] = shapes ? mk((x) => x.risk, rscale) : outline ? [{ key: outline.pcode, geometry: outline.geometry, fill: "#e7e5e4" }] : [];
    const badges: MapBadge[] = priority.map((x, i) => ({ key: ranked[i].code, n: i + 1 }));
    badgeNote = badges.length ? (th ? "ตัวเลขบนแผนที่ตรงกับลำดับในตารางตำบลที่ควรให้ความสำคัญ" : "Numbers on the map match the priority tambons table.") : "";
    if (riskShapes.length) {
      mapMain = <ReportMap title={th ? "ความเสี่ยงสูงสุดระดับตำบล" : "Peak landslide risk by tambon"} shapes={riskShapes} legend={rscale.legend} points={points} badges={badges} lang={lang} width={340} maxHeight={480} />;
      if (shapes && tr_.length > 0) {
        mapExtra = (
          <div className="grid gap-4 sm:grid-cols-2">
            <ReportMap title={th ? "ฝนสะสม 30 วัน" : "30-day rainfall"} shapes={mk((x) => x.rain, rain)} legend={rain.legend} lang={lang} width={360} maxHeight={300} noneLabel={false} />
            <ReportMap title={th ? "ระดับตัวกระตุ้นจากฝน" : "Rainfall trigger class"} shapes={mk((x) => x.trigger, trig)} legend={trig.legend} lang={lang} width={360} maxHeight={300} noneLabel={false} />
          </div>
        );
      }
    }
    const peopleRows = ranked.filter((x) => (x.people ?? 0) > 0).sort((a, b) => (b.people ?? 0) - (a.people ?? 0)).slice(0, 10);
    const trigCounts = [0, 1, 2, 3, 4, 5].map((c) => tr_.filter((x) => x.trigger === c).length);
    charts = (
      <div className="grid gap-5 sm:grid-cols-2">
        {peopleRows.length > 0 && <BarList title={th ? "ประชากรในพื้นที่เสี่ยงสูง แยกตามตำบล (ประมาณ)" : "People in the elevated zone, by tambon (est.)"} rows={peopleRows.map((x) => ({ label: pick(lang, x.name ?? x.code, x.name_th), value: x.people ?? 0 }))} />}
        {tr_.length > 0 && <BarList title={th ? "จำนวนตำบลแยกตามระดับตัวกระตุ้นจากฝน" : "Number of tambons by rainfall trigger class"} rows={trigCounts.map((v, c) => ({ label: th ? `ระดับ ${c}` : `Class ${c}`, value: v, color: triggerScale(lang).colorOf(c) === "#e7e5e4" ? "#a8a29e" : triggerScale(lang).colorOf(c) }))} />}
      </div>
    );
    ranking = ranked.length > 0 && (
      <ReportTable title={th ? "ตำบลที่ควรให้ความสำคัญ (เรียงตามความเสี่ยงสูงสุด)" : "Priority tambons (ranked by peak risk)"} numeric={[3, 4, 5, 6]}
        columns={["#", th ? "ตำบล (อำเภอ)" : "Tambon (amphoe)", th ? "ระดับ" : "Class", th ? "ฝน 30 วัน (มม.)" : "Rain 30 d (mm)", th ? "ความเสี่ยง 0-5" : "Peak risk 0-5", th ? "ตัวกระตุ้น 0-5" : "Trigger 0-5", th ? "ประชากร (ประมาณ)" : "People (est.)"]}
        rows={ranked.map((x, i) => [i + 1, place(x), { text: x.risk > 0 ? riskName(Math.max(1, classOfRisk(x.risk)), lang) : "—", chip: rscale.colorOf(x.risk) }, x.rain == null ? "—" : nf.format(x.rain), x.risk, x.trigger, x.people == null ? "—" : nf.format(x.people)])} />
    );
  } else {
    const d = source.series.days.find((x) => x.h === source.day) ?? source.series.days[0];
    const heading = d ? dayHeading(d.h, d.date, lang) : "";
    title = th ? "ภาพรวมความเสี่ยงดินถล่มระดับประเทศ" : "National landslide risk overview";
    chips = [{ icon: <CalendarDays className={ICON} />, text: heading }, { icon: <MapPin className={ICON} />, text: th ? "ประเทศไทย 77 จังหวัด" : "Thailand, 77 provinces" },
      { icon: <CloudRain className={ICON} />, text: `${tr.dataDate}: ${source.series.date_of_data}${d && d.h > 0 && source.series.model_run_time ? ` · ${runLabel(source.series.model_run_time)}` : ""}` }];
    limits = data?.limitations ?? [];
    sources = ["Landslide susceptibility, vulnerability, exposure and tambon rainfall thresholds (ADPC)", "JAXA GSMaP, NOAA GFS", "WorldPop 2020, JRC GHSL, OpenStreetMap"];
    if (d) {
      summary = overviewSummary(d, heading, lang);
      const el = d.elevated;
      tiles = [
        { icon: <CloudRain className={TILE} />, label: tr.kpiTriggered, value: `${nf.format(d.totals.triggered)} / ${nf.format(d.totals.tambons_total)}` },
        { icon: <MapPin className={TILE} />, label: th ? "จังหวัดที่มีตำบลเกินเกณฑ์" : "Provinces with a triggered tambon", value: `${nf.format(d.totals.provinces_triggered)} / ${nf.format(d.totals.provinces_total)}` },
        { icon: <Users className={TILE} />, label: tr.kpiPeople, value: cell(d.totals.people_elevated, true) },
        ...(el ? [{ icon: <Building2 className={TILE} />, label: tr.kpiBuildings, value: cell(el.buildings, true) }, { icon: <Hospital className={TILE} />, label: tr.kpiHospitals, value: cell(el.hospitals) },
          { icon: <GraduationCap className={TILE} />, label: tr.kpiSchools, value: cell(el.schools) }] : []),
      ];
      const pname = (p: (typeof d.provinces)[number]) => pick(lang, p.name ?? p.pcode, p.name_th);
      const ranked = [...d.provinces].filter((p) => p.risk_class > 0).sort((a, b) => b.risk_max - a.risk_max || b.people_elevated - a.people_elevated).slice(0, 25);
      takeaways = overviewTakeaways(ranked.slice(0, 3).map((p) => ({ name: pname(p), risk: p.risk_max, className: riskName(p.risk_class, lang), people: p.people_elevated })), lang);
      const byCode = new Map(d.provinces.map((p) => [p.pcode, p]));
      const mk = (sc: { colorOf: (v: number | null | undefined) => string }, val: (p: (typeof d.provinces)[number]) => number | null): MapShape[] =>
        provinces.map((p) => { const dp = byCode.get(p.pcode); return { key: p.pcode, geometry: p.geometry, fill: sc.colorOf(dp ? val(dp) : null) }; });
      const rscale = riskClassScale(lang), rain = dayRainScale(lang), share = shareScale(lang);
      const badges: MapBadge[] = ranked.slice(0, 10).map((p, i) => ({ key: p.pcode, n: i + 1 }));
      badgeNote = th ? "ตัวเลขบนแผนที่ตรงกับลำดับในตารางจังหวัด" : "Numbers on the map match the provinces table.";
      mapMain = <ReportMap title={th ? "ความเสี่ยงสูงสุดระดับจังหวัด" : "Peak landslide risk by province"} shapes={mk(rscale, (p) => p.risk_class)} legend={rscale.legend} badges={badges} lang={lang} width={340} maxHeight={520} />;
      mapExtra = (
        <div className="grid gap-4 sm:grid-cols-2">
          <ReportMap title={th ? "ฝนเฉลี่ยของวัน" : "Mean rain of the day"} shapes={mk(rain, (p) => p.rain_mm)} legend={rain.legend} lang={lang} width={300} maxHeight={400} noneLabel={false} />
          <ReportMap title={th ? "สัดส่วนตำบลที่ฝนเกินเกณฑ์" : "Share of tambons above their trigger"} shapes={mk(share, (p) => p.triggered_share)} legend={share.legend} lang={lang} width={300} maxHeight={400} noneLabel={false} />
        </div>
      );
      const peopleRows = [...d.provinces].filter((p) => p.people_elevated > 0).sort((a, b) => b.people_elevated - a.people_elevated).slice(0, 10);
      const tc = d.trigger_classes ?? [];
      charts = (
        <div className="grid gap-5 sm:grid-cols-2">
          {peopleRows.length > 0 && <BarList title={th ? "จังหวัดที่มีประชากรในพื้นที่เสี่ยงสูงมากที่สุด" : "Provinces with the most people in the elevated zone"} rows={peopleRows.map((p) => ({ label: pname(p), value: p.people_elevated }))} />}
          {tc.length === 6 && <BarList title={th ? "จำนวนตำบลแยกตามระดับตัวกระตุ้นจากฝน" : "Number of tambons by rainfall trigger class"} rows={tc.map((v, c) => ({ label: th ? `ระดับ ${c}` : `Class ${c}`, value: v, color: c === 0 ? "#a8a29e" : triggerScale(lang).colorOf(c) }))} />}
        </div>
      );
      ranking = ranked.length > 0 && (
        <ReportTable title={th ? "จังหวัดเรียงตามความเสี่ยงสูงสุด" : "Provinces ranked by peak risk"} numeric={[3, 4, 5]}
          columns={["#", th ? "จังหวัด" : "Province", th ? "ระดับ" : "Class", th ? "ความเสี่ยง 0-5" : "Peak risk 0-5", th ? "ตำบลที่เกินเกณฑ์" : "Tambons triggered", th ? "ประชากร (ประมาณ)" : "People (est.)"]}
          rows={ranked.map((p, i) => [i + 1, pname(p), { text: riskName(p.risk_class, lang), chip: rscale.colorOf(p.risk_class) }, p.risk_max, `${nf.format(p.triggered)} / ${nf.format(p.tambons)}`, nf.format(p.people_elevated)])} />
      );
    }
  }
  const g = data?.guidance;
  let n = 0;
  const next = () => ++n;

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
        <ReportHeader title={title} chips={chips} prepared={th ? `จัดทำเมื่อ ${date}` : `Prepared on ${date}`} />

        <div className="mt-6 grid gap-x-7 gap-y-6 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            {(summary || takeaways.length > 0) && (
              <section className="report-sec">
                <SectionHeading icon={<Info className={ICON} />} n={next()} title={tr.reportSummary} />
                <Editable text={summary} />
                {takeaways.length > 0 && (
                  <div className="mt-3">
                    <Callout icon={<ListChecks className="size-4 text-primary" />} title={th ? "ประเด็นสำคัญ" : "Key takeaways"}>
                      <ul className="list-disc space-y-1 pl-5">{takeaways.map((x) => <Editable key={x} as="li" text={x} />)}</ul>
                    </Callout>
                  </div>
                )}
              </section>
            )}
            {tiles.length > 0 && (
              <section className="report-sec">
                <SectionHeading icon={<Users className={ICON} />} n={next()} title={tr.reportFigures} />
                <dl className="grid grid-cols-2 gap-2.5">{tiles.map((x) => <KpiTile key={x.label} icon={x.icon} label={x.label} value={x.value} />)}</dl>
              </section>
            )}
          </div>
          {mapMain && (
            <section className="report-sec min-w-0">
              <SectionHeading icon={<MapIcon className={ICON} />} n={next()} title={tr.reportMap} />
              {mapMain}
              {badgeNote && <p className="mt-2 text-[11px] text-neutral-600">{badgeNote}</p>}
            </section>
          )}
        </div>

        {mapExtra && (
          <section className="report-sec mt-6">
            <SectionHeading icon={<CloudRain className={ICON} />} n={next()} title={th ? "ฝนและตัวกระตุ้น" : "Rainfall and trigger"} />
            {mapExtra}
          </section>
        )}

        {charts && <section className="report-sec mt-6"><SectionHeading icon={<BarChart3 className={ICON} />} n={next()} title={tr.reportCharts} />{charts}</section>}

        {(ranking || facilityRows.length > 0) && (
          <section className="report-sec mt-6">
            <SectionHeading icon={<Table2 className={ICON} />} n={next()} title={tr.reportTables} />
            <div className="space-y-5">
              {ranking}
              {facilityRows.length > 0 && (
                <ReportTable title={`${th ? "โรงพยาบาลและโรงเรียนที่มีความเสี่ยง" : "Hospitals and schools at risk"} (${data?.facilities_named?.hospitals ?? 0} ${th ? "โรงพยาบาล" : "hospitals"}, ${data?.facilities_named?.schools ?? 0} ${th ? "โรงเรียน" : "schools"})`}
                  columns={facilityCols} rows={facilityRows} numeric={[facilityCols.length - 2]} />
              )}
            </div>
          </section>
        )}

        {g && (
          <section className="report-sec mt-6">
            <SectionHeading icon={<ShieldCheck className={ICON} />} n={next()} title={g.title} />
            <Callout icon={<TriangleAlert className="size-4 text-amber-600" />} title={th ? "โปรดทราบ" : "Please note"} tone="note"><Editable text={g.note} className="text-[12px]" /></Callout>
            <div className="mt-3 grid gap-3">
              {g.sections.map(([heading, bullets]) => (
                <div key={heading} className="report-block rounded-lg border border-neutral-300 px-4 py-3">
                  <Editable as="h3" text={heading} className="font-semibold text-primary" />
                  <ul className="mt-1 list-disc space-y-1 pl-5">{bullets.map((b) => <Editable key={b} as="li" text={b} />)}</ul>
                </div>
              ))}
            </div>
          </section>
        )}
        {!data && !failed && <p className="mt-6 text-xs text-neutral-500" role="status">{tr.reportLoading}</p>}
        {failed && <p className="mt-6 text-xs text-red-700" role="alert">{tr.reportPartial}</p>}

        <section className="report-sec mt-6">
          <SectionHeading icon={<Pencil className={ICON} />} n={next()} title={tr.reportNotes} />
          <Editable text="" className="report-notes min-h-16 rounded border border-dashed border-neutral-300 p-2" />
        </section>

        {(limits.length > 0 || sources.length > 0) && (
          <section className="report-sec mt-6">
            <SectionHeading icon={<Info className={ICON} />} n={next()} title={`${tr.limitations} · ${tr.sources}`} />
            <div className="grid gap-4 text-[11px] text-neutral-700 sm:grid-cols-2">
              <ul className="list-disc space-y-1 pl-4">{limits.map((s, i) => <Editable key={i} as="li" text={s} />)}</ul>
              <ul className="list-disc space-y-0.5 pl-4">{sources.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </section>
        )}
        <footer className="mt-8 border-t border-neutral-300 pt-2 text-[10.5px] text-neutral-500">{tr.reportFooter}</footer>
      </article>
    </div>,
    document.body,
  );
}
