// Run: node --test lib/svgmap.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { boundsOf, classOfRisk, labelPoint, niceKm, pathOf, projector } from "./svgmap.ts";

const square = { type: "Polygon" as const, coordinates: [[[100, 10], [102, 10], [102, 12], [100, 12], [100, 10]]] };
const multi = { type: "MultiPolygon" as const, coordinates: [[[[98, 5], [99, 5], [99, 6], [98, 5]]], [[[104, 19], [105, 19], [105, 20], [104, 19]]]] };

test("bounds cover every polygon of every geometry", () => {
  assert.deepEqual(boundsOf([square, multi]), { w: 98, s: 5, e: 105, n: 20 });
  assert.equal(boundsOf([]), null);
});

test("the fit stays inside the box and keeps north up", () => {
  const b = boundsOf([multi])!;
  const p = projector(b, 400, 500);
  assert.ok(p.width <= 400 && p.height <= 500);
  const [, yNorth] = p.project(104, 20);
  const [, ySouth] = p.project(98, 5);
  assert.ok(yNorth < ySouth);
});

test("a polygon becomes one closed path per ring", () => {
  const p = projector(boundsOf([square])!, 200, 200);
  const d = pathOf(square, p.project);
  assert.equal((d.match(/M/g) ?? []).length, 1);
  assert.ok(d.endsWith("Z"));
  assert.equal((pathOf(multi, projector(boundsOf([multi])!, 200, 200).project).match(/M/g) ?? []).length, 2);
});

test("risk classes follow the API cut-offs", () => {
  assert.deepEqual([0, 0.4, 1, 1.99, 2, 3, 4.5].map((v) => classOfRisk(v)), [0, 1, 2, 2, 3, 4, 5]);
});

test("a label point lies inside the bounding box of the largest part", () => {
  const [lng, lat] = labelPoint(multi)!;
  assert.ok(lng >= 98 && lng <= 105 && lat >= 5 && lat <= 20);
  assert.deepEqual(labelPoint(square), [101, 11]);
});

test("the scale bar gets a round length and the projection reports kilometres per unit", () => {
  assert.equal(niceKm(47), 50);
  assert.equal(niceKm(8), 10);
  const p = projector({ w: 100, s: 10, e: 101, n: 11 }, 200, 200, 0);
  assert.ok(p.kmPerUnit > 0.4 && p.kmPerUnit < 0.7);      // 1 degree of longitude near 10 N is about 110 km over 200 units
});
