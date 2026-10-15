"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildingShape, colorOfRisk, dotRadius, heightOf, squareAround, type Infra, type InfraToggles } from "@/lib/infra";
import { t } from "@/lib/i18n";
import { riskName } from "@/lib/overview";
import { classOfRisk } from "@/lib/svgmap";
import type { Lang } from "@/lib/types";

const css = (c: [number, number, number, number]) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
const DARK = "rgba(20,10,5,0.9)";
const MAX_DRAWN = 20000;

type Hit = { x: number; y: number; text: string };

/**
 * Roads, building points and close-range footprints, drawn on a plain 2D canvas that sits in the map's overlay pane and is sized and placed here
 * (no WebGL, so it behaves the same on raster and vector maps and on any address). It redraws when the map moves or zooms.
 * deck.gl is only used for the 3D blocks (see infra-overlay.tsx); while those are on, this layer steps aside.
 */
export function InfraCanvas({ lang, data, show, zoom }: { lang: Lang; data: Infra | null; show: InfraToggles; zoom: number }) {
  const map = useMap();
  const [tip, setTip] = useState<Hit | null>(null);
  const draw = useRef<() => void>(() => {});
  const items = useRef({ data, show, zoom, lang });

  // Bounding box of every road piece, once per result, so off-screen roads are skipped quickly.
  const roadBoxes = useMemo(() => (data?.roads ?? []).map((r) => {
    let w = 180, s = 90, e = -180, n = -90;
    for (const [lng, lat] of r[1]) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; }
    return [w, s, e, n] as const;
  }), [data]);
  const boxes = useRef(roadBoxes);

  useEffect(() => { items.current = { data, show, zoom, lang }; boxes.current = roadBoxes; draw.current(); }, [data, show, zoom, lang, roadBoxes]);

  useEffect(() => {
    if (!map || !data) return;
    const view = new google.maps.OverlayView();
    let canvas: HTMLCanvasElement | null = null;
    let raf = 0;

    const render = () => {
      if (!canvas) return;
      const proj = view.getProjection();
      const div = map.getDiv();
      const w = div.clientWidth, h = div.clientHeight;
      const { data: d, show: sh, zoom: z } = items.current;
      const ctx = canvas.getContext("2d");
      if (!proj || !ctx || !d || w === 0 || h === 0) return;
      const dpr = window.devicePixelRatio || 1;
      // Place the canvas exactly over the map area (overlay pane coordinates) and size it to the map.
      const origin = proj.fromContainerPixelToLatLng(new google.maps.Point(0, 0));
      const at = origin && proj.fromLatLngToDivPixel(origin);
      if (!origin || !at) return;
      canvas.style.left = `${at.x}px`;
      canvas.style.top = `${at.y}px`;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const tilted = (map.getTilt() ?? 0) > 0 || (map.getHeading() ?? 0) !== 0;
      if (tilted && sh.threeD) return;   // deck.gl draws everything while 3D is on
      const b = map.getBounds();
      if (!b) return;
      const ne = b.getNorthEast(), sw = b.getSouthWest();
      const west = sw.lng(), east = ne.lng(), south = sw.lat(), north = ne.lat();
      const px = (lat: number, lng: number) => proj.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lng));

      if (sh.roads) {
        const passes: [string, number][] = [[DARK, 15], ["rgba(255,255,255,1)", 11]];
        const vis: number[] = [];
        d.roads.forEach((r, i) => { const bx = boxes.current[i]; if (bx && bx[2] >= west && bx[0] <= east && bx[3] >= south && bx[1] <= north) vis.push(i); });
        const path = (i: number) => {
          ctx.beginPath();
          d.roads[i][1].forEach(([lng, lat], k) => { const p = px(lat, lng); if (!p) return; if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        };
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const [color, width] of passes) { ctx.strokeStyle = color; ctx.lineWidth = width; for (const i of vis) { path(i); ctx.stroke(); } }
        ctx.lineWidth = 7;
        for (const i of vis) { ctx.strokeStyle = css(colorOfRisk(d.roads[i][0])); path(i); ctx.stroke(); }
      }

      if (sh.buildings) {
        const sel = d.buildings.filter((q) => q[1] >= west && q[1] <= east && q[0] >= south && q[0] <= north).slice(0, MAX_DRAWN);
        if (buildingShape(z, sh.threeD) === "footprints") {
          for (const q of sel) {
            ctx.beginPath();
            squareAround(q[0], q[1], q[2]).forEach(([lng, lat], k) => { const p = px(lat, lng); if (!p) return; if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
            ctx.closePath();
            ctx.fillStyle = css(colorOfRisk(q[4], 235)); ctx.fill();
            ctx.lineJoin = "miter"; ctx.strokeStyle = DARK; ctx.lineWidth = 4; ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.96)"; ctx.lineWidth = 2; ctx.stroke();
          }
        } else {
          const r = dotRadius(z);
          for (const q of sel) {
            const p = px(q[0], q[1]);
            if (!p) continue;
            ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 6.2832); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.2, 0, 6.2832); ctx.fill();
            ctx.fillStyle = css(colorOfRisk(q[4], 255)); ctx.beginPath(); ctx.arc(p.x, p.y, r - 0.8, 0, 6.2832); ctx.fill();
          }
        }
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
    draw.current = schedule;

    view.onAdd = () => {
      canvas = document.createElement("canvas");
      canvas.style.cssText = "position:absolute;pointer-events:none;z-index:5";
      canvas.setAttribute("data-testid", "infra-canvas");
      view.getPanes()?.overlayLayer.appendChild(canvas);
    };
    view.draw = schedule;
    view.onRemove = () => { canvas?.remove(); canvas = null; };
    view.setMap(map);

    const listeners = [
      map.addListener("bounds_changed", schedule), map.addListener("zoom_changed", schedule), map.addListener("idle", schedule),
      map.addListener("tilt_changed", schedule), map.addListener("heading_changed", schedule),
    ];
    const ro = new ResizeObserver(schedule);
    ro.observe(map.getDiv());

    // Hover: the building point or road under the pointer.
    const hover = map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      const proj = view.getProjection();
      const { data: d, show: sh, zoom: z, lang: lg } = items.current;
      if (!proj || !e.latLng || !d) return setTip(null);
      const here = proj.fromLatLngToContainerPixel(e.latLng);
      const ev = e.domEvent as MouseEvent | undefined;
      if (!here || !ev) return setTip(null);
      const reach = (buildingShape(z, sh.threeD) === "dots" ? dotRadius(z) + 3 : 10);
      let best: Hit | null = null, bestD = reach;
      const label2 = (risk: number) => riskName(Math.max(3, classOfRisk(risk)), lg);
      const t2 = t(lg);
      if (sh.buildings) {
        const bnd = map.getBounds();
        for (const q of d.buildings) {
          if (bnd && !bnd.contains({ lat: q[0], lng: q[1] })) continue;
          const p = proj.fromLatLngToContainerPixel(new google.maps.LatLng(q[0], q[1]));
          if (!p) continue;
          const dist = Math.hypot(p.x - here.x, p.y - here.y);
          if (dist < bestD) { bestD = dist; best = { x: ev.clientX, y: ev.clientY, text: `${t2.infraBuilding} · ${t2.infraHeight} ~${Math.round(heightOf(q[3]))} m · ${label2(q[4])} (${q[4].toFixed(1)})` }; }
        }
      }
      if (!best && sh.roads) {
        for (let i = 0; i < d.roads.length; i++) {
          const bx = boxes.current[i];
          const ll = e.latLng;
          if (!bx || ll.lng() < bx[0] - 0.01 || ll.lng() > bx[2] + 0.01 || ll.lat() < bx[1] - 0.01 || ll.lat() > bx[3] + 0.01) continue;
          const pts = d.roads[i][1].map(([lng, lat]) => proj.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lng)));
          for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1], c = pts[k];
            if (!a || !c) continue;
            const dx = c.x - a.x, dy = c.y - a.y, len2 = dx * dx + dy * dy || 1;
            const u = Math.max(0, Math.min(1, ((here.x - a.x) * dx + (here.y - a.y) * dy) / len2));
            const dist = Math.hypot(a.x + u * dx - here.x, a.y + u * dy - here.y);
            if (dist < 8) { best = { x: ev.clientX, y: ev.clientY, text: `${t2.infraRoad} · ${label2(d.roads[i][0])}` }; break; }
          }
          if (best) break;
        }
      }
      setTip(best);
    });
    const leave = map.addListener("mouseout", () => setTip(null));

    return () => {
      cancelAnimationFrame(raf);
      draw.current = () => {};
      listeners.forEach((l) => l.remove());
      hover.remove(); leave.remove();
      ro.disconnect();
      view.setMap(null);
    };
  }, [map, data]);

  return tip ? createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-[60] rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-lg" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>,
    document.body,
  ) : null;
}
