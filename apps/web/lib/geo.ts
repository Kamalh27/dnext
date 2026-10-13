import type { Province } from "./types";

type Ring = number[][]; // [lng, lat][]

/** Ray casting: is (x, y) inside the ring? Ring vertices are [lng, lat]. */
function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a polygon = inside its outer ring (index 0) and outside every hole (the rest). */
const inPolygon = (poly: Ring[], x: number, y: number) =>
  poly.length > 0 && inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y));

export function provinceContains(p: Province, lat: number, lng: number): boolean {
  const [w, s, e, n] = p.bbox;
  if (lng < w || lng > e || lat < s || lat > n) return false;
  return p.geometry.coordinates.some((poly) => inPolygon(poly, lng, lat));
}

/** The province containing a point, or null when it is outside Thailand's outlines. */
export const findProvince = (provinces: Province[], lat: number, lng: number): Province | null =>
  provinces.find((p) => provinceContains(p, lat, lng)) ?? null;

/** The Thailand overview the map opens on, and the target of "Reset map view". */
export const DEFAULT_VIEW = { center: { lat: 15.5, lng: 101 }, zoom: 6 } as const;
