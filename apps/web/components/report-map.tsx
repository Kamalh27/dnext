"use client";

import { useMemo } from "react";
import { RISK_COLORS, riskName } from "@/lib/overview";
import { boundsOf, pathOf, projector, type Geometry } from "@/lib/svgmap";
import type { Lang, MarkerKind } from "@/lib/types";

export interface MapShape { key: string; geometry: Geometry; cls: number }
export interface MapPoint { lat: number; lng: number; kind: MarkerKind; name: string }

const NONE = "#e7e5e4";
const POINT_COLORS: Partial<Record<MarkerKind, string>> = { hospital: "#7b3294", school: "#2c7fb8" };

const LEGEND_TEXT = {
  en: { none: "No landslide-prone ground, or below the rainfall trigger", hospital: "Hospital", school: "School", risk: "Risk class" },
  th: { none: "ไม่มีพื้นที่ที่ดินถล่มได้ หรือฝนยังไม่เกินเกณฑ์", hospital: "โรงพยาบาล", school: "โรงเรียน", risk: "ระดับความเสี่ยง" },
} as const;

/** A static SVG map for the report: shapes filled by risk class, optional facility points and a legend. Prints sharply at any size. */
export function ReportMap({ shapes, points = [], lang, width = 640, maxHeight = 460, label }: {
  shapes: MapShape[]; points?: MapPoint[]; lang: Lang; width?: number; maxHeight?: number; label: string;
}) {
  const tx = LEGEND_TEXT[lang];
  const fit = useMemo(() => {
    const b = boundsOf(shapes.map((s) => s.geometry));
    if (!b) return null;
    const p = projector(b, width, maxHeight);
    return { p, paths: shapes.map((s) => ({ key: s.key, d: pathOf(s.geometry, p.project), cls: s.cls })) };
  }, [shapes, width, maxHeight]);
  if (!fit) return null;
  const used = [...new Set(shapes.map((s) => s.cls).filter((c) => c > 0))].sort();
  const kinds = [...new Set(points.map((p) => p.kind))].filter((k) => POINT_COLORS[k]);
  return (
    <figure className="report-block">
      <svg role="img" aria-label={label} viewBox={`0 0 ${fit.p.width} ${fit.p.height}`} className="mx-auto block h-auto w-full rounded border" style={{ background: "#f8fafc", maxWidth: fit.p.width }}>
        <title>{label}</title>
        {fit.paths.map((s) => (
          <path key={s.key} d={s.d} fill={s.cls > 0 ? RISK_COLORS[Math.min(s.cls, 5) - 1] : NONE} stroke="#78716c" strokeWidth={0.35} strokeLinejoin="round" />
        ))}
        {points.map((pt, i) => {
          const [x, y] = fit.p.project(pt.lng, pt.lat);
          return <circle key={i} cx={x} cy={y} r={3.2} fill={POINT_COLORS[pt.kind] ?? "#44403c"} stroke="#ffffff" strokeWidth={0.9}><title>{pt.name}</title></circle>;
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-700">
        <span className="font-medium">{tx.risk}:</span>
        {used.map((c) => (
          <span key={c} className="inline-flex items-center gap-1"><i className="inline-block size-3 rounded-sm border border-neutral-500" style={{ background: RISK_COLORS[Math.min(c, 5) - 1] }} />{riskName(c, lang)}</span>
        ))}
        <span className="inline-flex items-center gap-1"><i className="inline-block size-3 rounded-sm border border-neutral-400" style={{ background: NONE }} />{tx.none}</span>
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-full border border-white" style={{ background: POINT_COLORS[k] }} />{tx[k as "hospital" | "school"]}</span>
        ))}
      </figcaption>
    </figure>
  );
}
