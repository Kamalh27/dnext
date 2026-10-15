# API and event contract

## Chat stream

`POST /chat` takes `{message, session_id, language: "en" | "th", area?, current?, context?}` and returns a Server-Sent Events stream. `area` is the province selected in the app. `current` is the result on screen as a recipe, `{kind, area, rainfall_mm, duration_h | horizon_days, scenario_id}`, so that "this" and "what about 400 mm?" work after a slider run. `context` carries the last turns of a reopened saved chat, once, because the agent's memory is lost when the service restarts. The `event:` name of each message is its type and `data:` is JSON.

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

- A scenario sends `map_layer`, `map_layers`, `kpis`, `chart`, `table` (the tambon ranking), and `map_markers` and a second `table` (`<scenario_id>-facilities-table`) when named hospitals or schools are at risk. A marker carries `name_th`, `risk`, `risk_class`, `risk_class_name`, `tambon` and the Thai versions.
- A forecast sends the same, plus a `table` (`<scenario_id>-forecast`: observed mm, forecast mm, horizon, model run time) and a `chart` of observed against forecast rain. The interface labels it "observed + forecast rainfall, model run <time>".
- `get_exposure` sends only `map_markers`.
- `generate_briefing` sends no event. The interface links to `GET /briefing/{scenario_id}`.

## REST endpoints

| Endpoint | What it returns |
|---|---|
| `POST /scenario` with `{area, rainfall_mm, duration_h}` | One object holding the payloads of the events above, with every table in a `tables` list. Answers 422 with `detail` for invalid input, such as too much rain or a place outside Thailand |
| `POST /forecast` with `{area, horizon_days}` (default 5) | The same payloads plus the forecast table |
| `GET /explain?lat&lng&scenario_id?` | What drives the result at a point, with its limitations |
| `GET /briefing/{scenario_id}?language=en\|th&format=md\|html&print=1` | A briefing as Markdown or print-ready HTML. With `print=1` the HTML page opens the browser's print dialog, where the user can save it as a PDF. The report has the headline numbers, the tambon ranking, the hospitals and schools at risk and general guidance. Answers 404 when the scenario is unknown or has expired. A copy is stored under `gs://<project>-dnext/briefings/` (locally in `.local_storage/`) |
| `GET /overview?horizon_days=0` | National conditions by province, observed or observed plus forecast, from the daily files |
| `GET /report-data/{scenario_id}?language=en\|th` | What the report editor needs besides the result on screen: the guidance text, the named facilities, every tambon's risk and the area. Needs sign-in when it is required |
| `GET /overview/report-data?day=0&language=en\|th` | The same for the national overview: guidance text and named facilities. Public |
| `GET /geo/tambons/{pcode}` | Simplified outlines of one province's tambons, as `{pcode, tambons: {code: geometry}}`, cached for a day. Public |
| `GET /overview/report?day=0&language=en\|th&print=1` | A print-ready national overview report for one slider day: headline numbers, provinces ranked by peak risk, hospitals and schools at risk and general guidance. Public, like the overview. Answers 503 when the daily data is missing or stale |
| `GET /overview/series?days=5` | The same for day 0 to day N, for the slider |
| `GET /layers/static` | Reference layers for the layers panel: susceptibility, vulnerability, exposure and population |
| `GET /chats`, `GET /chats/{id}`, `PUT /chats/{id}`, `DELETE /chats/{id}` | Saved chats of the signed-in account (Firestore `chats/{account}/threads`, deleted 90 days after the last save). A chat holds its messages and the recipes of its runs, never map layers. Answer 401 when not signed in and 404 `history_unavailable` when sign-in is switched off, in which case the app keeps history in the browser only |
| `GET /trend/{pcode}?days=30` | A province's observed daily risk from the BigQuery history: `{pcode, available, days: [{date, risk_class, risk_max, triggered, tambons, people_elevated, rain_mm}]}`. `available` is false when there is no history store. Public |
| `GET /watchlist`, `PUT /watchlist` | The signed-in account's watched provinces (at most 10), the lowest risk class that triggers an alert (2 to 5, default 3). Alerts appear in the app only |
| `GET /alerts`, `POST /alerts/read` | The account's notifications (newest first, deleted after 30 days) and "mark all as read" |
| `POST /internal/new-data` | Pub/Sub push from the daily job. Accepts only the Google-signed token of the subscription's service account |
| `POST /photo-check` with `{image_b64, language, note?, scenario_id?}` | Gemini's description of the warning signs in one JPEG, PNG or WebP photo (at most 2 MB), the computed risk of the result on screen and a disclaimer. Uses the chat budget |
| `GET /shelters/near?lat&lng&k=6&kind=` | The nearest candidate safe places: `{available, places: [{kind, name, name_th, lat, lng, distance_m, bearing}], note}`. `kind` is a comma-separated list of `shelter, community, school, temple, hospital`. Public, limited to 60 requests a minute per address |
| `POST /route` with `{origin, destination, mode, scenario_id?}` | Up to three routes from the Google Routes API (`mode` is `DRIVE` or `WALK`, both points in Thailand, at most 150 km apart): `{routes: [{distance_m, duration_s, path: [[lat, lng]], risk_km, recommended, flagged}], scored, note}`. With a `scenario_id`, `risk_km` is the length that runs within 60 m of main-road pieces in the Moderate-or-higher zone, and the routes are ranked by it. Needs sign-in when it is required |
| `POST /reports` with `{image_b64, lat, lng, language, note?}` | A community report. Answers `{status: published\|review\|rejected, reason, kind, summary, observations, confidence, data_support, id?, merged?}`. Only `published` reports are shown. A report within 300 m of a similar one in the last 12 hours is merged into it |
| `GET /reports?west&south&east&north` | The published, unexpired, unflagged community reports (at most 200), newest first. Public |
| `POST /reports/{id}/flag` | Mark a report as wrong. Needs sign-in; three different accounts hide a report |
| `GET /infrastructure/{scenario_id}` | The buildings and main-road pieces inside the Moderate-or-higher zone of a result: `{buildings: [[lat, lng, area_m2, height_m, risk]], roads: [[risk, [[lng, lat], ...]]], road_km, truncated, available}`. Needs sign-in when it is required |
| `GET /auth/config` | Whether sign-in is required, the public Firebase web config and the limits |
| `GET /me` | The signed-in user and today's usage. Answers 401 when not signed in |
| `GET /readyz` | Whether the running identity can read each Earth Engine layer. Reports only true or false, never paths |
| `GET /healthz` | Liveness. Cloud Run answers this path itself on `run.app` addresses, so use `/readyz` there |

Every response carries an `X-Request-ID` header. Ordinary requests time out after 60 seconds with a 504. When sign-in is required, a missing token gives 401 and an exhausted budget gives 429 with a `Retry-After` header.

## Agent tools

Every tool returns `{status: "ok" | "error", ...}` and never raises.

`resolve_area`, `get_hazard_scenario(area, rainfall_mm, duration_h=72)`, `get_forecast_hazard(area, horizon_days=5)`, `get_exposure(area, scenario_id?, min_class="High")`, `compare_scenarios(area, rainfall_mm_list, duration_h=72)`, `explain_cell_or_village(lat, lng, scenario_id?)` and `generate_briefing(scenario_id, language="en")`, which returns `{markdown, download_path}`.

Scenario results also carry `kind`, an `exposure` object (building area, road length by class, shelters, facilities and the top administrative units), the `hazard` details, and for forecasts a `forecast` object.
