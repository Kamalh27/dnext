// Run: node --test lib/infra.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { colorOfRisk, counts, heightOf, squareAround } from "./infra.ts";

test("a footprint is a closed square of about the right size", () => {
  const ring = squareAround(18.8, 99.0, 100);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  const widthM = (ring[1][0] - ring[0][0]) * 111320 * Math.cos((18.8 * Math.PI) / 180);
  assert.ok(Math.abs(widthM - 10) < 0.1);
});

test("tiny and huge areas are kept to a sensible size", () => {
  const side = (a: number) => { const r = squareAround(0, 0, a); return (r[1][0] - r[0][0]) * 111320; };
  assert.ok(Math.abs(side(0.5) - 5) < 0.1 && Math.abs(side(100000) - 60) < 0.1);
});

test("only Moderate and above get a hot colour; heights are bounded", () => {
  assert.deepEqual(colorOfRisk(2.4), [253, 141, 60, 225]);
  assert.deepEqual(colorOfRisk(3.2), [240, 59, 32, 225]);
  assert.deepEqual(colorOfRisk(4.8, 100), [189, 0, 38, 100]);
  assert.equal(heightOf(0), 4);
  assert.equal(heightOf(150), 60);
  assert.equal(heightOf(7.5), 7.5);
});

test("counts of nothing are zero", () => {
  assert.deepEqual(counts(null), { buildings: 0, roadKm: 0 });
});
