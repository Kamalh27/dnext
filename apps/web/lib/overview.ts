import { fmt, t } from "./i18n";
import { pick } from "./lang";
import type { Lang, LegendItem, OverviewDay, OverviewProvinceDay } from "./types";

export type OverviewMetric = "risk" | "rain";
export const OVERVIEW_DAYS = 5;

/** "2026-10-13T06:00:00Z" -> "2026-10-13 06Z"; anything else is shown as sent. */
export const runLabel = (s: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2})/.exec(s);
  return m ? `${m[1]} ${m[2]}Z` : s;
};

/** DMR classes 1..5 (index 0 = class 1). Class 0 means nothing triggered / no susceptible ground. */
export const RISK_COLORS = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"] as const;
const RISK_NAMES = {
  en: ["Very low", "Low", "Moderate", "High", "Very high"],
  th: ["ต่ำมาก", "ต่ำ", "ปานกลาง", "สูง", "สูงมาก"],
} as const;
export const riskName = (cls: number, lang: Lang) => RISK_NAMES[lang][Math.min(Math.max(cls, 1), 5) - 1];
export const riskColor = (cls: number) => RISK_COLORS[Math.min(Math.max(cls, 1), 5) - 1];
/** Readable text colour on a risk-class background. */
export const riskTextOn = (cls: number) => (cls >= 4 ? "#ffffff" : "#1c1917");

/** Sequential light-to-dark blues for mean daily rain, bins <1, 1-5, 5-10, 10-20, 20-40, 40+ mm/day. */
export const RAIN_COLORS = ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"] as const;
const RAIN_LABELS = ["< 1", "1–5", "5–10", "10–20", "20–40", "40+"] as const;
const RAIN_EDGES = [1, 5, 10, 20, 40];
export const rainBin = (mm: number) => {
  const i = RAIN_EDGES.findIndex((e) => mm < e);
  return i < 0 ? RAIN_EDGES.length : i;
};

export interface Fill { color: string; opacity: number; /** class (risk) or bin (rain); -1 = neutral */ key: number }
const NEUTRAL: Fill = { color: "#a8a29e", opacity: 0.14, key: -1 };
export const RISK_OPACITY = 0.55;
export const RAIN_OPACITY = 0.6;

export function fillFor(metric: OverviewMetric, p: OverviewProvinceDay | undefined): Fill {
  if (!p) return NEUTRAL;
  if (metric === "risk") {
    return p.risk_class >= 1 ? { color: riskColor(p.risk_class), opacity: RISK_OPACITY, key: Math.min(p.risk_class, 5) } : { ...NEUTRAL, key: 0 };
  }
  if (p.rain_mm == null) return NEUTRAL;
  const b = rainBin(p.rain_mm);
  return { color: RAIN_COLORS[b], opacity: RAIN_OPACITY, key: b };
}

/** Per-province fills for one day and metric. */
export const fillsFor = (metric: OverviewMetric, provinces: OverviewProvinceDay[]) => new Map(provinces.map((p) => [p.pcode, fillFor(metric, p)]));

/** Debug summary of how many provinces fall in each class/bin, e.g. "r0:30,r4:7" (n = neutral). */
export function countsOf(metric: OverviewMetric, fills: Map<string, Fill>): string {
  const c: Record<string, number> = {};
  for (const f of fills.values()) {
    const k = f.key < 0 ? "n" : `${metric === "risk" ? "r" : "b"}${f.key}`;
    c[k] = (c[k] ?? 0) + 1;
  }
  return Object.keys(c).sort().map((k) => `${k}:${c[k]}`).join(",");
}

export function legendFor(metric: OverviewMetric, lang: Lang): { title: string; items: LegendItem[] } {
  const tr = t(lang);
  if (metric === "risk") {
    return {
      title: tr.ovLegendRisk,
      items: [
        { color: "#d6d3d1", label: tr.ovNone },
        ...RISK_COLORS.map((color, i) => ({ color, label: riskName(i + 1, lang) })),
      ],
    };
  }
  return { title: tr.ovLegendRain, items: RAIN_COLORS.map((color, i) => ({ color, label: `${RAIN_LABELS[i]} ${tr.ovMm}` })) };
}

/** "14 Oct" / "14 ต.ค." from a YYYY-MM-DD date (calendar date, no timezone shift). */
export function shortDate(iso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

export const numFmt = (lang: Lang) => new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US");

/** "Day +2 · 14 Oct" / "Latest observed · 11 Oct". */
export const dayHeading = (h: number, iso: string, lang: Lang) => {
  const tr = t(lang);
  return fmt(h === 0 ? tr.ovHeadLatest : tr.ovHeadDay, { n: h, date: shortDate(iso, lang) });
};

/** Rounded people count, or null when zero/tiny (never shown as a measured 0). */
export function roundedPeople(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n < 100) return null;
  return n < 10_000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000;
}

// ---- Dashboard helpers (left-panel overview card) ----

export type DashMetric = "people" | "buildings" | "roads" | "facilities" | "tambons";
export const DASH_METRICS: DashMetric[] = ["people", "buildings", "roads", "facilities", "tambons"];

/** Rounded count: nearest 100 below 10,000, nearest 1,000 above (never a false-precision figure). */
const roundCount = (n: number) => (n < 10_000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000);

/** Short form of a large count: 660K / 1.2M in English, 6.6 แสน / 1.2 ล้าน in Thai (2 significant digits). */
export function compactNum(n: number, lang: Lang): string {
  if (lang === "th") {
    const [div, unit] = n >= 1e6 ? [1e6, "ล้าน"] : n >= 1e5 ? [1e5, "แสน"] : [1e4, "หมื่น"];
    return `${new Intl.NumberFormat("th-TH", { maximumSignificantDigits: 2 }).format(n / div)} ${unit}`;
  }
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 2 }).format(n);
}

/** Full number below 10,000, compact above. */
export const fmtCount = (n: number, lang: Lang) => (n < 10_000 ? numFmt(lang).format(n) : compactNum(n, lang));

/** People or building counts: "0", "< 100" for a tiny non-zero value, else a rounded figure (optionally with "~"). */
export function fmtRounded(n: number, lang: Lang, opts: { compact?: boolean; approx?: boolean } = {}): string {
  if (n <= 0) return numFmt(lang).format(0);
  if (n < 100) return "< 100";
  const r = roundCount(n);
  return `${opts.approx ? "~" : ""}${opts.compact ? fmtCount(r, lang) : numFmt(lang).format(r)}`;
}

/** Road km: one decimal below 100 km, whole km above. */
export const fmtKm = (km: number, lang: Lang, compact = false) =>
  km < 100 ? new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", { maximumFractionDigits: 1 }).format(km) : compact ? fmtCount(Math.round(km), lang) : numFmt(lang).format(Math.round(km));

type ClassKey = "people" | "buildings" | "road_km" | "hospitals" | "schools";

/** Sum of a per-class field over the 5 DMR classes; null when classes or the field are missing. */
export function sumClasses(d: OverviewDay, key: ClassKey): number | null {
  const cl = d.classes;
  if (!cl || cl.length === 0 || cl.some((c) => typeof c[key] !== "number")) return null;
  return cl.reduce((a, c) => a + (c[key] as number), 0);
}

/** Which metrics have data for this day (people/tambons need classes/trigger_classes; the rest need the features precompute). */
export function availableMetrics(d: OverviewDay): DashMetric[] {
  const feat = (k: ClassKey) => sumClasses(d, k) != null;
  const prov = (f: (p: OverviewProvinceDay) => unknown) => d.provinces.some((p) => f(p) != null);
  return DASH_METRICS.filter((m) => {
    if (m === "people") return !!d.classes?.length;
    if (m === "tambons") return !!d.trigger_classes?.length;
    if (m === "buildings") return feat("buildings") || prov((p) => p.buildings);
    if (m === "roads") return feat("road_km") || prov((p) => p.road_km);
    return (feat("hospitals") && feat("schools")) || prov((p) => p.hospitals ?? p.schools);
  });
}

export interface BarRow { key: string; label: string; value: number; color: string; textOn: string; ring?: boolean; testId?: string }

/** Per-class values for chart A, highest risk first. Trigger-class counts for "tambons" (class 0 = below trigger). */
export function classRows(d: OverviewDay, metric: DashMetric, lang: Lang): BarRow[] {
  const tr = t(lang);
  if (metric === "tambons") {
    return (d.trigger_classes ?? []).map((n, i) => ({
      key: `tc${i}`,
      label: i === 0 ? tr.ovBelowTrigger : fmt(tr.ovTrigClass, { n: i }),
      value: n,
      color: i === 0 ? "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" : `color-mix(in oklab, var(--primary) ${30 + i * 14}%, transparent)`,
      textOn: "",
    })).reverse();
  }
  const get = (c: NonNullable<OverviewDay["classes"]>[number]): number | undefined =>
    metric === "people" ? c.people : metric === "buildings" ? c.buildings : metric === "roads" ? c.road_km : c.hospitals == null || c.schools == null ? undefined : c.hospitals + c.schools;
  return [...(d.classes ?? [])]
    .sort((a, b) => b.class - a.class)
    .flatMap((c) => {
      const v = get(c);
      return v == null ? [] : [{ key: `c${c.class}`, label: riskName(c.class, lang), value: v, color: riskColor(c.class), textOn: riskTextOn(c.class), ring: true }];
    });
}

/** Top provinces for chart C by the chosen metric (elevated-zone counts; trigger share for "tambons"). Zero rows are dropped. */
export function provinceRows(d: OverviewDay, metric: DashMetric, lang: Lang, n = 10) {
  const val = (p: OverviewProvinceDay): number | undefined =>
    metric === "people" ? p.people_elevated : metric === "buildings" ? p.buildings : metric === "roads" ? p.road_km : metric === "facilities" ? (p.hospitals == null && p.schools == null ? undefined : (p.hospitals ?? 0) + (p.schools ?? 0)) : p.triggered_share;
  return d.provinces
    .map((p) => ({ p, v: val(p) }))
    .filter((x): x is { p: OverviewProvinceDay; v: number } => typeof x.v === "number" && x.v > 0)
    .sort((a, b) => b.v - a.v || b.p.triggered_share - a.p.triggered_share || b.p.triggered - a.p.triggered)
    .slice(0, n)
    .map(({ p, v }) => ({ pcode: p.pcode, name: pick(lang, p.name ?? p.pcode, p.name_th), value: v, p }));
}
