// Run: node --test lib/lang.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { hasThai, pick, limitationsOf } from "./lang.ts";

test("hasThai", () => {
  assert.equal(hasThai("ถ้าจังหวัดน่านมีฝน 250 มม."), true);
  assert.equal(hasThai("What if Nan gets 250 mm?"), false);
  assert.equal(hasThai("Nan จังหวัด"), true);
  assert.equal(hasThai(""), false);
  assert.equal(hasThai("日本語 ñ é"), false);
});

test("pick falls back to English", () => {
  assert.equal(pick("th", "Hi", "สวัสดี"), "สวัสดี");
  assert.equal(pick("en", "Hi", "สวัสดี"), "Hi");
  assert.equal(pick("th", "Hi", ""), "Hi");
  assert.equal(pick("th", "Hi", "  "), "Hi");
  assert.equal(pick("th", "Hi", undefined), "Hi");
});

test("limitationsOf falls back per item", () => {
  const k = { limitations: ["a", "b"], limitations_th: ["ก"] } as never;
  assert.deepEqual(limitationsOf(k, "th"), ["ก", "b"]);
  assert.deepEqual(limitationsOf(k, "en"), ["a", "b"]);
});
