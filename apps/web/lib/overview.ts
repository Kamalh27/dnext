import { fmt, t } from "./i18n";
import type { Lang, LegendItem, OverviewProvinceDay } from "./types";

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
