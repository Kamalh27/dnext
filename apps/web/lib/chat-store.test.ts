// Run: node --test lib/chat-store.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_LOCAL, contextOf, mergeLists, readLocal, removeLocal, titleOf, toStored, upsertLocal, type ChatThread } from "./chat-store.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const thread = (id: string, updated: string, text = "hi"): ChatThread => ({ id, title: text, created: updated, updated, lang: "en", messages: [{ role: "user", text }] });

test("titles come from the first question and stay short", () => {
  assert.equal(titleOf([{ role: "assistant", text: "x" }, { role: "user", text: "  What if   Nan gets\n250 mm? " }]), "What if Nan gets 250 mm?");
  assert.equal(titleOf([{ role: "user", text: "a".repeat(100) }]).length, 58);
  assert.equal(titleOf([]), "New chat");
  assert.equal(titleOf([{ role: "activity", text: "Ran 250 mm over 72 h in Nan" }]), "Ran 250 mm over 72 h in Nan");        // a chat that only holds a slider run
});

test("only finished messages are stored, trimmed to the API limits", () => {
  const out = toStored([{ role: "user", text: "q" }, { role: "assistant", text: "" }, { role: "assistant", text: "x".repeat(7000) }, { role: "activity", text: "Ran", run: { kind: "what_if", area: "TH55" } }]);
  assert.equal(out.length, 3);
  assert.equal(out[1].text.length, 6000);
  assert.deepEqual(out[2].run, { kind: "what_if", area: "TH55" });
  assert.equal(toStored(Array.from({ length: 200 }, () => ({ role: "user" as const, text: "q" }))).length, 150);
});

test("the context keeps the latest turns and respects the size limit", () => {
  const msgs = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `turn ${i} ${"z".repeat(300)}` }));
  const c = contextOf(msgs, 1500);
  assert.ok(c.length <= 1500 && c.includes("turn 39") && !c.includes("turn 0 "));
  assert.equal(contextOf([]), "");
});

test("the browser copy keeps the newest chats and survives broken storage", () => {
  const s = memory();
  for (let i = 0; i < MAX_LOCAL + 5; i++) upsertLocal(thread(`id${String(i).padStart(3, "0")}`, `2026-10-${String(10 + (i % 18)).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}`), s);
  assert.equal(Object.keys(readLocal(s)).length, MAX_LOCAL);
  removeLocal("id034", s);
  assert.ok(!("id034" in readLocal(s)));
  assert.deepEqual(readLocal({ getItem: () => "{not json" }), {});
  assert.deepEqual(upsertLocal(thread("zz", "2026-10-15T00:00:00"), { getItem: () => null, setItem: () => { throw new Error("full"); } }), {});
});

test("merging the two lists marks where each chat lives, newest first", () => {
  const l = [{ id: "a", title: "A", updated: "2026-10-15T10:00:00", count: 2, where: "device" as const }, { id: "b", title: "B", updated: "2026-10-14T10:00:00", count: 1, where: "device" as const }];
  const r = [{ id: "b", title: "B", updated: "2026-10-14T10:00:00", count: 1, where: "account" as const }, { id: "c", title: "C", updated: "2026-10-16T10:00:00", count: 4, where: "account" as const }];
  assert.deepEqual(mergeLists(l, r).map((x) => [x.id, x.where]), [["c", "account"], ["a", "device"], ["b", "both"]]);
});
