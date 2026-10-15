/** Small helpers for the safe-places panel and the route preview. */
import type { SafeKind } from "./types.ts";

export const KIND_EN: Record<SafeKind, string> = { shelter: "Shelter", community: "Community building", school: "School", temple: "Temple", hospital: "Hospital" };
export const KIND_TH: Record<SafeKind, string> = { shelter: "ที่พักพิง", community: "อาคารชุมชน", school: "โรงเรียน", temple: "วัด", hospital: "โรงพยาบาล" };

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** A link that opens turn-by-turn directions in Google Maps (no API call, no cost). */
export function directionsUrl(from: { lat: number; lng: number } | null, to: { lat: number; lng: number }, mode: "DRIVE" | "WALK" = "DRIVE"): string {
  const p = new URLSearchParams({ api: "1", destination: `${to.lat},${to.lng}`, travelmode: mode === "WALK" ? "walking" : "driving" });
  if (from) p.set("origin", `${from.lat},${from.lng}`);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/** The i18n key that explains why a community report was not published. */
export function reportReasonKey(reason: string) {
  switch (reason) {
    case "not_slope_scene": return "reportWhyNot_slope" as const;
    case "unrelated_or_manipulated": return "reportWhyNot_unrelated" as const;
    case "nothing_relevant_visible": return "reportWhyNot_nothing" as const;
    case "data_disagrees": return "reportWhyData" as const;
    default: return "reportWhyLow" as const;
  }
}

/** "5 min ago" style label for a report time (English or Thai). */
export function timeAgo(iso: string, lang: "en" | "th", now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  const [n, en, th] = min < 60 ? [Math.max(1, min), "min", "นาที"] : min < 1440 ? [Math.round(min / 60), "h", "ชม."] : [Math.round(min / 1440), "d", "วัน"];
  return lang === "th" ? `${n} ${th} ที่แล้ว` : `${n} ${en} ago`;
}
