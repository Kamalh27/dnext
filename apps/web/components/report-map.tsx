"use client";

import { useMemo } from "react";
import { NO_DATA, type MapLegend } from "@/lib/report-maps";
import { boundsOf, labelPoint, niceKm, pathOf, projector, type Geometry } from "@/lib/svgmap";
import type { Lang, MarkerKind } from "@/lib/types";

export interface MapShape { key: string; geometry: Geometry; fill: string }
export interface MapPoint { lat: number; lng: number; kind: MarkerKind; name: string }
/** A numbered badge on a shape (matches the row numbers of a table). */
export interface MapBadge { key: string; n: number }

const POINT_COLORS: Partial<Record<MarkerKind, string>> = { hospital: "#7b3294", school: "#2c7fb8" };
const TEXT = {
  en: { none: "No landslide-prone ground, or below the trigger", hospital: "Hospital", school: "School" },
  th: { none: "ไม่มีพื้นที่ที่ดินถล่มได้ หรือฝนยังไม่เกินเกณฑ์", hospital: "โรงพยาบาล", school: "โรงเรียน" },
} as const;

/** A static, print-sharp SVG map: filled shapes, optional numbered badges and facility points, north arrow, scale bar and legend. */
export function ReportMap({ title, shapes, legend, points = [], badges = [], lang, width = 560, maxHeight = 420, noneLabel = true }: {
  title: string; shapes: MapShape[]; legend: MapLegend; points?: MapPoint[]; badges?: MapBadge[]; lang: Lang; width?: number; maxHeight?: number; noneLabel?: boolean;
}) {
  const tx = TEXT[lang];
  const fit = useMemo(() => {
    const b = boundsOf(shapes.map((s) => s.geometry));
    if (!b) return null;
    const p = projector(b, width, maxHeight);
    const paths = shapes.map((s) => ({ key: s.key, d: pathOf(s.geometry, p.project), fill: s.fill }));
    const marks = badges.flatMap((bd) => {
      const shape = shapes.find((s) => s.key === bd.key);
      const at = shape && labelPoint(shape.geometry);
      return at ? [{ n: bd.n, xy: p.project(at[0], at[1]) }] : [];
    });
    const km = niceKm((p.width * 0.28) * p.kmPerUnit);
    return { p, paths, marks, km, barW: km / p.kmPerUnit };
  }, [shapes, badges, width, maxHeight]);
  if (!fit) return null;
  const kinds = [...new Set(points.map((pt) => pt.kind))].filter((k) => POINT_COLORS[k]);
  const hasNone = shapes.some((s) => s.fill === NO_DATA);
  return (
    <figure className="report-block">
      <figcaption className="mb-1.5 text-[12px] font-semibold text-neutral-800">{title}</figcaption>
      <svg role="img" aria-label={title} viewBox={`0 0 ${fit.p.width} ${fit.p.height}`} className="mx-auto block h-auto w-full rounded-md border border-neutral-300"
        style={{ background: "#f4f7fb", maxWidth: fit.p.width }}>
        <title>{title}</title>
        {fit.paths.map((s) => <path key={s.key} d={s.d} fill={s.fill} stroke="#78716c" strokeWidth={0.3} strokeLinejoin="round" />)}
        {points.map((pt, i) => {
          const [x, y] = fit.p.project(pt.lng, pt.lat);
          return <circle key={i} cx={x} cy={y} r={3.4} fill={POINT_COLORS[pt.kind] ?? "#44403c"} stroke="#ffffff" strokeWidth={1}><title>{pt.name}</title></circle>;
        })}
        {fit.marks.map((m) => (
          <g key={m.n} transform={`translate(${m.xy[0]} ${m.xy[1]})`}>
            <circle r={7} fill="#1c1917" stroke="#ffffff" strokeWidth={1.2} />
            <text textAnchor="middle" dy="3" fontSize="8.5" fontWeight={700} fill="#ffffff">{m.n}</text>
          </g>
        ))}
        {/* north arrow */}
        <g transform={`translate(${fit.p.width - 16} 22)`}>
          <path d="M0 -13 L5 4 L0 0 L-5 4 Z" fill="#292524" />
          <text textAnchor="middle" dy="16" fontSize="8" fontWeight={700} fill="#292524">N</text>
        </g>
        {/* scale bar */}
        <g transform={`translate(10 ${fit.p.height - 14})`}>
          <rect width={fit.barW} height="4" fill="#292524" />
          <rect width={fit.barW / 2} height="4" fill="#ffffff" stroke="#292524" strokeWidth={0.6} />
          <text y="-3" fontSize="8" fill="#292524">0</text>
          <text x={fit.barW} y="-3" fontSize="8" textAnchor="end" fill="#292524">{fit.km} km</text>
        </g>
      </svg>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-neutral-700">
        <span className="font-semibold">{legend.title}:</span>
        {legend.items.map((it) => (
          <span key={it.label} className="inline-flex items-center gap-1"><i className="inline-block size-3 rounded-sm border border-neutral-500" style={{ background: it.color }} />{it.label}</span>
        ))}
        {noneLabel && hasNone && <span className="inline-flex items-center gap-1"><i className="inline-block size-3 rounded-sm border border-neutral-400" style={{ background: NO_DATA }} />{tx.none}</span>}
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-full border border-white" style={{ background: POINT_COLORS[k] }} />{tx[k as "hospital" | "school"]}</span>
        ))}
      </div>
    </figure>
  );
}
