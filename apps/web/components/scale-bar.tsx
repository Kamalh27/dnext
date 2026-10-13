"use client";

import { useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { cn } from "@/lib/utils";

const NICE_M = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
const MAX_PX = 110;

/** Ground distance of the largest "nice" length that fits in MAX_PX at this latitude and zoom (Web Mercator, 256 px tiles). */
export function scaleFor(lat: number, zoom: number): { px: number; label: string } {
  const metresPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  const fit = [...NICE_M].reverse().find((m) => m / metresPerPx <= MAX_PX) ?? NICE_M[0];
  return { px: Math.round(fit / metresPerPx), label: fit >= 1000 ? `${fit / 1000} km` : `${fit} m` };
}

/** Metric scale bar that tracks zoom and latitude. Sits above the Google logo (which must stay unobstructed). */
export function ScaleBar({ className }: { className?: string }) {
  const map = useMap();
  const [s, setS] = useState<{ px: number; label: string } | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      if (c && z != null) setS(scaleFor(c.lat(), z));
    };
    update();
    const ls = [map.addListener("zoom_changed", update), map.addListener("center_changed", update)];
    return () => ls.forEach((l) => l.remove());
  }, [map]);

  if (!s) return null;
  return (
    <div className={cn("w-fit rounded-md border bg-card/90 px-2 pt-1 pb-1.5 text-[11px] font-medium shadow-lg backdrop-blur-md", className)} aria-label={`Scale ${s.label}`}>
      <div className="mb-0.5 tabular-nums leading-none">{s.label}</div>
      <div className="h-1.5 border-x-2 border-b-2 border-foreground/80" style={{ width: s.px }} aria-hidden />
    </div>
  );
}
