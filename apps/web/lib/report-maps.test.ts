// Run: node --test lib/report-maps.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { NO_DATA, rain30Scale, riskScale, shareScale, triggerScale } from "./report-maps.ts";

test("risk colours follow the class cut-offs and zero is the neutral colour", () => {
  const s = riskScale("en");
  assert.equal(s.colorOf(0), NO_DATA);
  assert.equal(s.colorOf(0.5), "#ffffb2");
  assert.equal(s.colorOf(2.4), "#fd8d3c");
  assert.equal(s.colorOf(4.5), "#bd0026");
  assert.equal(s.legend.items.length, 5);
});

test("rain is binned and a missing value is neutral", () => {
  const s = rain30Scale("en");
  assert.equal(s.colorOf(50), s.legend.items[0].color);
  assert.equal(s.colorOf(100), s.legend.items[1].color);
  assert.equal(s.colorOf(900), s.legend.items[5].color);
  assert.equal(s.colorOf(null), NO_DATA);
});

test("trigger classes and shares", () => {
  assert.equal(triggerScale("th").colorOf(0), NO_DATA);
  assert.notEqual(triggerScale("th").colorOf(3), NO_DATA);
  assert.equal(shareScale("en").colorOf(0), "#f7f7f7");
  assert.equal(shareScale("en").colorOf(0.9), "#c51b8a");
});
