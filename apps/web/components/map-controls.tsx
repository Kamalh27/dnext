"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Box, Globe, Layers, LoaderCircle, LocateFixed, Map as MapIcon, Maximize2, Minimize2, Minus, Plus, Search, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { LayersPanel, type LayerPatch } from "./layers-panel";
import type { Lang, MapLayerItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Pt { lat: number; lng: number }

const glass = "border bg-card/90 shadow-lg backdrop-blur-md";
const btn =
  "grid size-9 place-items-center text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-[18px]";

function MapButton({ label, onClick, children, disabled, pressed, className }: {
  label: string; onClick: () => void; children: ReactNode; disabled?: boolean; pressed?: boolean; className?: string;
}) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn(btn, className)}>
      {children}
    </button>
  );
}

/** Zoom, my location, 2D/3D and fullscreen. Must render under <APIProvider> (uses the default map instance). */
export function MapControls({ lang, onLocate, onGlobe, fullscreenTarget, layers, onLayerChange }: {
  lang: Lang; onLocate: (p: Pt) => void; onGlobe: () => void; fullscreenTarget: HTMLElement | null;
  layers: MapLayerItem[]; onLayerChange: (id: string, p: LayerPatch) => void;
}) {
  const tr = t(lang);
  const panelId = useId();
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRoot = useRef<HTMLDivElement>(null);
  const layersBtn = useRef<HTMLButtonElement>(null);
  const hasLayers = layers.length > 0;
  const showPanel = layersOpen && hasLayers;

  // Close on Escape (focus returns to the button) or a pointer press outside.
  useEffect(() => {
    if (!showPanel) return;
    const away = (e: PointerEvent) => !layersRoot.current?.contains(e.target as Node) && setLayersOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setLayersOpen(false);
      layersBtn.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [showPanel]);
  const map = useMap();
  const [is3d, setIs3d] = useState(false);
  const [locating, setLocating] = useState(false);
  const [full, setFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Keep the 2D/3D button honest when the user tilts with a gesture.
  useEffect(() => {
    if (!map) return;
    const l = map.addListener("tilt_changed", () => setIs3d((map.getTilt() ?? 0) > 0));
    return () => l.remove();
  }, [map]);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const zoom = (d: number) => map && map.setZoom((map.getZoom() ?? 6) + d);

  const locate = useCallback(() => {
    if (!map) return;
    if (!navigator.geolocation) return setNotice(tr.locationFail);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.panTo(p);
        map.setZoom(Math.max(map.getZoom() ?? 0, 12));
        onLocate(p);
        setLocating(false);
      },
      (err) => {
        setNotice(err.code === err.PERMISSION_DENIED ? tr.locationDenied : tr.locationFail);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [map, onLocate, tr]);

  const toggle3d = () => {
    if (!map) return;
    const next = !is3d;
    // Tilt only works on vector maps; a raster Map ID silently ignores it, so say so.
    if (next && map.getRenderingType() === google.maps.RenderingType.RASTER) setNotice(tr.view3dNeedsVector);
    map.setTilt(next ? 60 : 0);
    if (!next) map.setHeading(0);
    setIs3d(next);
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void fullscreenTarget?.requestFullscreen?.();
  };

  return (
    <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
      <div className={cn("flex flex-col divide-y overflow-hidden rounded-[4px]", glass)} role="group" aria-label={tr.mapControls}>
        <MapButton label={tr.zoomIn} onClick={() => zoom(1)}><Plus /></MapButton>
        <MapButton label={tr.zoomOut} onClick={() => zoom(-1)}><Minus /></MapButton>
      </div>
      {hasLayers && (
        <div ref={layersRoot} className="relative">
          <div className={cn("overflow-hidden rounded-[4px]", glass)}>
            <button
              ref={layersBtn}
              type="button"
              aria-label={tr.layersTitle}
              title={tr.layersTitle}
              aria-expanded={showPanel}
              aria-controls={showPanel ? panelId : undefined}
              onClick={() => setLayersOpen((o) => !o)}
              className={cn(btn, showPanel && "bg-primary text-primary-foreground hover:bg-primary")}
            >
              <Layers />
            </button>
          </div>
          {showPanel && <LayersPanel id={panelId} lang={lang} layers={layers} onChange={onLayerChange} />}
        </div>
      )}
      <div className={cn("flex flex-col divide-y overflow-hidden rounded-[4px]", glass)}>
        <MapButton label={tr.myLocation} onClick={locate} disabled={locating}>
          {locating ? <LoaderCircle className="animate-spin" /> : <LocateFixed />}
        </MapButton>
        <MapButton label={is3d ? tr.view2d : tr.view3d} onClick={toggle3d} pressed={is3d} className={cn(is3d && "bg-primary text-primary-foreground hover:bg-primary")}>
          {is3d ? <MapIcon /> : <Box />}
        </MapButton>
        <MapButton label={tr.globeView} onClick={onGlobe}><Globe /></MapButton>
        <MapButton label={full ? tr.exitFullscreen : tr.fullscreen} onClick={toggleFull}>
          {full ? <Minimize2 /> : <Maximize2 />}
        </MapButton>
      </div>
      <span className="pointer-events-none -mt-1 text-[10px] font-semibold tracking-wide text-foreground/70 uppercase" aria-hidden>{is3d ? "3D" : "2D"}</span>
      {notice && (
        <p role="status" className={cn("max-w-56 rounded-[4px] px-3 py-2 text-xs", glass)}>{notice}</p>
      )}
    </div>
  );
}

/** Place search (Geocoding, restricted to Thailand). Flies the map to the result and drops a pin. */
export function MapSearch({ lang, onPin }: { lang: Lang; onPin: (p: (Pt & { label: string }) | null) => void }) {
  const tr = t(lang);
  const map = useMap();
  const geocoding = useMapsLibrary("geocoding");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!map || !geocoding || !q.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { results } = await new geocoding.Geocoder().geocode({ address: q.trim(), componentRestrictions: { country: "TH" }, region: "th" });
      const r = results[0];
      if (!r) return setMsg(tr.searchNone);
      const loc = r.geometry.location;
      if (r.geometry.viewport) map.fitBounds(r.geometry.viewport, 48);
      else { map.panTo(loc); map.setZoom(14); }
      onPin({ lat: loc.lat(), lng: loc.lng(), label: r.formatted_address });
    } catch (err) {
      setMsg((err as { code?: string }).code === "ZERO_RESULTS" ? tr.searchNone : tr.searchFail);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => { setQ(""); setMsg(null); onPin(null); };

  return (
    <form onSubmit={submit} role="search" className="w-[min(20rem,calc(100vw-6.5rem))]">
      <div className={cn("flex items-center gap-2 rounded-[4px] py-1 pr-1 pl-3.5 focus-within:ring-2 focus-within:ring-ring/50", glass)}>
        {busy ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr.searchPlaceholder}
          aria-label={tr.searchPlaceholder}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {q && (
          <button type="button" onClick={clear} aria-label={tr.clear} title={tr.clear} className="grid size-7 place-items-center rounded-[3px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        )}
      </div>
      {msg && <p role="status" className={cn("mt-1.5 rounded-[4px] px-3 py-1.5 text-xs", glass)}>{msg}</p>}
    </form>
  );
}
