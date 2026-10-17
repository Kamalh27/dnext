# AI Builder Cup 2026: submission text

Copy-ready answers for the submission form. The deck is `DNext_proposal.pdf` (14 slides) and the editable `DNext_proposal.pptx`, both in this folder.

## Project

**Team:** DNext (Disaster Next) Team: Kamal Hosen (Geospatial Application Developer, kamal.hosen@adpc.net) and Hafsah Ilmy (Geospatial Data Scientist, Landslide Model Developer, hafsah.ilmy@adpc.net). See [../team.md](../team.md).

**Name:** DNext · LandslideWatch TH

**One line:** Landslide risk screening for Thailand in plain language: where heavy rain is most likely to trigger landslides, and who and what sits in the way.

**Theme:** Sustainability & Social Impact

**Category:** Sustainability

**Live prototype (Cloud Run):** https://dnext-web-37ob55mcga-as.a.run.app

## Problem statement

Heavy rain sets off landslides on susceptible slopes across Thailand every rainy season. The data needed to judge the risk (rainfall, slope susceptibility, population, buildings, roads) sits in separate systems and takes a specialist to combine. People who plan ahead need three quick answers: which sub-districts are close to their rainfall trigger, who and what lies in the way, and where people can go.

## What it does

DNext compares each tambon's observed and forecast rainfall with that tambon's own rainfall thresholds, and combines the result with national susceptibility, vulnerability and exposure layers. The result is a risk class from 0 to 5 for all 7,425 tambons in 77 provinces, shown on a map with a five-day forecast.

Users ask questions in English or Thai ("What if 250 mm falls on Nan in 3 days?", "Which provinces have the highest risk this week?", "How many schools and hospitals are at risk in Chon Buri?") and get a ranked answer, a table and the exposed people, buildings, main roads, hospitals and schools. Follow-up questions keep the place, the time and the risk class. Signed-in users can watch provinces and get an alert in the app when risk rises, export an editable PDF report, preview a route to candidate safe places, and send a photo report of a landslide or blocked road that Gemini and the area's data check before it is shown.

## How Gen AI is used

- A Gemini agent on Vertex AI, built with Google's Agent Development Kit, understands the question in English or Thai, chooses among ten tools and explains the result. The tools compute every number; the model never supplies figures.
- Gemini vision reads community photos (landslide, blocked road, slope damage) and the result is checked against the area's data before anything is shown. Photos are analysed once and never stored.
- A 20-case evaluation set and more than 260 automated tests cover tool choice, limits and security.

## Google products used

Gemini on Vertex AI, Agent Development Kit, Earth Engine, Open Buildings, Cloud Run (web, API and a daily job), Cloud Scheduler, Cloud Storage, Firestore, BigQuery, Pub/Sub, Firebase Authentication, Google Maps Platform (Maps JavaScript, Geocoding, Routes), Secret Manager, Artifact Registry, Cloud Build, Cloud Logging, Google Forms.

## Feasibility and scalability

The expensive statistics are precomputed twice a day by a Cloud Run job, so a five-day national overview answers in about 0.2 s and a scenario in roughly 1 to 8 s. Cloud Run scales with traffic. Per-account daily limits, photos that are not stored and records that expire on their own keep cost and data in check. The same app can cover another country or another rainfall-triggered hazard by replacing the national layers.

## Limits, stated plainly

A screening tool for planning, not a warning or an evacuation order. Not calibrated for single slopes or villages; classes are relative, not probabilities. What-if rain is assumed uniform. People and buildings are rounded estimates, and OpenStreetMap can be incomplete. Safe places are candidates, and community reports are checked by AI but not verified.

## How to try it

1. Open the link. The national map and the five-day forecast (press play) show without signing in.
2. Sign in with Google to use the chat, scenarios, routes and reports (per-account daily limits apply).
3. Try: "What if 250 mm falls on Nan in 3 days?", then "Which provinces have the highest landslide risk this week?", then "How many schools and hospitals are at risk there?"
