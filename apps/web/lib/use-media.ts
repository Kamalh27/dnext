"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Breakpoints (keep in sync with the Tailwind variants in globals.css): phone < 640, tablet 640-1023, desktop >= 1024; short = landscape phone. */
export const MQ = {
  desktop: "(min-width: 1024px)",
  short: "(max-height: 500px)",
  /** Map overlays go compact: phone portrait width or any short screen. */
  compactMap: "(max-width: 639px), (max-height: 500px)",
  coarse: "(pointer: coarse)",
} as const;

/** matchMedia as external store: false on the server and during hydration, then the real value (no hydration mismatch). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
