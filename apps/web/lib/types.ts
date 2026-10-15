// Types mirror docs/event_contract.md (agent-to-UI SSE contract).
export type Lang = "en" | "th";

/** `_th` fields are optional Thai variants of server-built text; the UI falls back to the English field when missing or empty. */
export interface LegendItem { label: string; label_th?: string; color: string }

export interface MapLayer {
  id: string;
  name: string;
  name_th?: string;
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
  name_th?: string;
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
  markers: { lat: number; lng: number; name: string; kind: MarkerKind; name_th?: string; risk?: number; risk_class_name?: string; risk_class_name_th?: string; tambon?: string; tambon_th?: string }[];
}

export interface TableData {
  id: string;
  title: string;
  title_th?: string;
  columns: string[];
  columns_th?: string[];
  rows: (string | number | null)[][];
  rows_th?: (string | number | null)[][]; // same shape as rows, localized cells
  scenario_id?: string;
}

export interface ChartData {
  id: string;
  title: string;
  title_th?: string;
  kind: "bar";
  x_label: string;
  x_label_th?: string;
  y_label: string;
  y_label_th?: string;
  data: { label: string; label_th?: string; value: number; series?: string }[];
}

export interface Kpis {
  scenario_id: string;
  area_name: string;
  area_name_th?: string;
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
  limitations_th?: string[]; // parallel to limitations
  extras?: KpiExtras;
}

/** Optional extra figures; null = not available (never render as 0). */
export interface KpiExtras {
  triggered_tambons?: number | null;
  tambons_total?: number | null;
  high_risk_people?: number | null;
  trigger_source?: string;
  trigger_source_th?: string;
  rain_window?: string;
  rain_window_th?: string;
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

/** GET /overview/series: national current conditions (h=0, observed) and cumulative forecast days (h=1..5). */
export interface OverviewProvinceDay {
  pcode: string;
  risk_class: number; // 0 = nothing triggered / no susceptible ground, 1..5 = risk classes Very low .. Very high
  risk_max: number;
  triggered: number;
  tambons: number;
  max_trigger: number;
  people_elevated: number;
  rain_mm: number | null; // province-mean rain of that single day
  triggered_share: number;
  name?: string;
  name_th?: string;
  // Counted inside the Moderate-or-higher zone; absent when the features precompute is missing.
  buildings?: number;
  hospitals?: number;
  schools?: number;
  road_km?: number;
}
export interface OverviewTop {
  pcode: string;
  name: string;
  name_th: string;
  risk_max: number;
  risk_class: number;
  triggered: number;
  tambons: number;
  people_elevated: number;
}
/** Exposure inside the Moderate-or-higher risk zone nationally. null (on the day) = features precompute missing. */
export interface OverviewElevated { buildings: number; hospitals: number; schools: number; road_km: number }
/** One risk class on susceptible ground in tambons above their trigger. Feature fields are absent when not computed. */
export interface OverviewClass {
  class: number; // 1..5
  name: string;
  area_km2: number;
  people: number;
  buildings?: number;
  hospitals?: number;
  schools?: number;
  road_km?: number;
}
export interface OverviewDay {
  h: number; // 0 = latest observed, 1..5 = forecast days
  date: string; // YYYY-MM-DD
  totals: { tambons_total: number; triggered: number; high_trigger: number; provinces_triggered: number; provinces_total: number; people_elevated: number | null };
  provinces: OverviewProvinceDay[];
  top: OverviewTop[];
  elevated?: OverviewElevated | null;
  classes?: OverviewClass[];
  /** Number of tambons with trigger class 0..5 (6 numbers). */
  trigger_classes?: number[];
}
export interface OverviewSeries {
  date_of_data: string;
  source: string;
  model_run_time: string;
  max_days: number;
  limitations: string[];
  days: OverviewDay[];
  forecast_available?: boolean;      // false = only day 0 (forecast data out of date)
  forecast_note?: string | null;
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
