// Run: node --test lib/ids.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "./ids.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("ids look like version 4 UUIDs and differ", () => {
  assert.match(newId(), UUID);
  assert.notEqual(newId(), newId());
});

test("it still works when randomUUID is missing (plain http)", () => {
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: real.getRandomValues.bind(real) }, configurable: true });
  try { assert.match(newId(), UUID); } finally { Object.defineProperty(globalThis, "crypto", { value: real, configurable: true }); }
});

test("and when there is no crypto at all", () => {
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try { assert.match(newId(), UUID); } finally { Object.defineProperty(globalThis, "crypto", { value: real, configurable: true }); }
});
