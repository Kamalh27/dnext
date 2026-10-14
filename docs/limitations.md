# What this tool can and cannot tell you (for officers and planners)

**DNext is a screening tool for planning and situational awareness. It is not a forecast or warning service.** Confirm results with local authorities and local conditions before acting.

## How to read the results
- **It answers "what if?"** Given a rainfall amount and duration, it shows where terrain is most likely to fail and roughly how many people, buildings, roads and facilities are in those zones.
- **Rain is assumed to fall evenly** over the whole area you ask about. Real storms are patchy; a heavy cell over one valley matters more than the average.
- **Map detail is about 100 m.** It can point to a hillside or a sub-district. It cannot say whether a particular house or road cut is safe.
- **Numbers are estimates.** Population comes from a model (WorldPop 2020), not a census count. "Households" is people divided by 2.5. Buildings come from satellite footprints (or a coarser built-up layer where footprints are missing). Roads and facilities come from OpenStreetMap, which can be incomplete in remote areas. People are rounded to the nearest 100 or 1,000 on purpose.
- **Some important ground information is missing.** Soil depth and rock type are not available in open global data, so the map cannot see weak or deep soils, old landslide scars, road-cut slopes or blocked drains.
- **The rain threshold is a global one.** It has not been calibrated to Thai conditions. The class (Low to Very High) is a relative ranking, not a probability.
- **Recent rain matters.** For "this week" questions we add recent satellite rainfall (about 1 day old) as a wetness factor. Forecast rain comes from the NOAA GFS model (about 25 km grid) and is uncertain, especially for the peak.

## Good uses
Prioritising which sub-districts to look at first, pre-positioning supplies, comparing scenarios (150 vs 300 mm), briefing leadership, and starting a conversation with local staff.

## Not good uses
Evacuation orders, naming individual unsafe houses, insurance or legal decisions, or replacing field inspection and local knowledge.

## If something looks wrong
Local knowledge wins. Report issues to the tool maintainers (see the README) and, for hazard decisions, consult local disaster authorities and geohazard specialists.
