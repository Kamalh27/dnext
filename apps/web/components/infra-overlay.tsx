"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";
import { buildingShape, colorOfRisk, heightOf, squareAround, Z_3D, type Infra, type InfraToggles } from "@/lib/infra";
import { t } from "@/lib/i18n";
import { riskName } from "@/lib/overview";
import { classOfRisk } from "@/lib/svgmap";
import type { Lang } from "@/lib/types";

type Overlay = { setMap: (m: google.maps.Map | null) => void; setProps: (p: Record<string, unknown>) => void; finalize?: () => void };

/**
 * 3D only: draws the roads and the buildings as extruded blocks with deck.gl while the "3D" switch is on at street level (it needs a vector map).
 * The flat view (roads, points, footprints) is drawn by InfraCanvas, so deck.gl is not loaded at all until 3D is used.
 */
export function InfraOverlay({ lang, data, show, zoom }: { lang: Lang; data: Infra | null; show: InfraToggles; zoom: number }) {
  const map = useMap();
  const overlay = useRef<Overlay | null>(null);
  const tilted = useRef(false);
  const active = buildingShape(zoom, show.threeD) === "blocks";

  useEffect(() => {
    if (!map || !data || !active) return;
    let off = false;
    (async () => {
      const { GoogleMapsOverlay } = await import("@deck.gl/google-maps");
      if (off) return;
      overlay.current = new GoogleMapsOverlay({ layers: [] }) as unknown as Overlay;
      overlay.current.setMap(map);
    })();
    return () => {
      off = true;
      overlay.current?.setMap(null);
      overlay.current?.finalize?.();
      overlay.current = null;
    };
  }, [map, data, active]);

  useEffect(() => {
    if (!map || !data || !active) return;
    let off = false;
    (async () => {
      const { PathLayer, PolygonLayer } = await import("@deck.gl/layers");
      // the overlay may still be loading: wait a moment for it
      for (let i = 0; i < 40 && !overlay.current && !off; i++) await new Promise((r) => setTimeout(r, 50));
      if (off || !overlay.current) return;
      const tr = t(lang);
      const label = (risk: number) => riskName(Math.max(3, classOfRisk(risk)), lang);
      const layers = [];
      if (show.roads && data.roads.length) {
        layers.push(new PathLayer({ id: "infra-roads-shadow", data: data.roads, getPath: (d: Infra["roads"][number]) => d[1], getColor: [20, 10, 5, 200],
          widthUnits: "pixels", getWidth: 15, widthMinPixels: 12, capRounded: true, jointRounded: true }));
        layers.push(new PathLayer({ id: "infra-roads-casing", data: data.roads, getPath: (d: Infra["roads"][number]) => d[1], getColor: [255, 255, 255, 255],
          widthUnits: "pixels", getWidth: 11, widthMinPixels: 9, capRounded: true, jointRounded: true }));
        layers.push(new PathLayer({ id: "infra-roads", data: data.roads, getPath: (d: Infra["roads"][number]) => d[1], getColor: (d: Infra["roads"][number]) => colorOfRisk(d[0]),
          widthUnits: "pixels", getWidth: 7, widthMinPixels: 6, capRounded: true, jointRounded: true, pickable: true }));
      }
      if (show.buildings && data.buildings.length) {
        layers.push(new PolygonLayer({ id: "infra-buildings", data: data.buildings, getPolygon: (b: Infra["buildings"][number]) => squareAround(b[0], b[1], b[2]),
          extruded: true, getElevation: (b: Infra["buildings"][number]) => heightOf(b[3]), getFillColor: (b: Infra["buildings"][number]) => colorOfRisk(b[4], 240),
          stroked: true, getLineColor: [255, 255, 255, 245], lineWidthUnits: "pixels", getLineWidth: 2, lineWidthMinPixels: 2, pickable: true,
          // unlit with edge lines: the lit material rendered black on some GPUs, and edges still give a clear sense of volume
          material: false, wireframe: true }));
      }
      overlay.current.setProps({
        layers,
        getTooltip: ({ object, layer }: { object?: unknown; layer?: { id: string } | null }) => {
          if (!object || !layer) return null;
          if (layer.id === "infra-roads") return { text: `${tr.infraRoad} · ${label((object as Infra["roads"][number])[0])}` };
          const b = object as Infra["buildings"][number];
          return { text: `${tr.infraBuilding} · ${tr.infraHeight} ~${Math.round(heightOf(b[3]))} m · ${label(b[4])} (${b[4].toFixed(1)})` };
        },
      });
    })();
    return () => { off = true; };
  }, [map, data, show, active, lang]);

  // 3D on: tilt the map once (vector maps only); 3D off: level it again.
  useEffect(() => {
    if (!map) return;
    try {
      if (show.threeD && zoom >= Z_3D && !tilted.current && (map.getTilt() ?? 0) < 40) { map.setTilt(55); tilted.current = true; }
      if ((!show.threeD || zoom < Z_3D) && tilted.current) { map.setTilt(0); tilted.current = false; }
    } catch { /* raster maps cannot tilt */ }
  }, [map, show.threeD, zoom]);

  return null;
}
