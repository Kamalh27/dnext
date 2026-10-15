/** Affected infrastructure for the map: buildings and main-road pieces inside the Moderate-or-higher risk zone of the result on screen. */
import { classOfRisk } from "./svgmap.ts";

export interface Infra {
  scenario_id: string;
  min_risk: number;
  available: boolean;
  buildings: [number, number, number, number, number][];     // lat, lng, area_m2, height_m, risk
  roads: [number, [number, number][]][];                      // risk, [[lng, lat], ...]
  road_km: number;
  truncated: boolean;
}
export interface InfraToggles { buildings: boolean; roads: boolean; facilities: boolean; threeD: boolean }
export const DEFAULT_TOGGLES: InfraToggles = { buildings: true, roads: true, facilities: true, threeD: false };

/** Buildings are drawn as footprints from this zoom on (dots before), and extruded in 3D from Z_3D (street level: one pixel is about 2 m). */
export const Z_POLY = 17;
export const Z_3D = 16;

const COLORS: Record<number, [number, number, number]> = { 3: [253, 141, 60], 4: [240, 59, 32], 5: [189, 0, 38] };
/** Colour of a feature by its risk; class 3 (Moderate) and above only, so a lower value is never drawn in the hot colours. */
export const colorOfRisk = (risk: number, alpha = 225): [number, number, number, number] => {
  const c = COLORS[Math.min(5, Math.max(3, classOfRisk(risk)))];
  return [c[0], c[1], c[2], alpha];
};

const M_PER_DEG = 111_320;
/** A square footprint of the given area around a point (the data holds centres and areas, not outlines). Sides stay between 5 and 60 m. */
export function squareAround(lat: number, lng: number, areaM2: number): [number, number][] {
  const half = Math.min(60, Math.max(5, Math.sqrt(Math.max(areaM2, 1)))) / 2;
  const dLat = half / M_PER_DEG;
  const dLng = half / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]];
}

/** Estimated height for the 3D view: the data's value, or a one-storey default when it is missing, never taller than 60 m. */
export const heightOf = (h: number) => (h > 0 ? Math.min(60, h) : 4);

export function counts(d: Infra | null) {
  return { buildings: d?.buildings.length ?? 0, roadKm: d?.road_km ?? 0 };
}

/** Where to look first: the building with the highest risk (the first one when several tie), or null when there are none. */
export function hotspot(d: Infra | null): { lat: number; lng: number } | null {
  if (!d || d.buildings.length === 0) return null;
  let best = d.buildings[0];
  for (const b of d.buildings) if (b[4] > best[4]) best = b;
  return { lat: best[0], lng: best[1] };
}

export type BuildingShape = "dots" | "footprints" | "blocks";
/** How buildings are drawn: points almost everywhere (thousands of tiny outlines turn into noise), footprints only at close range, blocks when 3D is on at street level. */
export function buildingShape(zoom: number, threeD: boolean): BuildingShape {
  if (threeD && zoom >= Z_3D) return "blocks";
  return zoom >= Z_POLY ? "footprints" : "dots";
}
/** Dot size in pixels: it grows a little as you zoom in so points stay easy to see, between 4 and 8. */
export const dotRadius = (zoom: number) => Math.min(8, Math.max(4, Math.round((4 + (zoom - 10) * 0.5) * 2) / 2));
