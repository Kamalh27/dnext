// Run: node --test lib/share.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { parseShare, shareParams } from "./share.ts";

test("a what-if run round-trips through a link", () => {
  const q = shareParams({ kind: "what_if", area_code: "TH55", rainfall_mm: 250, duration_h: 72 });
  assert.equal(q, "area=TH55&mm=250&h=72");
  assert.deepEqual(parseShare("?" + q), { area: "TH55", mm: 250, h: 72 });
});

test("a forecast run round-trips through a link", () => {
  const q = shareParams({ kind: "forecast", area_code: "TH50", horizon_days: 5 });
  assert.deepEqual(parseShare("?" + q), { area: "TH50", forecast: 5 });
});

test("results without what is needed to run them again have no link", () => {
  assert.equal(shareParams({ kind: "what_if", rainfall_mm: 250, duration_h: 72 }), null);
  assert.equal(shareParams({ kind: "what_if", area_code: "TH55", rainfall_mm: 250 }), null);
  assert.equal(shareParams({ kind: "forecast", area_code: "TH55" }), null);
  assert.equal(shareParams({ kind: "what_if", area_code: "TH550101", rainfall_mm: 250, duration_h: 72 }), null);
});

test("mangled or out-of-range links are ignored", () => {
  for (const s of ["", "?area=Nan&mm=250&h=72", "?area=TH55&mm=abc&h=72", "?area=TH55&mm=9999&h=72", "?area=TH55&mm=250&h=0", "?area=TH55&forecast=9",
    "?area=TH55&mm=250", "?area=TH5501&mm=250&h=72"]) assert.equal(parseShare(s), null, s);
});
