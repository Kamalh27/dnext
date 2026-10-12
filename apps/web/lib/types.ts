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
  people: number;
  households_est: number;
  buildings: number;
  road_km: number;
  schools: number;
  hospitals: number;
  data_sources: string[];
  resolution_m: number;
  date_of_data: string;
  limitations: string[];
}

export interface Explain {
  factors: { name: string; value: string | number; contribution: number }[];
  summary: string;
}

export interface ScenarioResponse { map_layer: MapLayer; kpis: Kpis; chart: ChartData }

export type SseEvent =
  | { event: "status"; data: { stage: string; label: string } }
  | { event: "text_delta"; data: { text: string } }
  | { event: "map_layer"; data: MapLayer }
  | { event: "map_markers"; data: MapMarkers }
  | { event: "table"; data: TableData }
  | { event: "chart"; data: ChartData }
  | { event: "kpis"; data: Kpis }
  | { event: "final"; data: { session_id: string } }
  | { event: "error"; data: { message: string } };
