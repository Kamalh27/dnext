/** Colour scales for the report maps. Each scale gives the colour of a value and the legend that explains it. */
import type { Lang } from "./types.ts";
import { classOfRisk } from "./svgmap.ts";

export interface MapLegend { title: string; items: { color: string; label: string }[] }
export interface Scale { legend: MapLegend; colorOf: (v: number | null | undefined) => string }

export const NO_DATA = "#e7e5e4";
const RISK = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];
const BLUES = ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"];
const RISK_NAMES = { en: ["Very low", "Low", "Moderate", "High", "Very high"], th: ["ต่ำมาก", "ต่ำ", "ปานกลาง", "สูง", "สูงมาก"] };

const binned = (edges: number[], colors: string[], labels: string[], title: string): Scale => ({
  legend: { title, items: colors.map((color, i) => ({ color, label: labels[i] })) },
  colorOf: (v) => {
    if (v == null) return NO_DATA;
    const i = edges.findIndex((e) => v < e);
    return colors[i < 0 ? edges.length : i];
  },
});

export const riskScale = (lang: Lang): Scale => ({
  legend: { title: lang === "th" ? "ระดับความเสี่ยง" : "Risk class", items: RISK.map((color, i) => ({ color, label: RISK_NAMES[lang][i] })) },
  colorOf: (v) => { const c = classOfRisk(v ?? 0); return c ? RISK[c - 1] : NO_DATA; },
});

export const riskClassScale = (lang: Lang): Scale => {
  const s = riskScale(lang);
  return { legend: s.legend, colorOf: (cls) => (cls && cls > 0 ? RISK[Math.min(cls, 5) - 1] : NO_DATA) };
};

/** Trigger class 0..5: how far the 30-day rain is above the tambon's own thresholds. */
export const triggerScale = (lang: Lang): Scale => ({
  legend: { title: lang === "th" ? "ระดับตัวกระตุ้นจากฝน (0-5)" : "Rainfall trigger class (0-5)", items: ["0", "1", "2", "3", "4", "5"].map((label, i) => ({ color: i === 0 ? NO_DATA : RISK[i - 1], label })) },
  colorOf: (v) => (v && v > 0 ? RISK[Math.min(Math.round(v), 5) - 1] : NO_DATA),
});

export const rain30Scale = (lang: Lang): Scale =>
  binned([100, 200, 300, 400, 500], BLUES, ["< 100", "100–200", "200–300", "300–400", "400–500", "500+"], lang === "th" ? "ฝนสะสม 30 วัน (มม.)" : "30-day rainfall (mm)");

export const dayRainScale = (lang: Lang): Scale =>
  binned([1, 5, 10, 20, 40], BLUES, ["< 1", "1–5", "5–10", "10–20", "20–40", "40+"], lang === "th" ? "ฝนเฉลี่ยของวัน (มม./วัน)" : "Mean rain of the day (mm/day)");

export const shareScale = (lang: Lang): Scale =>
  binned([0.0001, 0.1, 0.25, 0.5, 0.75], ["#f7f7f7", "#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#c51b8a"], ["0", "< 10 %", "10–25 %", "25–50 %", "50–75 %", "75 %+"],
    lang === "th" ? "สัดส่วนตำบลที่ฝนเกินเกณฑ์" : "Share of tambons above their trigger");
