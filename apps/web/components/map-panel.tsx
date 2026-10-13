"use client";

import { useTheme } from "./theme-provider";

import { useEffect, useRef, useState } from "react";
import { BasemapSwitcher } from "./basemap-switcher";
import { MapControls, MapSearch, type Pt } from "./map-controls";
import { ScaleBar } from "./scale-bar";
import { AdvancedMarker, APIProvider, InfoWindow, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { explain } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { Explain, Lang, MapLayer, MapMarkers } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
const KIND_STYLE: Record<string, { glyph: string; bg: string }> = {
  school: { glyph: "S", bg: "#2c7fb8" },
  hospital: { glyph: "H", bg: "#7b3294" },
  shelter: { glyph: "A", bg: "#238b45" },
  bridge: { glyph: "B", bg: "#4d4d4d" },
};

export function MapPanel({ lang, layer, markers }: { lang: Lang; layer: MapLayer | null; markers: MapMarkers["markers"] }) {
  const tr = t(lang);
  if (!KEY) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-muted p-6 text-center">
        <p className="font-medium">{tr.mapMissing}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{tr.mapMissingHint}</p>
      </div>
    );
  }
  return (
    <APIProvider apiKey={KEY}>
      <MapInner lang={lang} layer={layer} markers={markers} />
    </APIProvider>
  );
}

function MapInner({ lang, layer, markers }: { lang: Lang; layer: MapLayer | null; markers: MapMarkers["markers"] }) {
  const tr = t(lang);
  const { theme } = useTheme();
  const [mapType, setMapType] = useState<"terrain" | "satellite">("terrain");
  const [override, setOverride] = useState<{ id: string; value: number } | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [me, setMe] = useState<Pt | null>(null);
  const [pin, setPin] = useState<(Pt & { label: string }) | null>(null);
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);

  const opacity = override && layer && override.id === layer.id ? override.value : (layer?.opacity ?? 0.7);

  return (
    <div ref={setWrap} className="relative h-full w-full bg-background">
      <Map
        mapId={MAP_ID}
        colorScheme={theme === "dark" ? "DARK" : "LIGHT"}
        mapTypeId={mapType}
        defaultCenter={{ lat: 15.5, lng: 101 }}
        defaultZoom={6}
        gestureHandling="greedy"
        disableDefaultUI
        mapTypeControl={false}
        onClick={(e) => e.detail.latLng && layer && setPoint(e.detail.latLng)}
      >
        <HazardOverlay layer={layer} opacity={opacity} />
        {me && (
          <AdvancedMarker position={me} title={tr.pinMe}>
            <span className="block size-4 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_6px_rgba(37,99,235,0.25)]" aria-label={tr.pinMe} />
          </AdvancedMarker>
        )}
        {pin && (
          <AdvancedMarker position={pin} title={pin.label}>
            <Pin background="#0f766e" borderColor="#fff" glyphColor="#fff" />
          </AdvancedMarker>
        )}
        {markers.map((m, i) => {
          const s = KIND_STYLE[m.kind] ?? KIND_STYLE.bridge;
          return (
            <AdvancedMarker key={`${m.kind}-${i}`} position={{ lat: m.lat, lng: m.lng }} title={`${m.name} (${m.kind})`}>
              <Pin background={s.bg} borderColor="#fff" glyphColor="#fff" glyph={s.glyph} scale={0.8} />
            </AdvancedMarker>
          );
        })}
        {point && layer && (
          <InfoWindow position={point} onClose={() => setPoint(null)} headerContent={<b>{tr.explainTitle}</b>}>
            <ExplainBody key={`${point.lat},${point.lng}`} lang={lang} point={point} scenarioId={layer.scenario_id} />
          </InfoWindow>
        )}
      </Map>

      <div className="absolute top-3 left-3 flex flex-col items-start gap-2">
        <MapSearch lang={lang} onPin={setPin} />
      </div>
      <MapControls lang={lang} onLocate={setMe} fullscreenTarget={wrap} />

      <div className="absolute bottom-9 left-3 flex flex-col items-start gap-2">
      {layer && (
        <div className="w-60 space-y-2.5 rounded-xl border bg-card/90 p-3.5 text-xs shadow-lg backdrop-blur-md">
          <p className="text-[13px] font-semibold leading-snug">{layer.name}</p>
          <ul aria-label={tr.legend} className="space-y-1">
            {layer.legend.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <span className="size-3 shrink-0 rounded-full border border-black/20" style={{ background: l.color }} aria-hidden />
                {l.label}
              </li>
            ))}
          </ul>
          <div className="space-y-1">
            <label id="op-l">{tr.opacity}</label>
            <Slider aria-labelledby="op-l" min={0} max={1} step={0.05} value={[opacity]} onValueChange={(v) => setOverride({ id: layer.id, value: Array.isArray(v) ? v[0] : v })} />
          </div>
        </div>
      )}
        <div className="flex items-end gap-2">
          <BasemapSwitcher lang={lang} value={mapType} onChange={setMapType} />
          <ScaleBar />
        </div>
      </div>
    </div>
  );
}

/** Renders the hazard tiles as an ImageMapType in map.overlayMapTypes, replacing any previous one. */
function HazardOverlay({ layer, opacity }: { layer: MapLayer | null; opacity: number }) {
  const map = useMap();
  const imt = useRef<google.maps.ImageMapType | null>(null);

  useEffect(() => {
    if (!map || !layer) return;
    const overlay = new google.maps.ImageMapType({
      name: layer.name,
      tileSize: new google.maps.Size(256, 256),
      opacity,
      getTileUrl: (c, z) =>
        layer.tile_url.replace("{z}", String(z)).replace("{x}", String(c.x)).replace("{y}", String(c.y)),
    });
    map.overlayMapTypes.clear();
    if (layer.tile_url) {
      map.overlayMapTypes.push(overlay);
      imt.current = overlay;
    }
    const [w, s, e, n] = layer.bbox;
    map.fitBounds({ west: w, south: s, east: e, north: n }, 48);
    return () => {
      map.overlayMapTypes.clear();
      imt.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opacity is synced by the effect below
  }, [map, layer]);

  useEffect(() => {
    imt.current?.setOpacity(opacity);
  }, [opacity, layer]);

  return null;
}

function ExplainBody({ lang, point, scenarioId }: { lang: Lang; point: { lat: number; lng: number }; scenarioId: string }) {
  const tr = t(lang);
  const [state, setState] = useState<{ data?: Explain; error?: boolean }>({});
  useEffect(() => {
    let live = true;
    explain(point.lat, point.lng, scenarioId)
      .then((data) => live && setState({ data }))
      .catch(() => live && setState({ error: true }));
    return () => {
      live = false;
    };
  }, [point, scenarioId]);

  return (
    <div className="max-w-60 space-y-2 text-xs text-neutral-900">
      {state.error && <p role="alert">{tr.explainError}</p>}
      {!state.data && !state.error && (
        <div aria-busy="true" className="space-y-1">
          <p>{tr.explainLoading}</p>
          <Skeleton className="h-3 w-40" />
        </div>
      )}
      {state.data && (
        <>
          <p>{state.data.summary}</p>
          <ul className="space-y-1">
            {state.data.factors.map((f) => (
              <li key={f.name}>
                <div className="flex justify-between gap-2"><span>{f.name}: {f.value}</span><span>{Math.round(f.contribution * 100)}%</span></div>
                <div className="h-1 rounded bg-neutral-200"><div className="h-1 rounded bg-orange-600" style={{ width: `${Math.min(100, Math.abs(f.contribution) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
