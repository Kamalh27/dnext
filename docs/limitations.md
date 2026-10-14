# What the tool can and cannot tell you

DNext is a screening tool for planning and situational awareness. It is not a forecast or warning service. Check results with local authorities and local conditions before acting on them.

## Reading the results

- **It answers "what if?"** Given an amount of rain over some hours, it shows which tambons would cross their rainfall thresholds and roughly how many people, buildings, hospitals, schools and kilometres of main road sit in the higher-risk zones.
- **Rain is treated as even.** A what-if scenario puts the same amount of rain everywhere in the area you ask about. Real storms are patchy, and a heavy cell over one valley matters more than the average.
- **The unit of analysis is the tambon.** Susceptibility is mapped at 12 m and the statistics are computed at about 100 m, but the rainfall trigger is a single value per tambon. The tool can point to a sub-district. It cannot say whether a particular house or road cut is safe.
- **The classes are relative.** The five risk classes are based on national breaks. They rank places against each other and are not probabilities. Almost no pixel reaches the top class, so the tool counts class 3 and above (the "elevated" zone).
- **Population and building figures are estimates.** Population comes from the WorldPop 2020 model, not a census. Households are people divided by 2.5. Buildings are estimated from satellite built-up area. People are rounded to the nearest 100 on purpose.
- **Hospitals, schools and roads come from OpenStreetMap,** which can be incomplete in remote areas.
- **Some ground information is missing.** Soil depth, rock type, groundwater, road cuts and drainage are not in the data, so the map cannot see weak soils, old landslide scars or blocked drains.
- **Recent rain matters.** Each tambon's 30-day rainfall comes from JAXA GSMaP satellite estimates, about a day behind real time. The forecast comes from NOAA GFS on a 25 km grid and gets less certain with lead time, especially for the peak.
- **The thresholds were derived from GSMaP.** Switching the observed source to IMERG gives different tambons (74 triggered against 91 in one comparison), so GSMaP stays the default.

## Good uses

Deciding which sub-districts to look at first, positioning supplies, comparing scenarios such as 150 mm against 300 mm, briefing a team, and starting a conversation with local staff.

## Poor uses

Evacuation orders, naming individual unsafe houses, insurance or legal decisions, or replacing a site visit and local knowledge.

## If something looks wrong

Local knowledge wins. Report problems to the maintainers through the feedback form in the app, and consult your local disaster authorities and geohazard specialists for decisions.
