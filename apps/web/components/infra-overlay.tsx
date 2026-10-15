"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";
import { Z_3D, type InfraToggles } from "@/lib/infra";

/** 3D on at street level: tilt the map once (vector maps only); 3D off: level it again. The blocks themselves are drawn by InfraCanvas. */
export function InfraTilt({ show, zoom }: { show: InfraToggles; zoom: number }) {
  const map = useMap();
  const tilted = useRef(false);
  useEffect(() => {
    if (!map) return;
    try {
      if (show.threeD && zoom >= Z_3D && !tilted.current && (map.getTilt() ?? 0) < 40) { map.setTilt(55); tilted.current = true; }
      if ((!show.threeD || zoom < Z_3D) && tilted.current) { map.setTilt(0); tilted.current = false; }
    } catch { /* raster maps cannot tilt */ }
  }, [map, show.threeD, zoom]);
  return null;
}
