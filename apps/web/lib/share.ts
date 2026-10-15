/** Share links: the address carries what to run again (area, rainfall and duration, or a forecast), never a result id, because map layers expire. */
import type { Kpis } from "./types.ts";

export interface ShareRun {
  area: string;
  mm?: number;
  h?: number;
  forecast?: number;
}

export function shareParams(k: Pick<Kpis, "kind" | "area_code" | "rainfall_mm" | "duration_h" | "horizon_days">): string | null {
  if (!k.area_code || !/^TH\d{2}$/i.test(k.area_code)) return null;     // only province-level runs can be opened again from a link
  const p = new URLSearchParams({ area: k.area_code });
  if (k.kind === "forecast") {
    if (!k.horizon_days) return null;
    p.set("forecast", String(k.horizon_days));
  } else {
    if (k.rainfall_mm == null || k.duration_h == null) return null;
    p.set("mm", String(k.rainfall_mm));
    p.set("h", String(k.duration_h));
  }
  return p.toString();
}

/** Reads a share link; anything missing or out of range gives null, so a mangled link just opens the normal overview. */
export function parseShare(search: string): ShareRun | null {
  const p = new URLSearchParams(search);
  const area = p.get("area") ?? "";
  if (!/^TH\d{2}$/i.test(area)) return null;                 // the map only selects provinces
  const num = (key: string) => {
    const v = p.get(key);
    return v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const forecast = num("forecast");
  if (forecast !== null) return forecast >= 1 && forecast <= 5 && Number.isInteger(forecast) ? { area: area.toUpperCase(), forecast } : null;
  const mm = num("mm");
  const h = num("h");
  if (mm === null || h === null || mm <= 0 || mm > 1500 || h < 1 || h > 720) return null;
  return { area: area.toUpperCase(), mm, h };
}
