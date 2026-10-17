# 3-minute demo video: script and shot list

Aim for about 450 spoken words at a calm pace. Record the live site at https://dnext-web-37ob55mcga-as.a.run.app in a browser window about 1400 px wide, signed in with Google, with a fresh chat. Keep the browser zoom at 100%. Upload to YouTube or Vimeo as public (or a public Google Drive link) and paste the link in the form.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:15 | Title slide, then the live site | "Every rainy season, heavy rain triggers landslides in Thailand. The data to judge the risk is spread across systems that take a specialist to combine. DNext puts it on one screen, in plain language." |
| 0:15 to 0:45 | National overview. Press play on the forecast slider, then point at the key figures | "This is today's picture for all 7,425 tambons in 77 provinces. Each tambon's recent rain is compared with its own history. Press play to see the next five days. About four hundred tambons are above their trigger right now, but only a handful reach High risk, because the model also needs steep, populated ground." |
| 0:45 to 1:20 | Chat: "Which provinces have the highest landslide risk this week?" Then "How many schools and hospitals are at risk there?" | "I can just ask. The assistant is Gemini on Vertex AI, built with Google's Agent Development Kit. It picks a tool, the tool computes the ranking, and the answer comes with a table. A follow-up like 'there' keeps the place, the time and the risk class. Every number comes from a calculation, never from the model." |
| 1:20 to 2:00 | Pick Chiang Mai, run "300 mm in 72 hours". Show building points and roads, open the layers panel, switch 3D on, press "Zoom to the most affected building" | "Now a what-if: 300 millimetres on Chiang Mai. These points are buildings inside the Moderate-or-higher zone, and the lines are main roads. Zoom in and each footprint rises by its estimated height. This helps a planner see what sits in the way before the rain arrives." |
| 2:00 to 2:30 | Open Safe places, press Preview route. Then open the community report dialog | "People need somewhere to go. These are candidate safe places from open data, on ground with very low risk, with a route preview from the Google Routes API. And anyone can report a landslide or a blocked road with a photo: Gemini reads it, the area's data is checked, and only then is it shown. The photo is never stored." |
| 2:30 to 2:50 | Architecture slide | "It runs on Google Cloud: two Cloud Run services and a daily job, with Earth Engine, Firestore, BigQuery, Pub/Sub, Firebase sign-in and Google Maps. The heavy statistics are precomputed twice a day, so answers come back in seconds." |
| 2:50 to 3:00 | Limits slide, then the URL slide | "DNext is a screening tool, not a warning, and it says so everywhere. It helps people decide where to look first. Try it at the link on screen." |

## Before recording

- Check the data date on the first screen is today's, and that you have chats left for the day.
- Close other tabs and any popups. Turn off notifications.
- Do one dry run of the three chat questions so the first answer is not cold.
- Keep the mouse still while Gemini is answering (about 10 to 20 seconds); talk over the wait or cut it.
