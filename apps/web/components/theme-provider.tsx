"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";

interface Ctx { theme: Theme; toggle: () => void }
const ThemeCtx = createContext<Ctx>({ theme: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

// The <html class="dark"> flag (set before first paint by THEME_INIT_SCRIPT) is the single source of truth.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const stored = (): string | null => {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
};
const apply = (t: Theme) => {
  const r = document.documentElement;
  r.classList.toggle("dark", t === "dark");
  r.style.colorScheme = t;
  notify();
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // Follow the OS only until the user makes an explicit choice.
  const onOs = () => { if (!stored()) apply(mq.matches ? "dark" : "light"); };
  mq.addEventListener("change", onOs);
  return () => { listeners.delete(cb); mq.removeEventListener("change", onOs); };
}
const getSnapshot = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const getServerSnapshot = (): Theme => "light";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: still switches for this visit */ }
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
