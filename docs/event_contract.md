# API and event contract

## Chat stream

`POST /chat` takes `{message, session_id, language: "en" | "th"}` and returns a Server-Sent Events stream. The `event:` name of each message is its type and `data:` is JSON.

| event | data |
|---|---|
| `status` | `{stage, label}`, for example `resolving_place` or `computing_hazard` |
| `text_delta` | `{text}`, a piece of the model's reply |
| `map_layer` | `{id, name, name_th, tile_url, opacity, bbox: [w, s, e, n], legend, scenario_id}`, the main risk layer |
| `map_layers` | `{scenario_id, bbox, layers}`, the full set of layers (risk, trigger, rainfall, susceptibility, vulnerability, exposure) |
| `map_markers` | `{id, markers: [{lat, lng, name, kind}]}` with `kind` one of `school`, `hospital`, `shelter` or `bridge`, at most 200 markers |
| `table` | `{id, title, title_th, columns, columns_th, rows, rows_th?, scenario_id?}` |
| `chart` | `{id, title, title_th, kind: "bar", x_label, y_label, data: [{label, label_th, value, series?}]}` |
| `kpis` | The headline numbers; see below |
| `final` | `{session_id}`, the end of the stream |
| `error` | `{message}` |

Names, legends, tables, charts and limitations come with Thai versions in `*_th` fields, so the interface can switch language without asking the API again.

### `kpis`

`{scenario_id, area_name, area_name_th, area_code, kind: "what_if" | "forecast", rainfall_mm, duration_h, people, households_est, buildings, road_km, schools, hospitals, shelters, data_sources, resolution_m, date_of_data, limitations, limitations_th}`

For forecasts it also has `forecast_rain_mm`, `observed_rain_mm`, `horizon_days` and `model_run_time`. In the tambon-level method there is an `extras` object with `triggered_tambons`, `tambons_total`, `high_risk_people`, `trigger_source`, `rain_window` and their Thai versions. Values the backend could not compute are `null`, never 0.

### What each tool sends

- A scenario sends `map_layer`, `map_layers`, `kpis`, `chart`, `table` (the tambon ranking) and `map_markers`.
- A forecast sends the same, plus a `table` (`<scenario_id>-forecast`: observed mm, forecast mm, horizon, model run time) and a `chart` of observed against forecast rain. The interface labels it "observed + forecast rainfall, model run <time>".
- `get_exposure` sends only `map_markers`.
- `generate_briefing` sends no event. The interface links to `GET /briefing/{scenario_id}`.

## REST endpoints

| Endpoint | What it returns |
|---|---|
| `POST /scenario` with `{area, rainfall_mm, duration_h}` | One object holding the payloads of the events above, with every table in a `tables` list. Answers 422 with `detail` for invalid input, such as too much rain or a place outside Thailand |
| `POST /forecast` with `{area, horizon_days}` (default 5) | The same payloads plus the forecast table |
| `GET /explain?lat&lng&scenario_id?` | What drives the result at a point, with its limitations |
| `GET /briefing/{scenario_id}?language=en\|th&format=md\|html` | A briefing as Markdown or print-ready HTML. Answers 404 when the scenario is unknown or has expired. A copy is stored under `gs://<project>-dnext/briefings/` (locally in `.local_storage/`) |
| `GET /overview?horizon_days=0` | National conditions by province, observed or observed plus forecast, from the daily files |
| `GET /overview/series?days=5` | The same for day 0 to day N, for the slider |
| `GET /layers/static` | Reference layers for the layers panel: susceptibility, vulnerability, exposure and population |
| `GET /auth/config` | Whether sign-in is required, the public Firebase web config and the limits |
| `GET /me` | The signed-in user and today's usage. Answers 401 when not signed in |
| `GET /readyz` | Whether the running identity can read each Earth Engine layer. Reports only true or false, never paths |
| `GET /healthz` | Liveness. Cloud Run answers this path itself on `run.app` addresses, so use `/readyz` there |

Every response carries an `X-Request-ID` header. Ordinary requests time out after 60 seconds with a 504. When sign-in is required, a missing token gives 401 and an exhausted budget gives 429 with a `Retry-After` header.

## Agent tools

Every tool returns `{status: "ok" | "error", ...}` and never raises.

`resolve_area`, `get_hazard_scenario(area, rainfall_mm, duration_h=72)`, `get_forecast_hazard(area, horizon_days=5)`, `get_exposure(area, scenario_id?, min_class="High")`, `compare_scenarios(area, rainfall_mm_list, duration_h=72)`, `explain_cell_or_village(lat, lng, scenario_id?)` and `generate_briefing(scenario_id, language="en")`, which returns `{markdown, download_path}`.

Scenario results also carry `kind`, an `exposure` object (building area, road length by class, shelters, facilities and the top administrative units), the `hazard` details, and for forecasts a `forecast` object.
