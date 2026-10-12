# Agent-to-UI SSE contract
`POST /chat` body `{message, session_id, language: "en"|"th"}` -> SSE stream. Each SSE `event:` name is the type, `data:` is JSON.

| event | data |
|---|---|
| status | `{stage: string, label: string}` (e.g. resolving_place, computing_hazard) |
| text_delta | `{text: string}` |
| map_layer | `{id, name, tile_url, opacity, bbox:[w,s,e,n], legend:[{label,color}], scenario_id}` |
| map_markers | `{id, markers:[{lat,lng,name,kind}]}` kind: school\|hospital\|shelter\|bridge |
| table | `{id, title, columns:[str], rows:[[...]], scenario_id?}` |
| chart | `{id, title, kind:"bar", x_label, y_label, data:[{label,value,series?}]}` |
| kpis | `{scenario_id, area_name, people, households_est, buildings, road_km, schools, hospitals, data_sources:[str], resolution_m, date_of_data, limitations:[str]}` |
| final | `{session_id}` |
| error | `{message}` |

`POST /scenario` body `{area, rainfall_mm, duration_h}` returns the same map_layer/kpis/chart payloads as one JSON object `{map_layer, kpis, chart}` (used by slider).
`GET /explain?lat&lng&scenario_id` -> `{factors:[{name,value,contribution}], summary}`.
