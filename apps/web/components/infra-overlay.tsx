"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";
import { buildingShape, colorOfRisk, dotRadius, heightOf, squareAround, Z_3D, type Infra, type InfraToggles } from "@/lib/infra";
import { t } from "@/lib/i18n";
import { riskName } from "@/lib/overview";
import { classOfRisk } from "@/lib/svgmap";
import type { Lang } from "@/lib/types";

type Overlay = { setMap: (m: google.maps.Map | null) => void; setProps: (p: Record<string, unknown>) => void; finalize?: () => void };

/**
 * Draws the affected buildings and roads on the Google map with deck.gl (loaded only when needed): roads as coloured lines, buildings as dots,
 * as flat squares from zoom 17 and as extruded blocks from zoom 16 when "3D" is on. Everything has a white outline so it stands out on the risk colours. Everything shown is in the Moderate-or-higher zone.
 */
export function InfraOverlay({ lang, data, show, zoom }: { lang: Lang; data: Infra | null; show: InfraToggles; zoom: number }) {
  const map = useMap();
  const overlay = useRef<Overlay | null>(null);
  const tilted = useRef(false);

  useEffect(() => {
    if (!map || !data) return;
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
  }, [map, data]);

  useEffect(() => {
    if (!map || !data) return;
    let off = false;
    (async () => {
      const [{ PathLayer, PolygonLayer, ScatterplotLayer }] = await Promise.all([import("@deck.gl/layers")]);
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
        const shape = buildingShape(zoom, show.threeD);
        const extruded = shape === "blocks";
        if (shape !== "dots") {
          layers.push(new PolygonLayer({ id: "infra-buildings", data: data.buildings, getPolygon: (b: Infra["buildings"][number]) => squareAround(b[0], b[1], b[2]),
            extruded, getElevation: (b: Infra["buildings"][number]) => heightOf(b[3]), getFillColor: (b: Infra["buildings"][number]) => colorOfRisk(b[4], extruded ? 240 : 235),
            stroked: true, getLineColor: [255, 255, 255, 245], lineWidthUnits: "pixels", getLineWidth: 2, lineWidthMinPixels: 2, pickable: true,
            // unlit with edge lines: the lit material rendered black on some GPUs, and edges still give a clear sense of volume
            material: false, wireframe: extruded,
            updateTriggers: { getElevation: [extruded], getFillColor: [extruded] } }));
        } else {
          // a dark ring behind each point, so it reads on any risk colour and on satellite imagery
          layers.push(new ScatterplotLayer({ id: "infra-buildings-dots-ring", data: data.buildings, getPosition: (b: Infra["buildings"][number]) => [b[1], b[0]],
            getFillColor: [20, 10, 5, 230], radiusUnits: "pixels", getRadius: dotRadius(zoom) + 3, radiusMinPixels: 7, updateTriggers: { getRadius: [zoom] } }));
          layers.push(new ScatterplotLayer({ id: "infra-buildings-dots", data: data.buildings, getPosition: (b: Infra["buildings"][number]) => [b[1], b[0]],
            getFillColor: (b: Infra["buildings"][number]) => colorOfRisk(b[4], 255), radiusUnits: "pixels", getRadius: dotRadius(zoom), radiusMinPixels: 4,
            stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: "pixels", getLineWidth: 2, pickable: true,
            updateTriggers: { getRadius: [zoom] } }));
        }
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
  }, [map, data, show, zoom, lang]);

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
