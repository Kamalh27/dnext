"use client";

import { useEffect, useRef, useState } from "react";
import { AdvancedMarker, Pin, useMap } from "@vis.gl/react-google-maps";
import { ExternalLink, Footprints, Car, Loader2, LocateFixed, Route, X } from "lucide-react";
import { ApiError, fetchShelters, previewRoute } from "@/lib/api";
import { gate } from "@/lib/auth";
import { t, fmt } from "@/lib/i18n";
import { compass, directionsUrl, formatDistance, formatDuration, KIND_EN, KIND_TH } from "@/lib/safe";
import type { Lang, RouteOption, SafePlace } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Pt } from "./map-controls";

export interface SafeDraw { places: SafePlace[]; routes: RouteOption[]; active: number; to: Pt | null }
export const NO_DRAW: SafeDraw = { places: [], routes: [], active: 0, to: null };

const placeName = (p: SafePlace, lang: Lang) => (lang === "th" ? p.name_th || p.name : p.name || p.name_th);

/** Side panel: candidate safe places near a point (OpenStreetMap) and a Google route preview to one of them. Drawing is done by <SafeOverlay> through onDraw. */
export function SafePlacesPanel({ lang, scenarioId, me, onDraw, onClose }: {
  lang: Lang; scenarioId?: string; me: Pt | null; onDraw: (d: SafeDraw) => void; onClose: () => void;
}) {
  const tr = t(lang);
  const map = useMap();
  const [origin, setOrigin] = useState<(Pt & { from: "me" | "centre" }) | null>(null);
  const [places, setPlaces] = useState<SafePlace[] | null>(null);
  const [mode, setMode] = useState<"DRIVE" | "WALK">("DRIVE");
  const [target, setTarget] = useState<SafePlace | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<"list" | "route" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scored, setScored] = useState(false);
  const live = useRef(0);

  const draw = (p: SafePlace[], r: RouteOption[], a: number, to: Pt | null) => onDraw({ places: p, routes: r, active: a, to });

  const load = async (o: Pt & { from: "me" | "centre" }) => {
    const n = ++live.current;
    setOrigin(o); setBusy("list"); setError(null); setTarget(null); setRoutes([]); setPlaces(null);
    draw([], [], 0, null);
    try {
      const r = await fetchShelters(o.lat, o.lng, 8);
      if (n !== live.current) return;
      setPlaces(r.places);
      draw(r.places, [], 0, null);
    } catch {
      if (n === live.current) setError(tr.safeFailed);
    } finally {
      if (n === live.current) setBusy(null);
    }
  };

  const fromCentre = () => {
    const c = map?.getCenter();
    if (c) void load({ lat: c.lat(), lng: c.lng(), from: "centre" });
  };
  const fromMe = () => {
    if (me) return void load({ ...me, from: "me" });
    if (!navigator.geolocation) return setError(tr.locationFail);
    navigator.geolocation.getCurrentPosition(
      (pos) => void load({ lat: pos.coords.latitude, lng: pos.coords.longitude, from: "me" }),
      (err) => setError(err.code === err.PERMISSION_DENIED ? tr.locationDenied : tr.locationFail),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Start from my location when it is already known, else from the map centre. Runs once when the panel opens.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !map) return;
    started.current = true;
    const c = map.getCenter();
    const o = me ? { ...me, from: "me" as const } : c ? { lat: c.lat(), lng: c.lng(), from: "centre" as const } : null;
    if (o) void Promise.resolve().then(() => load(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Clear the drawing when the panel closes.
  useEffect(() => () => { live.current++; onDraw(NO_DRAW); }, [onDraw]);

  const preview = async (p: SafePlace, m = mode) => {
    if (!origin || busy || !gate()) return;
    setTarget(p); setBusy("route"); setError(null);
    try {
      const r = await previewRoute({ origin, destination: { lat: p.lat, lng: p.lng }, mode: m, scenario_id: scenarioId });
      setRoutes(r.routes); setScored(r.scored); setActive(0);
      draw(places ?? [], r.routes, 0, { lat: p.lat, lng: p.lng });
      if (r.routes[0]?.path.length) {
        const b = new google.maps.LatLngBounds();
        for (const [la, ln] of r.routes[0].path) b.extend({ lat: la, lng: ln });
        map?.fitBounds(b, 70);
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.isAuthRequired)) setError(tr.routeFailed);
    } finally {
      setBusy(null);
    }
  };

  const pickRoute = (i: number) => { setActive(i); draw(places ?? [], routes, i, target ? { lat: target.lat, lng: target.lng } : null); };
  const clearRoute = () => { setRoutes([]); setTarget(null); draw(places ?? [], [], 0, null); };
  const chooseMode = (m: "DRIVE" | "WALK") => { setMode(m); if (target && routes.length) void preview(target, m); };

  const kindText = (k: SafePlace["kind"]) => (lang === "th" ? KIND_TH : KIND_EN)[k];

  return (
    <div role="region" aria-label={tr.safeTitle} data-map-overlay="safe" data-testid="safe-panel"
      className="absolute top-14 left-3 z-20 flex max-h-[calc(100%-7rem)] w-[min(22rem,calc(100cqw-5rem))] flex-col overflow-hidden rounded-[4px] border bg-card/95 text-xs shadow-lg backdrop-blur-md">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b pl-3">
        <p className="min-w-0 truncate py-2 text-[13px] font-semibold">{tr.safeTitle}</p>
        <button type="button" onClick={onClose} aria-label={tr.close} title={tr.close} className="grid size-8 shrink-0 place-items-center rounded-[4px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:size-11"><X className="size-4" aria-hidden /></button>
      </div>
      <div className="space-y-2 overflow-y-auto overscroll-contain px-3 py-2">
        <p className="leading-relaxed text-muted-foreground">{tr.safeIntro}</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={fromMe} aria-pressed={origin?.from === "me"} className={cn("flex min-h-8 items-center gap-1.5 rounded-[4px] border px-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11", origin?.from === "me" && "border-primary bg-primary/10")}><LocateFixed className="size-3.5" aria-hidden />{tr.safeFromMe}</button>
          <button type="button" onClick={fromCentre} aria-pressed={origin?.from === "centre"} className={cn("min-h-8 rounded-[4px] border px-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11", origin?.from === "centre" && "border-primary bg-primary/10")}>{tr.safeFromCentre}</button>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="mode">
          {([["DRIVE", tr.safeDrive, Car], ["WALK", tr.safeWalk, Footprints]] as const).map(([m, label, Icon]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => chooseMode(m)} className={cn("flex min-h-8 items-center gap-1.5 rounded-[4px] border px-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11", mode === m && "border-primary bg-primary/10")}><Icon className="size-3.5" aria-hidden />{label}</button>
          ))}
        </div>
        {busy === "list" && <p className="flex items-center gap-2 text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" aria-hidden />…</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {places && places.length === 0 && !busy && <p className="text-muted-foreground">{tr.safeNone}</p>}
        <ul className="space-y-1.5">
          {places?.map((p, i) => (
            <li key={`${p.lat},${p.lng},${i}`} className={cn("rounded-lg border px-2.5 py-2", target === p && "border-primary")}>
              <p className="font-medium break-words">{placeName(p, lang)}</p>
              <p className="text-muted-foreground">{kindText(p.kind)} · {formatDistance(p.distance_m)} {compass(p.bearing)}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <a href={directionsUrl(origin, p, mode)} target="_blank" rel="noopener noreferrer" className="flex min-h-7 items-center gap-1 rounded-[4px] border px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11"><ExternalLink className="size-3" aria-hidden />{tr.safeDirections}</a>
                <button type="button" onClick={() => void preview(p)} disabled={!!busy} className="flex min-h-7 items-center gap-1 rounded-[4px] border px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 coarse:min-h-11">
                  {busy === "route" && target === p ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Route className="size-3" aria-hidden />}{busy === "route" && target === p ? tr.safeChecking : tr.safePreview}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {routes.length > 0 && (
          <div className="space-y-1.5 rounded-lg bg-muted px-2.5 py-2" data-testid="route-options">
            <ul className="space-y-1">
              {routes.map((r, i) => (
                <li key={i}>
                  <button type="button" onClick={() => pickRoute(i)} aria-pressed={active === i} className={cn("w-full rounded-[4px] border bg-card px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", active === i && "border-primary")}>
                    <span className="font-medium">{formatDuration(r.duration_s)} · {formatDistance(r.distance_m)}</span>
                    {r.recommended && <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-900">{tr.routeBest}</span>}
                    <span className={cn("block", r.flagged ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                      {r.risk_km == null ? "" : r.flagged ? fmt(tr.routeRiskKm, { n: r.risk_km.toFixed(1) }) : tr.routeNoRisk}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!scored && <p className="text-muted-foreground">{tr.routeUnscored}</p>}
            <p className="text-muted-foreground">{tr.routeNote}</p>
            <button type="button" onClick={clearRoute} className="underline underline-offset-2">{tr.routeClear}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Draws the safe places as markers and the route options as lines (the active one on top). Renders inside <Map>. */
export function SafeOverlay({ lang, draw }: { lang: Lang; draw: SafeDraw }) {
  const map = useMap();
  useEffect(() => {
    if (!map || draw.routes.length === 0) return;
    const lines = draw.routes.map((r, i) => {
      const on = i === draw.active;
      return new google.maps.Polyline({
        map, path: r.path.map(([lat, lng]) => ({ lat, lng })), clickable: false,
        strokeColor: r.flagged ? "#c62828" : "#1a73e8", strokeOpacity: on ? 0.95 : 0.4, strokeWeight: on ? 6 : 4, zIndex: on ? 10 : 1,
      });
    });
    return () => lines.forEach((l) => l.setMap(null));
  }, [map, draw.routes, draw.active]);
  return (
    <>
      {draw.places.map((p, i) => (
        <AdvancedMarker key={`${p.lat},${p.lng},${i}`} position={{ lat: p.lat, lng: p.lng }} title={placeName(p, lang)}>
          <Pin background={draw.to && draw.to.lat === p.lat && draw.to.lng === p.lng ? "#1a73e8" : "#238b45"} borderColor="#fff" glyphColor="#fff" glyph="✚" scale={0.75} />
        </AdvancedMarker>
      ))}
    </>
  );
}
