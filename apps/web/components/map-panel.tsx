"use client";

import { useTheme } from "./theme-provider";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BasemapSwitcher } from "./basemap-switcher";
import type { LayerPatch } from "./layers-panel";
import { MapControls, MapSearch, type Pt } from "./map-controls";
import { ScaleBar } from "./scale-bar";
import { AdvancedMarker, APIProvider, InfoWindow, Map, Map3D, MapMode, Marker3D, Pin, useMap } from "@vis.gl/react-google-maps";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { explain } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { Explain, Lang, MapLayer, MapLayerItem, MapLayersEvent, MapMarkers, StaticLayerItem } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
const KIND_STYLE: Record<string, { glyph: string; bg: string }> = {
  school: { glyph: "S", bg: "#2c7fb8" },
  hospital: { glyph: "H", bg: "#7b3294" },
  shelter: { glyph: "A", bg: "#238b45" },
  bridge: { glyph: "B", bg: "#4d4d4d" },
};

interface PanelProps { lang: Lang; layer: MapLayer | null; layers: MapLayersEvent | null; staticLayers: StaticLayerItem[]; markers: MapMarkers["markers"] }

const STATIC_ORDER = ["susceptibility", "vulnerability", "exposure", "population"];
const STATIC_OPACITY = 0.7;
/** Static layer tweaks are keyed by `key`, never by id/URL, so refreshed tile URLs keep the user's toggles. */
const staticId = (key: string) => `static:${key}`;

/** Overlay draw order, bottom to top: list order is priority (first = top), and the risk layer is always on top. */
function stackBottomUp(ls: MapLayerItem[]) {
  const r = [...ls].reverse();
  const i = r.findIndex((l) => l.key === "risk");
  return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1), r[i]];
}

export function MapPanel({ lang, layer, layers, staticLayers, markers }: PanelProps) {
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
      <MapInner lang={lang} layer={layer} layers={layers} staticLayers={staticLayers} markers={markers} />
    </APIProvider>
  );
}

function MapInner({ lang, layer, layers, staticLayers, markers }: PanelProps) {
  const tr = t(lang);
  const { theme } = useTheme();
  const [mapType, setMapType] = useState<"terrain" | "satellite">("satellite");
  // Per-layer user tweaks (visibility, opacity). Scoped to a scenario so a new result starts from the server defaults.
  const [tweaks, setTweaks] = useState<{ scope: string; byId: Record<string, LayerPatch> }>({ scope: "", byId: {} });
  // Reference layer tweaks live for the whole session (not scoped to a scenario), keyed by staticId(key).
  const [staticTweaks, setStaticTweaks] = useState<Record<string, LayerPatch>>({});
  const [overlayInfo, setOverlayInfo] = useState({ count: 0, opacity: "" });
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [me, setMe] = useState<Pt | null>(null);
  const [pin, setPin] = useState<(Pt & { label: string }) | null>(null);
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  // The globe is opt-in (Globe button). A new result (layer) closes it so the hazard map is never hidden behind it.
  const [globe, setGlobe] = useState(false);
  const [seenLayer, setSeenLayer] = useState(layer?.id);
  if (layer?.id !== seenLayer) {
    setSeenLayer(layer?.id);
    if (layer) setGlobe(false);
  }

  // One list for both modes: a map_layers set, or the single legacy map_layer as a lone risk layer.
  const scope = layers?.scenario_id ?? layer?.scenario_id ?? "";
  const bbox = layers?.bbox ?? layer?.bbox ?? null;
  const items = useMemo<MapLayerItem[]>(() => {
    const base: MapLayerItem[] = layers
      ? layers.layers
      : layer
        ? [{ id: layer.id, key: "risk", name: layer.name, tile_url: layer.tile_url, opacity: layer.opacity, visible: true, legend: layer.legend }]
        : [];
    const byId = tweaks.scope === scope ? tweaks.byId : {};
    return base.map((l) => ({ ...l, ...byId[l.id] }));
  }, [layers, layer, tweaks, scope]);
  const staticItems = useMemo<MapLayerItem[]>(
    () =>
      [...staticLayers]
        .sort((a, b) => STATIC_ORDER.indexOf(a.key) - STATIC_ORDER.indexOf(b.key))
        .map((l) => {
          const id = staticId(l.key);
          // Reference layers always start OFF; the user's tweak (by key) wins over server values.
          return { ...l, id, group: "static" as const, visible: false, opacity: l.opacity ?? STATIC_OPACITY, ...staticTweaks[id] };
        }),
    [staticLayers, staticTweaks],
  );
  // Draw order, bottom to top: reference layers first, then scenario layers (risk topmost).
  const drawItems = useMemo(() => [...stackBottomUp(staticItems), ...stackBottomUp(items)], [staticItems, items]);
  const onLayerChange = useCallback(
    (id: string, p: LayerPatch) => {
      if (id.startsWith("static:")) return setStaticTweaks((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
      setTweaks((prev) => {
        const byId = prev.scope === scope ? prev.byId : {};
        return { scope, byId: { ...byId, [id]: { ...byId[id], ...p } } };
      });
    },
    [scope],
  );
  // Legend card follows the top visible layer.
  const top = useMemo(() => {
    const vis = items.filter((l) => l.visible);
    return vis.find((l) => l.key === "risk") ?? vis[0] ?? staticItems.find((l) => l.visible) ?? null;
  }, [items, staticItems]);

  return (
    <div ref={setWrap} className="relative h-full w-full bg-background" data-overlay-count={overlayInfo.count} data-overlay-opacity={overlayInfo.opacity}>
      <Map
        mapId={MAP_ID}
        colorScheme={theme === "dark" ? "DARK" : "LIGHT"}
        mapTypeId={mapType === "satellite" ? "hybrid" : "terrain"}
        defaultCenter={{ lat: 15.5, lng: 101 }}
        defaultZoom={6}
        gestureHandling="greedy"
        disableDefaultUI
        mapTypeControl={false}
        onClick={(e) => e.detail.latLng && layer && setPoint(e.detail.latLng)}
      >
        <LayerOverlays items={drawItems} bbox={bbox} scope={scope} onInfo={setOverlayInfo} />
        {me && (
          <AdvancedMarker position={me} title={tr.pinMe}>
            <span className="relative flex size-4" data-testid="my-location-dot">
              <span className="absolute inline-flex size-full rounded-full bg-brand opacity-60 motion-safe:animate-ping" aria-hidden />
              <span className="relative inline-flex size-4 rounded-full border-2 border-white bg-brand shadow-md" />
            </span>
          </AdvancedMarker>
        )}
        {pin && (
          <AdvancedMarker position={pin} title={pin.label}>
            <Pin background="#8a4b24" borderColor="#fff" glyphColor="#fff" />
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
      <MapControls lang={lang} onLocate={setMe} onGlobe={() => setGlobe(true)} fullscreenTarget={wrap} layers={items} reference={staticItems} onLayerChange={onLayerChange} />

      {globe && (
        <div className="absolute inset-0 z-10 bg-black">
          <Map3D
            mode={MapMode.HYBRID}
            defaultCenter={{ lat: 15.5, lng: 101, altitude: 0 }}
            defaultRange={16_000_000}
            defaultTilt={0}
            defaultHeading={0}
            style={{ position: "absolute", inset: 0 }}
          >
            <Marker3D position={{ lat: 15.5, lng: 101, altitude: 0 }} label="Thailand" />
          </Map3D>
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGlobe(false)}
              className="flex items-center gap-1.5 rounded-[4px] border bg-card/90 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden />
              {tr.globeBack}
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-9 left-3 flex flex-col items-start gap-2">
      {top && (
        <div className="w-60 space-y-2.5 rounded-[4px] border bg-card/90 p-3.5 text-xs shadow-lg backdrop-blur-md" data-testid="legend-card">
          <p className="text-[13px] font-semibold leading-snug">{top.name}</p>
          {top.legend.length > 0 && (
            <ul aria-label={tr.legend} className="space-y-1">
              {top.legend.map((l) => (
                <li key={l.label} className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-[2px] border border-black/20" style={{ background: l.color }} aria-hidden />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
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

/**
 * Draws every visible layer (items arrive in draw order, bottom to top) that has tiles as a stacked ImageMapType in map.overlayMapTypes. Overlay instances are
 * cached per layer+url and the overlay array is patched in place, so toggling one layer or dragging an opacity
 * slider never rebuilds the others. Refits the view when the scenario or bbox changes.
 */
function LayerOverlays({ items, bbox, scope, onInfo }: {
  items: MapLayerItem[]; bbox: MapLayersEvent["bbox"] | null; scope: string; onInfo: (i: { count: number; opacity: string }) => void;
}) {
  const map = useMap();
  const cache = useRef<Record<string, google.maps.ImageMapType>>({});

  useEffect(() => {
    if (!map) return;
    const store = cache.current;
    const arr = map.overlayMapTypes;
    return () => {
      arr.clear();
      for (const k of Object.keys(store)) delete store[k];
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const arr = map.overlayMapTypes;
    const store = cache.current;
    const drawn = items.filter((l) => l.visible && l.tile_url);
    const want = drawn.map((l) => {
      const k = `${l.id}|${l.tile_url}`;
      let imt: google.maps.ImageMapType | undefined = store[k];
      if (!imt) {
        const url = l.tile_url;
        imt = new google.maps.ImageMapType({
          name: l.name,
          tileSize: new google.maps.Size(256, 256),
          opacity: l.opacity,
          getTileUrl: (c, z) => url.replace("{z}", String(z)).replace("{x}", String(c.x)).replace("{y}", String(c.y)),
        });
        store[k] = imt;
      }
      imt.setOpacity(l.opacity);
      return imt;
    });
    const wanted = new Set(want);
    for (const k of Object.keys(store)) if (!wanted.has(store[k])) delete store[k];

    const indexOf = (o: google.maps.MapType | null | undefined) => {
      for (let i = 0; i < arr.getLength(); i++) if (arr.getAt(i) === o) return i;
      return -1;
    };
    for (let i = arr.getLength() - 1; i >= 0; i--) if (!wanted.has(arr.getAt(i) as google.maps.ImageMapType)) arr.removeAt(i);
    want.forEach((imt, i) => {
      if (arr.getAt(i) === imt) return;
      const j = indexOf(imt);
      if (j > i) arr.removeAt(j);
      arr.insertAt(i, imt);
    });
    onInfo({ count: arr.getLength(), opacity: want.map((m) => (m.getOpacity() ?? 1).toFixed(2)).join(",") });
  }, [map, items, onInfo]);

  const [w, s, e, n] = bbox ?? [NaN, NaN, NaN, NaN];
  useEffect(() => {
    if (!map || Number.isNaN(w)) return;
    map.fitBounds({ west: w, south: s, east: e, north: n }, 48);
  }, [map, scope, w, s, e, n]);

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
