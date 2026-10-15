// Run: node --test lib/province-search.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { filterProvinces } from "./province-search.ts";
import type { Province } from "./types.ts";

const mk = (pcode: string, name: string, name_th: string) => ({ pcode, name, name_th, bbox: [0, 0, 0, 0], geometry: { type: "MultiPolygon", coordinates: [] } }) as Province;
const list = [mk("TH50", "Chiang Mai", "เชียงใหม่"), mk("TH57", "Chiang Rai", "เชียงราย"), mk("TH55", "Nan", "น่าน"), mk("TH10", "Bangkok", "กรุงเทพมหานคร"), mk("TH12", "Nonthaburi", "นนทบุรี")];

test("an empty search keeps the list as it is", () => {
  assert.equal(filterProvinces(list, "  ", "en"), list);
});

test("English and Thai names both match, whatever the language setting", () => {
  assert.deepEqual(filterProvinces(list, "chiang", "en").map((p) => p.pcode), ["TH50", "TH57"]);
  assert.deepEqual(filterProvinces(list, "เชียง", "en").map((p) => p.pcode), ["TH50", "TH57"]);
  assert.deepEqual(filterProvinces(list, "nan", "th").map((p) => p.pcode), ["TH55"]);
});

test("names that start with the search come before names that only contain it", () => {
  assert.deepEqual(filterProvinces(list, "n", "en").map((p) => p.pcode), ["TH55", "TH12", "TH10", "TH50", "TH57"]);
  assert.deepEqual(filterProvinces(list, "rai", "en").map((p) => p.pcode), ["TH57"]);
});

test("a search with no match gives an empty list", () => {
  assert.deepEqual(filterProvinces(list, "zzz", "en"), []);
});
