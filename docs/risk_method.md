# Tambon-level landslide risk method

This is the default method (`HAZARD_MODEL=tambon`). The older weighted-overlay method is still available as `HAZARD_MODEL=screening` and is described in [method.md](method.md).

Settings are in `apps/api/app/config/tambon_risk.yaml`. The Earth Engine code is `app/geo/tambon_risk.py` and the service layer is `app/geo/tambon_backend.py`.

## The calculation

```
risk = trigger × susceptibility × vulnerability × exposure ÷ 125
```

Each factor is a class from 1 to 5 (the trigger can also be 0), so the result runs from 0 to 5.

| Factor | Input | How the class is set |
|---|---|---|
| Trigger | The tambon's 30-day rainfall, compared with that tambon's own rainfall thresholds (P60, P70, P80, P90, P95) | The highest threshold that the rainfall exceeds gives the class: P60 is 1 up to P95 is 5. Below P60 the trigger is 0 and there is no risk |
| Susceptibility | A landslide susceptibility map, 0 to 100, at 12 m. Pixels below 10 are treated as not susceptible | Z-score classes: class breaks at the mean plus -1.5, -0.5, 0.5 and 1.5 standard deviations |
| Vulnerability | Combined vulnerability index, 0 to 0.50 across the country | `ceil(value × 10)`, kept between 1 and 5 |
| Exposure | Combined exposure index, 0.07 to 0.82 across the country | `ceil(value × 5)`, kept between 1 and 5 |

The susceptibility statistics used for the class breaks are national (computed on 2026-10-13 at 1 km, for pixels of 10 or more): mean 41.379 and standard deviation 19.861. They are stored in the config file and are not recomputed per request. If the susceptibility map is replaced they have to be recomputed.

The multipliers for vulnerability and exposure come from the national maxima (0.5006 and 0.8187), so their classes use the whole 1 to 5 range.

The Earth Engine paths of the layers are project-specific and are kept in `apps/api/app/config/risk_layers.local.yaml`, which is not committed. The template is `risk_layers.local.yaml.example`. `GET /readyz` reports whether the running identity can read each layer.

## Rainfall

- **Observed rain** is JAXA GSMaP, which is the default. The tambon thresholds were derived from GSMaP, so using it keeps the comparison consistent. NASA IMERG can be selected with `trigger.observed_source: imerg`. In one comparison IMERG triggered 74 tambons where GSMaP triggered 91.
- **What-if scenario** (X mm over D hours): the 30-day total is the observed rain of the preceding `30 - ceil(D/24)` days plus X, applied evenly over the area.
- **Forecast** (H days): the observed rain of the preceding `30 - H` days plus the NOAA GFS accumulated forecast for the next H days. Observed products do not forecast, which is why GFS is used.
- **Daily files:** observed and forecast rainfall per tambon is precomputed by `scripts/precompute_rain.py` into `obs_daily.json`, so moving the slider does not touch the rainfall data again. Observed data older than 3 days makes the overview unavailable. A forecast run older than 36 hours drops the dashboard back to observed rain only.

## Results

- **Map layers:** risk (shown by default), trigger class, 30-day rainfall, susceptibility, vulnerability and exposure.
- **Tambon table:** tambon, amphoe, trigger class, 30-day rain, peak risk, share of the tambon in the elevated zone, exposure class and people in the elevated zone (WorldPop 2020).
- **Elevated zone:** risk class 3 or higher, which is a risk value of 2 or more (`risk.exposure_from`). The class breaks are national and relative, and almost no pixel reaches "High" (a value of 3 or more). Nan peaks at about 2.4 even with 300 mm of rain. Counting only "High" would show 0 for nearly every province.
- **Hospitals and schools at risk:** named hospitals and schools (OpenStreetMap) are listed when their risk reaches the lowest class (a value of 1 or more). A facility's risk is its tambon's trigger class times the static risk product at its location, divided by 125. Only the 143 or so named facilities that could ever reach that value are kept in `facilities.json`. OpenStreetMap tags are not always right (one "hospital" in the data is a café), so treat the list as a starting point.
- **Buildings, hospitals, schools and roads** come from the precomputed feature file: built-up area from GHSL (buildings are an estimate from that area) and the rest from OpenStreetMap. When the file is missing these numbers are reported as unavailable, never as 0.

## Choices worth knowing about

- **Landslide-prone ground (our adjustment).** The susceptibility map has a few stray susceptible pixels even in flat cities (embankments, ramps), and those sit among many people. Without a check, Bangkok came out as "Moderate" risk with about 2,600 people in the elevated zone, from 0.2 km² of pixels. A tambon now counts as landslide-prone only if at least 1 km² and at least 2 % of it is susceptible (`landslide_prone` in `tambon_risk.yaml`, set both to 0 to switch it off). Other tambons are shown with no risk, are left out of the triggered counts and the people and facility figures, and are left out of the risk layer. With these settings 3,107 of the 7,425 tambons in 67 provinces count as prone.
- A tambon with no threshold in the table gets trigger class 0. Treating a missing value as 0 would make any rainfall exceed every threshold and give class 5.
- Trigger classes are worked out once per tambon and then used as a lookup, so the rainfall reduction is not repeated for every layer.
- The what-if rule above (adding the scenario rain to the observed rain of the earlier days) and the elevated-zone cut-off are our choices. They have not been checked against another reference.

## Running the precomputes

From `apps/api`, see the README section "Build the data files":

- `scripts/build_risk_layer.py` (one-off) exports the 100 m static layer as an Earth Engine asset in `EE_PROJECT` and records it as `risk_static_asset` in `assets.local.yaml`.
- `scripts/precompute_facilities.py` (one-off) writes `facilities.json`.
- `scripts/precompute_static_stats.py` and `scripts/precompute_features.py` (one-off) write `static_stats.json` and `static_features.json`. Re-run them when the susceptibility, vulnerability or exposure layers change.
- `scripts/precompute_rain.py` (daily) writes `obs_daily.json`. It runs in the cloud as the `dnext-rain` job, twice a day.
