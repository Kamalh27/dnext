// Run: node --test lib/svgmap.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { boundsOf, classOfRisk, pathOf, projector } from "./svgmap.ts";

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
