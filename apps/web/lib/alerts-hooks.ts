"use client";

import { useCallback, useEffect, useState } from "react";
import { getWatchlist, listAlerts, markAlertsRead, putWatchlist } from "./api";
import { useAuth } from "./auth";
import type { AlertItem, Lang, Watchlist } from "./types";

/** Alerts exist only for a signed-in account on a deployment where sign-in is required. */
export function useAlertsEnabled() {
  const auth = useAuth();
  return auth.config?.auth_required === true && auth.status === "signed_in";
}

const REFRESH_MS = 5 * 60_000;

/** Notifications of the signed-in account: loaded when the page opens, again every 5 minutes and when the tab comes back into view. */
export function useAlerts() {
  const enabled = useAlertsEnabled();
  const [rows, setRows] = useState<{ items: AlertItem[]; unread: number }>({ items: [], unread: 0 });
  const refresh = useCallback(() => listAlerts().then(setRows).catch(() => undefined), []);     // offline or not allowed: keep what is shown
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => listAlerts().then((r) => live && setRows(r)).catch(() => undefined);
    load();
    const id = setInterval(load, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled]);
  const markRead = useCallback(async () => {
    setRows((r) => ({ items: r.items.map((i) => ({ ...i, read: true })), unread: 0 }));
    try { await markAlertsRead(); } catch { /* the next refresh shows the truth */ }
  }, []);
  return { enabled, ...(enabled ? rows : { items: [], unread: 0 }), markRead, refresh };
}

/** The provinces the account wants alerts for, and a toggle for one of them. */
export function useWatchlist(lang: Lang) {
  const enabled = useAlertsEnabled();
  const [watch, setWatch] = useState<Watchlist | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getWatchlist().then((w) => live && setWatch(w)).catch(() => undefined);
    return () => { live = false; };
  }, [enabled]);
  const toggle = useCallback(async (pcode: string) => {
    if (!watch || busy) return;
    const has = watch.provinces.includes(pcode);
    const provinces = has ? watch.provinces.filter((p) => p !== pcode) : [...watch.provinces, pcode].slice(0, watch.max);
    setBusy(true);
    try {
      const r = await putWatchlist({ provinces, min_class: watch.min_class, lang });
      setWatch({ ...watch, ...r });
    } catch { /* unchanged */ } finally {
      setBusy(false);
    }
  }, [watch, busy, lang]);
  return { enabled: enabled && watch !== null, watching: (pcode: string) => !!watch?.provinces.includes(pcode), full: !!watch && watch.provinces.length >= watch.max, toggle, busy };
}
