# Agent-to-UI SSE contract
`POST /chat` body `{message, session_id, language: "en"|"th"}` -> SSE stream. Each SSE `event:` name is the type, `data:` is JSON.

| event | data |
|---|---|
| status | `{stage: string, label: string}` (e.g. resolving_place, computing_hazard) |
| text_delta | `{text: string}` |
| map_layer | `{id, name, tile_url, opacity, bbox:[w,s,e,n], legend:[{label,color}], scenario_id}` |
| map_markers | `{id, markers:[{lat,lng,name,kind}]}` kind: school\|hospital\|shelter\|bridge. Emitted after kpis for any scenario/forecast/get_exposure result (<=200 markers). |
| table | `{id, title, columns:[str], rows:[[...]], scenario_id?}` |
| chart | `{id, title, kind:"bar", x_label, y_label, data:[{label,value,series?}]}` |
| kpis | `{scenario_id, area_name, people, households_est, buildings, road_km, schools, hospitals, shelters, kind:"what_if"\|"forecast", data_sources:[str], resolution_m, date_of_data, limitations:[str]}` plus, when `kind=="forecast"`: `forecast_rain_mm, observed_rain_mm, horizon_days, model_run_time` |
| final | `{session_id}` |
| error | `{message}` |

Forecast (`get_forecast_hazard`) emits map_layer, kpis (with forecast fields), chart (top units), map_markers, a `table` (id `<sid>-forecast`: observed mm, forecast mm, horizon days, model run time) and a `chart` (id `<sid>-rain`, observed vs forecast). The UI must label forecast results "observed + forecast rainfall, model run <model_run_time>". `get_exposure` emits only `map_markers`. `generate_briefing` emits no UI event; the UI links `GET /briefing/{scenario_id}`.

## REST
- `POST /scenario` body `{area, rainfall_mm, duration_h}` -> JSON `{map_layer, kpis, chart, map_markers?}` (same payloads as the SSE events; 422 + `detail` on invalid input, e.g. rainfall > limit or place outside Thailand).
- `POST /forecast` body `{area, horizon_days=5}` -> JSON `{map_layer, kpis, chart, map_markers?, table}`.
- `GET /explain?lat&lng&scenario_id?` -> `{factors:[{name,value,contribution}], limitations, scenario?:{scenario_id, area, rainfall_mm, duration_h}}`.
- `GET /briefing/{scenario_id}?language=en|th&format=md|html` -> markdown (`text/markdown`) or print-ready HTML (browser print-to-PDF). 404 if scenario unknown/expired (cache TTL: 24 h forecast, 30 d what-if); a copy is stored under `gs://$PROJECT_ID-dnext/briefings/` (local: `./.local_storage/`).
- All responses carry `X-Request-ID`; non-SSE routes time out after 60 s (504).

## Agent tools (all return `{status: "ok"|"error", ...}`, never raise)
`resolve_area`, `get_hazard_scenario`, `get_forecast_hazard(area, horizon_days=5)`, `get_exposure(area, scenario_id?, min_class="High")`, `compare_scenarios`, `explain_cell_or_village(lat, lng, scenario_id?)`, `generate_briefing(scenario_id, language="en")` -> `{markdown, download_path}`.
Scenario results additionally contain `kind`, `exposure.{building_area_m2, road_km_by_class, shelters, facilities:[{lat,lng,name,kind}], top_admin_units:[{name,name_th,admin_code,people,buildings,road_km}]}`, `hazard.{antecedent_mm, antecedent_days}`, and for forecasts `forecast:{forecast_rain_mm, observed_rain_mm, horizon_days, model_run_time}`.
