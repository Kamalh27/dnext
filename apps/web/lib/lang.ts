import type { ChartData, Kpis, KpiExtras, Lang, LegendItem, MapMarkers, TableData } from "./types";

/** English unless the UI is Thai AND a non-empty Thai variant exists. */
export function pick(lang: Lang, en: string, th?: string | null): string;
export function pick<T>(lang: Lang, en: T, th?: T | null): T;
export function pick<T>(lang: Lang, en: T, th?: T | null): T {
  return lang === "th" && th != null && (typeof th !== "string" || th.trim() !== "") ? th : en;
}

/** True when the text contains any Thai character (U+0E00 to U+0E7F). */
export const hasThai = (text: string) => /[฀-๿]/.test(text);

/** Name plus legend of a layer-like object, in the UI language. Other fields pass through. */
export function localLayer<L extends { name: string; name_th?: string; legend: LegendItem[] }>(l: L, lang: Lang): L {
  if (lang !== "th") return l;
  return { ...l, name: pick(lang, l.name, l.name_th), legend: l.legend.map((x) => ({ ...x, label: pick(lang, x.label, x.label_th) })) };
}

export const areaName = (k: Kpis, lang: Lang) => pick(lang, k.area_name, k.area_name_th);

/** Limitations, localized per item (a missing or short Thai list falls back item by item). */
export const limitationsOf = (k: Kpis, lang: Lang) => k.limitations.map((s, i) => pick(lang, s, k.limitations_th?.[i]));

export const extrasText = (ex: KpiExtras, lang: Lang) => ({
  triggerSource: pick(lang, ex.trigger_source ?? "", ex.trigger_source_th),
  rainWindow: pick(lang, ex.rain_window ?? "", ex.rain_window_th),
});

/** Table title, columns and rows in the UI language; Thai arrays are used only when their shape matches the English ones. */
export function localTable(tb: TableData, lang: Lang) {
  const cols = tb.columns_th && tb.columns_th.length === tb.columns.length ? tb.columns_th : undefined;
  const rows = tb.rows_th && tb.rows_th.length === tb.rows.length ? tb.rows_th : undefined;
  return {
    title: pick(lang, tb.title, tb.title_th),
    columns: pick(lang, tb.columns, cols),
    rows: pick(lang, tb.rows, rows),
  };
}

export const chartTexts = (c: ChartData, lang: Lang) => ({
  title: pick(lang, c.title, c.title_th),
  xLabel: pick(lang, c.x_label, c.x_label_th),
  yLabel: pick(lang, c.y_label, c.y_label_th),
});

const KIND_TH: Record<string, string> = { hospital: "โรงพยาบาล", school: "โรงเรียน", shelter: "ศูนย์พักพิง", bridge: "สะพาน" };

/** Hover text of a facility marker: the name, its type and, when the API sent it, the risk class. */
export function markerTitle(m: MapMarkers["markers"][number], lang: Lang): string {
  const kind = lang === "th" ? KIND_TH[m.kind] ?? m.kind : m.kind;
  const cls = pick(lang, m.risk_class_name ?? "", m.risk_class_name_th);
  return `${pick(lang, m.name, m.name_th)} (${kind}${cls ? `, ${cls}` : ""})`;
}
