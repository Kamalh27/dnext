// Run: node --test lib/report-text.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { overviewSummary, scenarioSummary } from "./report-text.ts";

const k = { scenario_id: "s", area_name: "Nan", kind: "what_if" as const, rainfall_mm: 250, duration_h: 72, people: 1200, buildings: null, hospitals: 1, schools: 3,
  households_est: null, road_km: null, data_sources: [], resolution_m: 100, date_of_data: "d", limitations: [], extras: { triggered_tambons: 86, tambons_total: 99 } };

test("the scenario summary uses only the numbers that exist", () => {
  const s = scenarioSummary(k as never, "Nan", "en");
  assert.match(s, /250 mm of rain over 72 hours/);
  assert.match(s, /86 of 99 tambons/);
  assert.match(s, /about 1,200 people, 1 hospitals, 3 schools/);
  assert.doesNotMatch(s, /buildings/);       // buildings is null: left out, not shown as 0
});

test("the Thai summary is written in Thai", () => {
  assert.match(scenarioSummary(k as never, "น่าน", "th"), /น่าน.*ฝน 250 มม. ใน 72 ชม./);
});

test("a quiet day says so", () => {
  const d = { h: 0, date: "2026-10-14", totals: { tambons_total: 7425, triggered: 0, high_trigger: 0, provinces_triggered: 0, provinces_total: 77, people_elevated: 0 }, provinces: [], top: [] };
  assert.match(overviewSummary(d as never, "Latest observed", "en"), /no tambon is above its rainfall trigger/);
  const busy = { ...d, totals: { ...d.totals, triggered: 451, provinces_triggered: 29, people_elevated: 4000 } };
  assert.match(overviewSummary(busy as never, "Latest observed", "en"), /451 of 7,425 tambons in 29 provinces/);
});
