/** The opening paragraph of a report, written from the numbers the API sent. A value the API left out is left out of the text, never shown as 0. */
import type { Kpis, Lang, OverviewDay } from "./types.ts";

const nf = (lang: Lang) => new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US");

export function scenarioSummary(k: Kpis, area: string, lang: Lang): string {
  const n = nf(lang);
  const th = lang === "th";
  const what = k.kind === "forecast"
    ? (th ? `พยากรณ์ฝน ${k.horizon_days ?? ""} วันข้างหน้า` : `the ${k.horizon_days ?? ""}-day rainfall forecast`)
    : (th ? `ฝน ${n.format(k.rainfall_mm ?? 0)} มม. ใน ${n.format(k.duration_h ?? 0)} ชม.` : `${n.format(k.rainfall_mm ?? 0)} mm of rain over ${n.format(k.duration_h ?? 0)} hours`);
  const parts: string[] = [th ? `สำหรับ${area} ภายใต้${what}` : `For ${area} under ${what}`];
  const ex = k.extras;
  if (ex?.triggered_tambons != null && ex.tambons_total != null)
    parts.push(th ? `${n.format(ex.triggered_tambons)} จาก ${n.format(ex.tambons_total)} ตำบลมีฝนเกินเกณฑ์บนพื้นที่ที่ดินถล่มได้`
                  : `${n.format(ex.triggered_tambons)} of ${n.format(ex.tambons_total)} tambons are above their rainfall trigger on ground that can slide`);
  const found: string[] = [];
  if (k.people != null) found.push(th ? `ประชากรประมาณ ${n.format(k.people)} คน` : `about ${n.format(k.people)} people`);
  if (k.buildings != null) found.push(th ? `อาคารประมาณ ${n.format(k.buildings)} หลัง` : `about ${n.format(k.buildings)} buildings`);
  if (k.hospitals != null) found.push(th ? `โรงพยาบาล ${n.format(k.hospitals)} แห่ง` : `${n.format(k.hospitals)} hospitals`);
  if (k.schools != null) found.push(th ? `โรงเรียน ${n.format(k.schools)} แห่ง` : `${n.format(k.schools)} schools`);
  if (found.length) parts.push(th ? `ในพื้นที่เสี่ยงระดับปานกลางขึ้นไปมี${found.join(" ")}` : `The moderate-or-higher risk zone holds ${found.join(", ")}`);
  else if (ex?.triggered_tambons === 0) parts.push(th ? "ไม่พบพื้นที่เสี่ยงระดับปานกลางขึ้นไป" : "No moderate-or-higher risk zone was found");
  return parts.join(th ? " " : ". ") + ".";
}

export function overviewSummary(d: OverviewDay, dateLabel: string, lang: Lang): string {
  const n = nf(lang);
  const th = lang === "th";
  const t = d.totals;
  const parts: string[] = [];
  if (t.triggered === 0) parts.push(th ? `${dateLabel}: ไม่มีตำบลที่ฝนเกินเกณฑ์บนพื้นที่ที่ดินถล่มได้` : `${dateLabel}: no tambon is above its rainfall trigger on ground that can slide`);
  else parts.push(th ? `${dateLabel}: ${n.format(t.triggered)} จาก ${n.format(t.tambons_total)} ตำบลใน ${n.format(t.provinces_triggered)} จังหวัดมีฝนเกินเกณฑ์บนพื้นที่ที่ดินถล่มได้`
                     : `${dateLabel}: ${n.format(t.triggered)} of ${n.format(t.tambons_total)} tambons in ${n.format(t.provinces_triggered)} provinces are above their rainfall trigger on ground that can slide`);
  if (t.people_elevated != null && t.triggered > 0) parts.push(th ? `ประชากรประมาณ ${n.format(t.people_elevated)} คนอยู่ในพื้นที่เสี่ยงระดับปานกลางขึ้นไป` : `About ${n.format(t.people_elevated)} people live in the moderate-or-higher risk zone`);
  return parts.join(th ? " " : ". ") + ".";
}

export interface PriorityRow { name: string; place: string; risk: number; people: number; className: string }

/** Three or four plain sentences a reader can lift out of the report; every figure comes from the rows passed in. */
export function scenarioTakeaways(rows: PriorityRow[], moderatePlus: number, fac: { hospitals?: number; schools?: number }, lang: Lang): string[] {
  const n = nf(lang);
  const th = lang === "th";
  const out: string[] = [];
  const top = rows[0];
  if (top) out.push(th ? `ความเสี่ยงสูงสุดอยู่ในระดับ${top.className} (${top.risk.toFixed(1)}) ที่ ${top.place}` : `Highest peak risk: ${top.className} (${top.risk.toFixed(1)}) in ${top.place}.`);
  if (moderatePlus > 0) out.push(th ? `${n.format(moderatePlus)} ตำบลมีความเสี่ยงสูงสุดระดับปานกลางขึ้นไป` : `${n.format(moderatePlus)} tambons reach a peak risk of Moderate or higher.`);
  const most = [...rows].sort((a, b) => b.people - a.people)[0];
  if (most && most.people > 0) out.push(th ? `ประชากรในพื้นที่เสี่ยงสูงมากที่สุดอยู่ที่ ${most.place} (ประมาณ ${n.format(most.people)} คน)` : `Most people in the elevated zone: ${most.place} (about ${n.format(most.people)}).`);
  const h = fac.hospitals ?? 0, s = fac.schools ?? 0;
  if (h + s > 0) out.push(th ? `โรงพยาบาล ${n.format(h)} แห่งและโรงเรียน ${n.format(s)} แห่งอยู่บนพื้นที่ที่ดินถล่มได้ในตำบลที่ฝนเกินเกณฑ์` : `${n.format(h)} hospitals and ${n.format(s)} schools sit on susceptible ground in tambons above their rainfall trigger.`);
  return out;
}

export function overviewTakeaways(top: { name: string; risk: number; className: string; people: number }[], lang: Lang): string[] {
  const n = nf(lang);
  const th = lang === "th";
  return top.slice(0, 3).map((p, i) => (th
    ? `${i + 1}. ${p.name}: ความเสี่ยงสูงสุดระดับ${p.className} (${p.risk.toFixed(1)})${p.people > 0 ? ` ประชากรในพื้นที่เสี่ยงสูงประมาณ ${n.format(p.people)} คน` : ""}`
    : `${i + 1}. ${p.name}: peak risk ${p.className} (${p.risk.toFixed(1)})${p.people > 0 ? `, about ${n.format(p.people)} people in the elevated zone` : ""}.`));
}
