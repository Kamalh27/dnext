// Run: node --test lib/tour.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { placeCard, STEPS, TEXT } from "./tour.ts";

const vp = { w: 1000, h: 700 };
const card = { w: 300, h: 140 };

test("the card goes below the target when there is room", () => {
  const p = placeCard({ left: 100, top: 100, width: 200, height: 40 }, card, vp);
  assert.equal(p.top, 154);
  assert.equal(p.left, 50);
});

test("near the bottom it goes above, near the right edge it stays inside the screen", () => {
  const p = placeCard({ left: 900, top: 650, width: 80, height: 40 }, card, vp);
  assert.equal(p.top, 650 - 14 - 140);
  assert.ok(p.left + card.w <= vp.w - 8);
});

test("a tall target takes the card to its side", () => {
  const p = placeCard({ left: 20, top: 8, width: 300, height: 690 }, card, vp);
  assert.equal(p.left, 20 + 300 + 14);
});

test("every step has text in both languages", () => {
  for (const s of STEPS) {
    for (const l of ["en", "th"] as const) assert.ok(TEXT[l][s.id]?.title && TEXT[l][s.id]?.body, `${l}:${s.id}`);
  }
});
