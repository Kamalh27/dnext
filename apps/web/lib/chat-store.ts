/** Saved chats: what is kept, how it is trimmed, and the browser copy. The account copy lives on the API (Firestore); see chat-history.ts. */
export interface RunRef {
  kind: "what_if" | "forecast";
  area: string;                 // province code, e.g. "TH55"
  area_name?: string;
  rainfall_mm?: number | null;
  duration_h?: number | null;
  horizon_days?: number | null;
  scenario_id?: string | null;
}
export interface ChatMessage { role: "user" | "assistant" | "activity"; text: string; error?: string; run?: RunRef }
export interface ChatThread {
  id: string;
  title: string;
  created: string;
  updated: string;
  lang: "en" | "th";
  area?: string | null;
  messages: ChatMessage[];
}
export interface ChatSummary { id: string; title: string; updated: string; area?: string | null; count: number; where: "device" | "account" | "both" }

export const KEY = "dnext-chats-v1";
export const MAX_LOCAL = 30;
export const MAX_MESSAGES = 150;
export const MAX_TEXT = 6000;

/** Only what is worth keeping: finished messages, trimmed to the sizes the API accepts. */
export function toStored(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.role === "activity" || m.text.trim() !== "" || m.error)
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TEXT), ...(m.error ? { error: m.error.slice(0, 600) } : {}), ...(m.run ? { run: m.run } : {}) }));
}

export function titleOf(messages: ChatMessage[]): string {
  const first = (messages.find((m) => m.role === "user") ?? messages.find((m) => m.role === "activity"))?.text ?? "";
  const t = first.trim().replace(/\s+/g, " ");
  return (t.length > 60 ? `${t.slice(0, 57)}…` : t) || "New chat";
}

/** The last turns as plain text, so an agent that has lost its memory (a reopened chat) can carry on. Never longer than `max` characters. */
export function contextOf(messages: ChatMessage[], max = 3500): string {
  const lines = messages.filter((m) => m.text.trim()).map((m) => `${m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "Note"}: ${m.text.replace(/\s+/g, " ").trim().slice(0, 500)}`);
  let out = "";
  for (let i = lines.length - 1; i >= 0 && out.length + lines[i].length + 1 <= max; i--) out = `${lines[i]}\n${out}`;
  return out.trim();
}

export function summarize(t: ChatThread, where: ChatSummary["where"]): ChatSummary {
  return { id: t.id, title: t.title, updated: t.updated, area: t.area, count: t.messages.length, where };
}

/** Union of the two lists by id, newest first. A chat on both sides is "both". */
export function mergeLists(local: ChatSummary[], remote: ChatSummary[]): ChatSummary[] {
  const byId = new Map<string, ChatSummary>();
  for (const r of remote) byId.set(r.id, { ...r, where: "account" });
  for (const l of local) {
    const r = byId.get(l.id);
    byId.set(l.id, r ? { ...(l.updated > r.updated ? l : r), where: "both" } : { ...l, where: "device" });
  }
  return [...byId.values()].sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

// ---- browser copy (every access guarded: storage can be missing, full or blocked)
export function readLocal(storage: Pick<Storage, "getItem"> | null = safeStorage()): Record<string, ChatThread> {
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Adds or replaces a thread; keeps only the newest MAX_LOCAL. Returns the map that was stored (empty if storing failed). */
export function upsertLocal(t: ChatThread, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): Record<string, ChatThread> {
  const all = { ...readLocal(storage), [t.id]: t };
  const keep = Object.values(all).sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, MAX_LOCAL);
  const next = Object.fromEntries(keep.map((x) => [x.id, x]));
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { return {}; }
  emit();
  return next;
}

export function removeLocal(id: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()) {
  const all = readLocal(storage);
  delete all[id];
  try { storage?.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  emit();
}

// ---- a tiny store, so the list of saved chats follows every write (and writes from other tabs)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function subscribeLocal(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) cb(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}
/** The raw stored text: unchanged between writes, which is what a store snapshot needs. */
export const snapshotLocal = (): string | null => { try { return safeStorage()?.getItem(KEY) ?? null; } catch { return null; } };
export function summariesOf(raw: string | null): ChatSummary[] {
  try {
    const all = raw ? (JSON.parse(raw) as Record<string, ChatThread>) : {};
    return Object.values(all).map((t) => summarize(t, "device"));
  } catch {
    return [];
  }
}

export function safeStorage(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
