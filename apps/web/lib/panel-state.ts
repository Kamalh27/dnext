"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MQ } from "./use-media";

const PREFIX = "dnext-ui-";
const mem = new Map<string, "1" | "0">();   // survives blocked storage for the visit
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const read = (key: string): "1" | "0" | null => {
  const m = mem.get(key);
  if (m) return m;
  if (VOLATILE.has(key)) return null;
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === "1" || v === "0" ? v : null;
  } catch { return null; }
};

function write(key: string, open: boolean) {
  const v = open ? "1" : "0";
  mem.set(key, v);
  if (VOLATILE.has(key)) return;
  try { localStorage.setItem(PREFIX + key, v); } catch { /* storage blocked: still works for this visit */ }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith(PREFIX)) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

/** Map panels that must not be open together on phones / short screens (they would cover too much of a small map). */
const EXCLUSIVE = ["panel-slider", "panel-legend", "tools-menu"];
/** Transient popovers: never written to storage. */
const VOLATILE = new Set(["tools-menu"]);

/**
 * Open/closed flag remembered in localStorage. Hydration-safe: the server and the first client render use `fallback`
 * (via useSyncExternalStore's server snapshot), then the stored choice applies. `fallback` is the breakpoint default.
 */
export function usePersistedOpen(key: string, fallback: boolean): [boolean, (open: boolean) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);
  const open = stored == null ? fallback : stored === "1";
  const set = useCallback((next: boolean) => {
    write(key, next);
    if (next && EXCLUSIVE.includes(key) && window.matchMedia(MQ.compactMap).matches) for (const k of EXCLUSIVE) if (k !== key) write(k, false);
    notify();
  }, [key]);
  return [open, set];
}
