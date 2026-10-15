/** Small map-to-SVG helpers for the report: an equirectangular fit of GeoJSON polygons into a box, no map library. */
export type Ring = number[][];
export interface Geometry { type: "Polygon" | "MultiPolygon"; coordinates: Ring[] | Ring[][] }
export interface Bounds { w: number; s: number; e: number; n: number }

const polygons = (g: Geometry): Ring[][] => (g.type === "Polygon" ? [g.coordinates as Ring[]] : (g.coordinates as Ring[][]));

export function boundsOf(geoms: Geometry[]): Bounds | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const g of geoms) for (const poly of polygons(g)) for (const ring of poly) for (const [lng, lat] of ring) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return Number.isFinite(w) ? { w, s, e, n } : null;
}

export interface Projection { width: number; height: number; project: (lng: number, lat: number) => [number, number] }

/** Fits the bounds into width x maxHeight (keeping the shape), so a tall country and a wide province both fill the box well. */
export function projector(b: Bounds, width: number, maxHeight: number, pad = 6): Projection {
  const cos = Math.cos((((b.s + b.n) / 2) * Math.PI) / 180);
  const spanX = Math.max((b.e - b.w) * cos, 1e-9);
  const spanY = Math.max(b.n - b.s, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (maxHeight - 2 * pad) / spanY);
  const w = spanX * scale + 2 * pad;
  const h = spanY * scale + 2 * pad;
  return { width: Math.round(w), height: Math.round(h), project: (lng, lat) => [pad + (lng - b.w) * cos * scale, pad + (b.n - lat) * scale] };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function pathOf(g: Geometry, project: Projection["project"]): string {
  let d = "";
  for (const poly of polygons(g)) for (const ring of poly) {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = project(lng, lat);
      d += `${i === 0 ? "M" : "L"}${r1(x)} ${r1(y)}`;
    });
    d += "Z";
  }
  return d;
}

/** Risk class 0 (none) or 1..5 from a risk value on the 0-5 scale, with the same cut-offs as the API (1, 2, 3, 4). */
export const classOfRisk = (v: number, cutoffs: number[] = [1, 2, 3, 4]) => (v > 0 ? 1 + cutoffs.filter((c) => v >= c).length : 0);
