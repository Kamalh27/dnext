// Types mirror docs/event_contract.md (agent-to-UI SSE contract).
export type Lang = "en" | "th";

export interface LegendItem { label: string; color: string }

export interface MapLayer {
  id: string;
  name: string;
  tile_url: string;
  opacity: number;
  bbox: [number, number, number, number]; // [w, s, e, n]
  legend: LegendItem[];
  scenario_id: string;
}

/** One layer of a `map_layers` set. `tile_url` may be "" (mock mode): the layer is listed but nothing is drawn. */
export interface MapLayerItem {
  id: string;
  key: string; // risk | trigger | rain | susceptibility | vulnerability | exposure
  name: string;
  tile_url: string;
  opacity: number; // 0..1
  visible: boolean;
  legend: LegendItem[];
  group?: "scenario" | "static"; // missing = scenario
}

/** One reference layer from `GET /layers/static` (available without a scenario; tile URLs expire). */
export interface StaticLayerItem extends MapLayerItem {
  key: "susceptibility" | "vulnerability" | "exposure" | "population";
  group: "static";
}

export interface StaticLayersResponse {
  layers: StaticLayerItem[];
  expires_in_s: number;
}

/** A new `map_layers` event REPLACES the previous set. */
export interface MapLayersEvent {
  scenario_id: string;
  bbox: [number, number, number, number]; // [w, s, e, n]
  layers: MapLayerItem[];
}

export type MarkerKind = "school" | "hospital" | "shelter" | "bridge";
export interface MapMarkers {
  id: string;
  markers: { lat: number; lng: number; name: string; kind: MarkerKind }[];
}

export interface TableData {
  id: string;
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
  scenario_id?: string;
}

export interface ChartData {
  id: string;
  title: string;
  kind: "bar";
  x_label: string;
  y_label: string;
  data: { label: string; value: number; series?: string }[];
}

export interface Kpis {
  scenario_id: string;
  area_name: string;
  area_code?: string; // province pcode, e.g. "TH55"
  kind?: "what_if" | "forecast";
  rainfall_mm?: number | null;
  duration_h?: number | null;
  horizon_days?: number | null;
  model_run_time?: string | null;
  // null = that layer is not built yet (API never fabricates a value)
  people: number | null;
  households_est: number | null;
  buildings: number | null;
  road_km: number | null;
  schools: number | null;
  hospitals: number | null;
  data_sources: string[];
  resolution_m: number;
  date_of_data: string;
  limitations: string[];
  extras?: KpiExtras;
}

/** Optional extra figures; null = not available (never render as 0). */
export interface KpiExtras {
  triggered_tambons?: number | null;
  tambons_total?: number | null;
  high_risk_people?: number | null;
  trigger_source?: string;
  rain_window?: string;
}

export interface Explain {
  factors: { name: string; value: string | number; contribution: number }[];
  summary: string;
}

/** One province from /provinces.json (77 entries). */
export interface Province {
  pcode: string; // e.g. "TH55"
  name: string;
  name_th: string;
  bbox: [number, number, number, number]; // [w, s, e, n]
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

/** Shared by POST /scenario and POST /forecast. Every key is optional; marker and chart sets may arrive as one item or a list. */
export interface ScenarioResponse {
  map_layer?: MapLayer;
  map_layers?: MapLayersEvent;
  kpis?: Kpis;
  chart?: ChartData | ChartData[];
  map_markers?: MapMarkers | MapMarkers[];
  table?: TableData;
  tables?: TableData[]; // all table events; preferred over `table`
}
export type ForecastResponse = ScenarioResponse;

export type SseEvent =
  | { event: "status"; data: { stage: string; label: string } }
  | { event: "text_delta"; data: { text: string } }
  | { event: "map_layer"; data: MapLayer }
  | { event: "map_layers"; data: MapLayersEvent }
  | { event: "map_markers"; data: MapMarkers }
  | { event: "table"; data: TableData }
  | { event: "chart"; data: ChartData }
  | { event: "kpis"; data: Kpis }
  | { event: "final"; data: { session_id: string } }
  | { event: "error"; data: { message: string } };
