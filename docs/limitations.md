# What the tool can and cannot tell you

DNext is a screening tool for planning and situational awareness. It is not a forecast or warning service. Check results with local authorities and local conditions before acting on them.

## Reading the results

- **It answers "what if?"** Given an amount of rain over some hours, it shows which tambons would cross their rainfall thresholds and roughly how many people, buildings, hospitals, schools and kilometres of main road sit in the higher-risk zones.
- **Rain is treated as even.** A what-if scenario puts the same amount of rain everywhere in the area you ask about. Real storms are patchy, and a heavy cell over one valley matters more than the average.
- **The unit of analysis is the tambon.** Susceptibility is mapped at 12 m and the statistics are computed at about 100 m, but the rainfall trigger is a single value per tambon. The tool can point to a sub-district. It cannot say whether a particular house or road cut is safe.
- **Flat ground has no landslide risk here.** A tambon is treated as having landslide-prone ground only when at least 1 km² and 2 % of it is susceptible. Bangkok and most of the central plains therefore show no risk even when heavy rain exceeds their rainfall thresholds. The cut-offs are our adjustment and can be changed in `tambon_risk.yaml`.
- **The classes are relative.** The five risk classes are based on national breaks. They rank places against each other and are not probabilities. Almost no pixel reaches the top class, so the tool counts class 3 and above (the "elevated" zone).
- **Population and building figures are estimates.** Population comes from the WorldPop 2020 model, not a census. Households are people divided by 2.5. Buildings are estimated from satellite built-up area. People are rounded to the nearest 100 on purpose.
- **Hospitals, schools and roads come from OpenStreetMap,** which can be incomplete in remote areas and sometimes mis-tagged. The named list of hospitals and schools at risk only includes places that have a name in OpenStreetMap.
- **Safe places are candidates.** They are named places from OpenStreetMap on ground that stays at Very low risk in this model. Nobody has checked that they are open, big enough, safe from flooding or staffed, and the list is only as complete as the map. Treat them as ideas to confirm with local authorities, not as shelters.
- **Routes are ranked, not cleared.** A route preview comes from Google's road network and is ranked by how much of it follows main roads in the Moderate-or-higher zone of the result on screen. Small roads, road cuts and roads already closed are not in that data, so a route with no flagged section can still be blocked.
- **Community reports are checked by AI, not verified.** Gemini reads one photo and the data says whether the place could have a landslide. That filters out unrelated or edited pictures but cannot prove a photo is recent or taken where the person says. Reports are shown for 48 hours (7 days for slope damage) and are labelled as not verified by authorities.
- **Some ground information is missing.** Soil depth, rock type, groundwater, road cuts and drainage are not in the data, so the map cannot see weak soils, old landslide scars or blocked drains.
- **Recent rain matters.** Each tambon's 30-day rainfall comes from JAXA GSMaP satellite estimates, about a day behind real time. The forecast comes from NOAA GFS on a 25 km grid and gets less certain with lead time, especially for the peak.
- **The thresholds were derived from GSMaP.** Switching the observed source to IMERG gives different tambons (74 triggered against 91 in one comparison), so GSMaP stays the default.

## Good uses

Deciding which sub-districts to look at first, positioning supplies, comparing scenarios such as 150 mm against 300 mm, briefing a team, and starting a conversation with local staff.

## Poor uses

Evacuation orders, naming individual unsafe houses, insurance or legal decisions, or replacing a site visit and local knowledge.

## If something looks wrong

Local knowledge wins. Report problems to the maintainers through the feedback form in the app, and consult your local disaster authorities and geohazard specialists for decisions.
