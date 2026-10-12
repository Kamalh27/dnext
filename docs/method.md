# Method

Screening-level landslide hazard and exposure for Thailand. Every parameter below is read from `apps/api/app/config/`; change the YAML, not the code. Pixel math is implemented twice and kept in sync: `app/geo/ee_model.py` (Earth Engine) and `app/geo/hazard_math.py` (pure Python, used in tests).

## 1. Static susceptibility S (0-1)

Weighted overlay of eight conditioning factors, each normalised to 0..1 at ~100 m:

`S = sum_i w_i * f_i`  with weights from `config/weights.yaml` (sum = 1).

| Factor | Weight | Normalisation (`weights.yaml`) | Rationale |
|---|---|---|---|
| `slope` | 0.35 | 0-45 deg linear | Dominant control on shallow landslide initiation; most studies (incl. LHASA) weight it highest. |
| `landcover` | 0.15 | WorldCover class score (`landcover_score`): bare 0.9, crop 0.7, shrub 0.6, tree/grass 0.5, built 0.3, wetland/mangrove 0.1, water 0 | Vegetation and land use affect root cohesion and infiltration; scores are expert judgement. |
| `forest_loss` | 0.10 | binary: Hansen loss in last 10 y where 2000 cover > 30 % | Recent clearing reduces root reinforcement. |
| `soil_clay` | 0.10 | 0-60 % linear | Clay-rich soils hold water, lose strength when saturated. |
| `stream_proximity` | 0.10 | 1 at <=100 m from channel, 0 at >=2000 m (`channel_upa_km2` = 5) | Toe-cutting and saturation near channels. |
| `elevation_relief` | 0.10 | local relief in 500 m radius, 0-600 m | Steep, high-relief terrain feeds debris-flow runout. |
| `curvature` | 0.05 | -0.05..0.05 (convex = higher) | Concave hollows concentrate flow; low weight because 30 m DEM curvature is noisy. |
| `soil_sand` | 0.05 | 0-80 % linear | Coarse soils drain fast; small adjustment. |

The weights are **expert-judged priors**, not fitted coefficients. They are sanity-checked (not tuned to perfection) against observed landslides, see section 5.

## 2. Rainfall trigger ratio

Intensity-duration threshold (`config/thresholds.yaml`, `intensity_duration`):

`I = rain_mm / D_h` (mm/h),  `I_thr = alpha * D^beta`,  default Caine (1980): **alpha = 14.82, beta = -0.39**,

`TR = I / I_thr`.

TR >= 1 means the scenario exceeds the global threshold for landslide-triggering rainfall at that duration. Swap `alpha`/`beta` for a Thailand-specific curve when one is adopted. Rainfall is treated as **spatially uniform** over the area of interest.

## 3. Antecedent wetness

`W = clamp(sum_15d_IMERG_mm / reference_mm, 0, 1)` with `antecedent.days = 15`, `reference_mm = 300` (a 15-day total counted as fully wet). The 15-day sum uses IMERG V07 (mm/hr x 0.5 h per 30-min image). For pure what-if questions W defaults to the current antecedent wetness of the area (or 0 if unavailable, and the output says which).

## 4. Hazard and classes

`H = S * (1 - exp(-k * TR * (1 + a * W)))`, with `k = 1.2` (trigger steepness) and `a = 0.5` (`antecedent_gain`). H lies in [0, S]: no trigger gives no hazard; saturation cannot exceed the susceptibility.

Classes from `class_cutoffs: [0.15, 0.35, 0.60]`: **Low** < 0.15 <= **Moderate** < 0.35 <= **High** < 0.60 <= **Very High**. Colours: ColorBrewer YlOrRd (colour-blind safe).

Exposure: for each tambon the Earth Engine call sums, grouped by hazard class, population (WorldPop 100 m), building count/area, road metres per class, and facility counts. **Households = people / 2.5** (estimate). People are rounded to the nearest 100 (or 1,000 for large numbers) before display. "Exposed" = living in High or Very High pixels (the `min_class` parameter).

`k`, `a`, the cutoffs and the weights have not been optimised against data; they were set so that the global threshold (TR = 1) on steep, bare terrain gives High. They are the first thing to calibrate with local data.

## 5. Validation approach

1. **NASA Global Landslide Catalog (GLC)**: sample S at GLC points (accuracy `exact`, `1km`, `5km`) in Thailand and the Mekong region versus random background points, report ROC-AUC (`scripts/validate_susceptibility.py`, writes `scripts/out/validation.md`). Report the number from that run; do not quote one before it exists. GLC is event-reporting biased toward roads and towns and ends in 2016.
2. **LHASA cross-check**: Spearman rank correlation of S with the LHASA global 1 km susceptibility raster. LHASA-Mekong (ADPC/SERVIR) is the regional reference: doi:10.3389/feart.2022.1057796.
3. **Face validity**: known past events from local records should fall in high-S areas; flat delta plains should be near zero.

## 6. Honest limitations

- Screening level, 100 m: not slope-by-slope or village-by-village engineering assessment.
- Uniform rainfall over the area; real storms are patchy.
- No soil depth, lithology, groundwater, road cuts or drainage works.
- Rainfall threshold is global, not calibrated to Thailand; k, a and weights are judgement.
- Exposure is modelled (WorldPop, footprints or GHSL, OSM): estimates, not counts.
- Not an official warning. See `docs/limitations.md`.
