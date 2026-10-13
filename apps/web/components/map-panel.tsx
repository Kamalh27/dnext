"use client";

import { useTheme } from "./theme-provider";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BasemapSwitcher } from "./basemap-switcher";
import type { LayerPatch } from "./layers-panel";
import { OverviewSlider } from "./overview-slider";
import { MapControls, MapSearch, type Pt } from "./map-controls";
import { MapLegend } from "./map-legend";
import { ScaleBar } from "./scale-bar";
import { AdvancedMarker, APIProvider, InfoWindow, Map, Map3D, MapMode, Marker3D, Pin, useMap } from "@vis.gl/react-google-maps";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { explain } from "@/lib/api";
import { fmt, t } from "@/lib/i18n";
import { DEFAULT_VIEW, findProvince } from "@/lib/geo";
import { localLayer, pick } from "@/lib/lang";
import { countsOf, fillsFor, legendFor, numFmt, riskName, type Fill, type OverviewMetric } from "@/lib/overview";
import { MQ, useMedia } from "@/lib/use-media";
import type { Explain, Lang, MapLayer, MapLayerItem, MapLayersEvent, MapMarkers, OverviewProvinceDay, OverviewSeries, Province, StaticLayerItem } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
const KIND_STYLE: Record<string, { glyph: string; bg: string }> = {
  school: { glyph: "S", bg: "#2c7fb8" },
  hospital: { glyph: "H", bg: "#7b3294" },
  shelter: { glyph: "A", bg: "#238b45" },
  bridge: { glyph: "B", bg: "#4d4d4d" },
};

interface PanelProps {
  lang: Lang; layer: MapLayer | null; layers: MapLayersEvent | null; staticLayers: StaticLayerItem[]; markers: MapMarkers["markers"];
  provinces: Province[]; selected: Province | null; onSelect: (p: Province) => void;
  /** National overview (null = not in overview mode): series, selected day, metric and playback state. */
  overview: { series: OverviewSeries; day: number; metric: OverviewMetric; playing: boolean } | null;
  onOverviewDay: (d: number) => void; onOverviewMetric: (m: OverviewMetric) => void; onOverviewPlay: () => void;
}

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

export function MapPanel(props: PanelProps) {
  const { lang } = props;
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
      <MapInner {...props} />
    </APIProvider>
  );
}

function MapInner({ lang, layer, layers, staticLayers, markers, provinces, selected, onSelect, overview, onOverviewDay, onOverviewMetric, onOverviewPlay }: PanelProps) {
  const tr = t(lang);
  const { theme } = useTheme();
  const short = useMedia(MQ.short);
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
  // Thin outlines of every province are a toggleable reference layer (per session). The selected province stays highlighted regardless.
  const [outlines, setOutlines] = useState(true);
  const [cam, setCam] = useState<{ zoom: number; lat: number; lng: number }>({ zoom: DEFAULT_VIEW.zoom, lat: DEFAULT_VIEW.center.lat, lng: DEFAULT_VIEW.center.lng });
  const [seenProvince, setSeenProvince] = useState(selected?.pcode);
  if (selected?.pcode !== seenProvince) {
    setSeenProvince(selected?.pcode);
    setPoint(null);
  }
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
        ? [{ id: layer.id, key: "risk", name: layer.name, name_th: layer.name_th, tile_url: layer.tile_url, opacity: layer.opacity, visible: true, legend: layer.legend }]
        : [];
    const byId = tweaks.scope === scope ? tweaks.byId : {};
    return base.map((l) => ({ ...localLayer(l, lang), ...byId[l.id] }));
  }, [layers, layer, tweaks, scope, lang]);
  const staticItems = useMemo<MapLayerItem[]>(
    () =>
      [...staticLayers]
        .sort((a, b) => STATIC_ORDER.indexOf(a.key) - STATIC_ORDER.indexOf(b.key))
        .map((l) => {
          const id = staticId(l.key);
          // Reference layers always start OFF; the user's tweak (by key) wins over server values.
          return { ...localLayer(l, lang), id, group: "static" as const, visible: false, opacity: l.opacity ?? STATIC_OPACITY, ...staticTweaks[id] };
        }),
    [staticLayers, staticTweaks, lang],
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

  // Overview choropleth: per-province fill for the selected day and metric (recomputed on slider/metric change; the GeoJSON is never re-added).
  const day = overview ? (overview.series.days.find((d) => d.h === overview.day) ?? overview.series.days[0]) : null;
  const byPcode = useMemo(() => Object.fromEntries((day?.provinces ?? []).map((p) => [p.pcode, p] as const)) as Record<string, OverviewProvinceDay | undefined>, [day]);
  const metric = overview?.metric ?? "risk";
  const fills = useMemo(() => (day ? fillsFor(metric, day.provinces) : null), [day, metric]);
  const overviewLegend = overview ? legendFor(metric, lang) : null;
  const [hover, setHover] = useState<{ pcode: string; x: number; y: number } | null>(null);
  const hoverActive = !!overview;
  const [seenOverview, setSeenOverview] = useState(hoverActive);
  if (seenOverview !== hoverActive) {
    setSeenOverview(hoverActive);
    if (!hoverActive) setHover(null);
  }

  // Click picks the province under the pointer (point-in-polygon on the loaded outlines, independent of the outlines layer being shown).
  // Inside the already-selected province with a scenario on the map it explains that point instead.
  const onMapClick = (e: { detail: { latLng: google.maps.LatLngLiteral | null } }) => {
    const ll = e.detail.latLng;
    if (!ll) return;
    if (provinces.length === 0) return void (layer && setPoint(ll)); // outlines unavailable: keep the old explain-anywhere behaviour
    const hit = findProvince(provinces, ll.lat, ll.lng);
    if (!hit) return;
    if (layer && hit.pcode === selected?.pcode) return setPoint(ll);
    setPoint(null);
    onSelect(hit);
  };

  return (
    <div ref={setWrap} className="@container relative h-full w-full bg-background" data-overlay-count={overlayInfo.count} data-overlay-opacity={overlayInfo.opacity}
      data-selected-province={selected?.pcode ?? ""}
      data-overview={overview ? "on" : "off"}
      data-overview-day={overview?.day ?? ""}
      data-overview-metric={overview ? metric : ""}
      data-overview-classes={fills ? countsOf(metric, fills) : ""}
      data-province-outlines={outlines ? "on" : "off"}
      data-zoom={cam.zoom}
      data-center={`${cam.lat.toFixed(3)},${cam.lng.toFixed(3)}`}
    >
      <Map
        mapId={MAP_ID}
        colorScheme={theme === "dark" ? "DARK" : "LIGHT"}
        mapTypeId={mapType === "satellite" ? "hybrid" : "terrain"}
        defaultCenter={DEFAULT_VIEW.center}
        defaultZoom={DEFAULT_VIEW.zoom}
        gestureHandling="greedy"
        disableDefaultUI
        mapTypeControl={false}
        onClick={onMapClick}
      >
        <ProvinceOutlines provinces={provinces} selected={selected} showAll={outlines} light={mapType === "satellite" || theme === "dark"} fills={fills} hover={hover?.pcode ?? null} />
        {overview && <OverviewHover provinces={provinces} onHover={setHover} />}
        <CameraProbe onCamera={setCam} />
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
      <MapControls lang={lang} onLocate={setMe} onGlobe={() => setGlobe(true)} onResetView={() => setGlobe(false)} boundaries={{ visible: outlines, onChange: setOutlines }} fullscreenTarget={wrap} layers={items} reference={staticItems} onLayerChange={onLayerChange} />

      {overview && hover && (
        <OverviewTip lang={lang} hover={hover} wrap={wrap} province={provinces.find((p) => p.pcode === hover.pcode)} data={byPcode[hover.pcode]} metric={metric} />
      )}
      {overview && !globe && (
        <div className={cn("pointer-events-none absolute flex justify-center", short ? "top-3 right-16 w-80 max-w-[calc(100cqw-25.25rem)]" : "top-[4.25rem] right-16 left-3 @2xl:top-auto @2xl:right-3 @2xl:bottom-9 @2xl:left-[16.5rem]")}>
          <OverviewSlider lang={lang} series={overview.series} day={overview.day} metric={metric} playing={overview.playing} onDay={onOverviewDay} onMetric={onOverviewMetric} onPlay={onOverviewPlay} />
        </div>
      )}

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
              className="flex min-h-9 items-center gap-1.5 rounded-[4px] border bg-card/90 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11 coarse:text-sm"
            >
              <ArrowLeft className="size-4" aria-hidden />
              {tr.globeBack}
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-9 left-3 flex flex-col items-start gap-2 short:flex-row short:items-end">
        {overviewLegend && <MapLegend lang={lang} title={overviewLegend.title} items={overviewLegend.items} overview />}
        {top && <MapLegend lang={lang} title={top.name} items={top.legend} />}
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

/** Mirrors the camera into React state (on idle) so the wrapper can expose zoom/center. */
function CameraProbe({ onCamera }: { onCamera: (c: { zoom: number; lat: number; lng: number }) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const read = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      if (c && z != null) onCamera({ zoom: z, lat: c.lat(), lng: c.lng() });
    };
    read();
    const l = map.addListener("idle", read);
    return () => l.remove();
  }, [map, onCamera]);
  return null;
}

const OUTLINE_LIGHT = "#f2c98a"; // brand amber, readable on satellite and dark base maps
const OUTLINE_DARK = "#8a4b24"; // brand brown, for the light terrain map

/**
 * Province outlines on the map's Data layer (never clickable: selection is done by point-in-polygon in the map click handler).
 * showAll=false hides the thin outlines but keeps the selected province's highlight. Selecting a province fits the view to it;
 * if the map is hidden (mobile chat tab) the fit waits until it has a size.
 */
function ProvinceOutlines({ provinces, selected, showAll, light, fills, hover }: { provinces: Province[]; selected: Province | null; showAll: boolean; light: boolean; fills: ReadonlyMap<string, Fill> | null; hover: string | null }) {
  const map = useMap();
  const pending = useRef<Province | null>(null);
  const color = light ? OUTLINE_LIGHT : OUTLINE_DARK;
  const code = selected?.pcode;

  useEffect(() => {
    if (!map || provinces.length === 0) return;
    const feats = map.data.addGeoJson({
      type: "FeatureCollection",
      features: provinces.map((p) => ({ type: "Feature", properties: { pcode: p.pcode }, geometry: p.geometry })),
    });
    return () => feats.forEach((f) => map.data.remove(f));
  }, [map, provinces]);

  useEffect(() => {
    if (!map) return;
    map.data.setStyle((f) => {
      if (f.getProperty("pcode") === code) {
        return { clickable: false, strokeColor: color, strokeWeight: 3, strokeOpacity: 0.95, fillColor: color, fillOpacity: 0.12, zIndex: 2 };
      }
      if (fills) {
        const pc = String(f.getProperty("pcode"));
        const fl = fills.get(pc) ?? { color: "#a8a29e", opacity: 0.14 };
        const hot = pc === hover;
        return { clickable: false, fillColor: fl.color, fillOpacity: fl.opacity, strokeColor: color, strokeWeight: hot ? 2.5 : showAll ? 1 : 0, strokeOpacity: hot ? 0.95 : 0.45, zIndex: hot ? 2 : 1 };
      }
      return showAll
        ? { clickable: false, strokeColor: color, strokeWeight: 1, strokeOpacity: 0.45, fillOpacity: 0, zIndex: 1 }
        : { clickable: false, visible: false };
    });
  }, [map, code, showAll, color, provinces, fills, hover]);

  useEffect(() => {
    if (!map) return;
    const div = map.getDiv();
    const fit = () => {
      const p = pending.current;
      if (!p || div.clientWidth === 0 || div.clientHeight === 0) return;
      pending.current = null;
      const [w, s, e, n] = p.bbox;
      map.fitBounds({ west: w, south: s, east: e, north: n }, 48);
    };
    pending.current = selected; // null on the initial load: no fit, no zoom
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(div);
    return () => ro.disconnect();
  }, [map, selected]);

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

/** Reports the province under the pointer (point-in-polygon on the loaded outlines) while the overview choropleth is showing. */
function OverviewHover({ provinces, onHover }: { provinces: Province[]; onHover: (h: { pcode: string; x: number; y: number } | null) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map || provinces.length === 0) return;
    let raf = 0;
    let last: { lat: number; lng: number; x: number; y: number } | null = null;
    const flush = () => {
      raf = 0;
      if (!last) return;
      const hit = findProvince(provinces, last.lat, last.lng);
      onHover(hit ? { pcode: hit.pcode, x: last.x, y: last.y } : null);
    };
    const move = map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      const dom = e.domEvent as MouseEvent | undefined;
      if (!e.latLng || !dom || !("clientX" in dom)) return;
      const r = map.getDiv().getBoundingClientRect();
      last = { lat: e.latLng.lat(), lng: e.latLng.lng(), x: dom.clientX - r.left, y: dom.clientY - r.top };
      if (!raf) raf = requestAnimationFrame(flush);
    });
    const out = map.addListener("mouseout", () => {
      last = null;
      onHover(null);
    });
    return () => {
      move.remove();
      out.remove();
      if (raf) cancelAnimationFrame(raf);
      onHover(null);
    };
  }, [map, provinces, onHover]);
  return null;
}

/** Small tooltip next to the pointer: province, the active metric's value and the tambon count above trigger. */
function OverviewTip({ lang, hover, wrap, province, data, metric }: {
  lang: Lang; hover: { x: number; y: number }; wrap: HTMLDivElement | null; province: Province | undefined; data: OverviewProvinceDay | undefined; metric: OverviewMetric;
}) {
  const tr = t(lang);
  const nf = numFmt(lang);
  if (!province) return null;
  const value =
    metric === "risk"
      ? data && data.risk_class >= 1 ? fmt(tr.ovTipRisk, { c: riskName(data.risk_class, lang) }) : tr.ovTipRiskNone
      : data?.rain_mm != null ? fmt(tr.ovTipRain, { mm: nf.format(Math.round(data.rain_mm * 10) / 10) }) : tr.ovTipRainNA;
  // Placed beside the pointer: tries right/below, left/below, right/above, left/above (then above/below centred) and takes the first spot that is inside the map
  // and does not cover another overlay (legend, slider, tools...); falls back to a clamped position.
  const place = (el: HTMLDivElement | null) => {
    if (!el || !wrap) return;
    const w = el.offsetWidth, h = el.offsetHeight, W = wrap.clientWidth, H = wrap.clientHeight;
    const wr = wrap.getBoundingClientRect();
    const others = [...wrap.querySelectorAll<HTMLElement>("[data-map-overlay]")]
      .filter((o) => o !== el && o.getAttribute("data-map-overlay") !== "tooltip" && o.checkVisibility())
      .map((o) => o.getBoundingClientRect());
    const clamp = (x: number, y: number) => ({ x: Math.max(4, Math.min(x, W - 4 - w)), y: Math.max(4, Math.min(y, H - 4 - h)) });
    const overlap = (p: { x: number; y: number }) => others.reduce((sum, r) => {
      const ox = Math.min(p.x + w + wr.left, r.right) - Math.max(p.x + wr.left, r.left);
      const oy = Math.min(p.y + h + wr.top, r.bottom) - Math.max(p.y + wr.top, r.top);
      return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
    }, 0);
    const near = [[12, 12], [-12 - w, 12], [12, -12 - h], [-12 - w, -12 - h], [-w / 2, -16 - h], [-w / 2, 16]].map(([dx, dy]) => clamp(hover.x + dx, hover.y + dy));
    // Fallback spots hugging an overlay's edge (just right of / left of / above / below it) at the pointer's row/column.
    const edge = others.flatMap((r) => [
      clamp(r.right - wr.left + 6, hover.y + 12), clamp(r.left - wr.left - 6 - w, hover.y + 12),
      clamp(hover.x + 12, r.top - wr.top - 6 - h), clamp(hover.x + 12, r.bottom - wr.top + 6),
    ]);
    const dist = (c: { x: number; y: number }) => Math.abs(c.x - hover.x) + Math.abs(c.y - hover.y);
    const first = near.find((c) => overlap(c) === 0);
    const pos = first ?? [...near, ...edge].reduce((best, c) => (overlap(c) * 1000 + dist(c) < overlap(best) * 1000 + dist(best) ? c : best), near[0]);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  };
  return (
    <div
      ref={place}
      role="status"
      data-testid="overview-tip"
      data-map-overlay="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-52 space-y-0.5 rounded-[4px] border bg-card/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md"
      style={{ left: hover.x, top: hover.y }}
    >
      <p className="font-semibold">{pick(lang, province.name, province.name_th)}</p>
      <p>{value}</p>
      {data && <p className="text-muted-foreground">{fmt(tr.chipTriggered, { n: nf.format(data.triggered), m: nf.format(data.tambons) })}</p>}
    </div>
  );
}
