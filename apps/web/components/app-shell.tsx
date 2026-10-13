"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./header";
import { ResizeHandle } from "./resize-handle";
import { ChatPanel, type Message } from "./chat-panel";
import { MapPanel } from "./map-panel";
import { ScenarioBar } from "./scenario-bar";
import type { RunError, RunKind } from "./scenario-card";
import { fetchProvinces, fetchStaticLayers, runForecast as apiForecast, runScenario, streamChat } from "@/lib/api";
import { t } from "@/lib/i18n";
import { hasThai } from "@/lib/lang";
import type { ChartData, Kpis, Lang, MapLayer, MapLayersEvent, MapMarkers, Province, ScenarioResponse, SseEvent, StaticLayerItem, TableData } from "@/lib/types";
import { cn } from "@/lib/utils";

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/** The primary (risk) layer of a set, in the single-layer shape other code (explain, bbox) expects. */
function primaryOf(set: MapLayersEvent): MapLayer | null {
  const p = set.layers.find((l) => l.key === "risk") ?? set.layers[0];
  return p ? { id: p.id, name: p.name, name_th: p.name_th, tile_url: p.tile_url, opacity: p.opacity, bbox: set.bbox, legend: p.legend, scenario_id: set.scenario_id } : null;
}

const asList = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function AppShell() {
  const [lang, setLang] = useState<Lang>("en");
  const [tab, setTab] = useState<"chat" | "map">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [layer, setLayer] = useState<MapLayer | null>(null);
  const [layers, setLayers] = useState<MapLayersEvent | null>(null);
  const [staticLayers, setStaticLayers] = useState<StaticLayerItem[]>([]);
  const [markers, setMarkers] = useState<MapMarkers[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [charts, setCharts] = useState<ChartData[]>([]);
  const [tables, setTables] = useState<TableData[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [selected, setSelected] = useState<Province | null>(null);
  const [runBusy, setRunBusy] = useState<RunKind | null>(null);
  const [runError, setRunError] = useState<RunError | null>(null);
  const provincesRef = useRef<Province[]>([]);
  // Bumped whenever results are cleared or replaced, so a slow scenario/forecast response for an old selection is dropped.
  const runToken = useRef(0);
  const sessionId = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : "web");
  const abort = useRef<AbortController | null>(null);
  const lastPrompt = useRef("");
  const tr = t(lang);
  const row = useRef<HTMLElement>(null);

  // Reference layers load on mount (no scenario needed). Tile URLs expire, so refetch at ~85% of expires_in_s (min 5 min).
  // A failure never blocks the UI: the list stays as it was and we try again in a minute.
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      let next = 60_000;
      try {
        const r = await fetchStaticLayers(ctl.signal);
        if (ctl.signal.aborted) return;
        setStaticLayers(Array.isArray(r.layers) ? r.layers : []);
        next = Math.max(300, (r.expires_in_s || 0) * 0.85) * 1000;
      } catch (err) {
        if (ctl.signal.aborted) return;
        console.warn("Reference layers unavailable:", (err as Error).message);
      }
      timer = setTimeout(load, next);
    };
    void load();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, []);

  // Province outlines (static file). Failure leaves the picker empty; everything else keeps working.
  useEffect(() => {
    const ctl = new AbortController();
    fetchProvinces(ctl.signal)
      .then((list) => {
        if (!Array.isArray(list)) return;
        provincesRef.current = list;
        setProvinces(list);
      })
      .catch((err) => {
        if (!ctl.signal.aborted) console.warn("Province list unavailable:", (err as Error).message);
      });
    return () => ctl.abort();
  }, []);

  const hasResults = !!(layer || layers || kpis || charts.length || tables.length || markers.length);

  const clearScenario = useCallback(() => {
    runToken.current++;
    setLayer(null);
    setLayers(null);
    setKpis(null);
    setCharts([]);
    setTables([]);
    setMarkers([]);
    setRunBusy(null);
    setRunError(null);
  }, []);

  /** Dropdown / map click. Switching to a different area than the current results belong to drops those results. */
  const selectProvince = useCallback(
    (p: Province | null) => {
      if ((p?.pcode ?? null) === (selected?.pcode ?? null)) return;
      setSelected(p);
      if (hasResults && (kpis?.area_code ?? null) !== (p?.pcode ?? null)) clearScenario();
    },
    [selected, hasResults, kpis, clearScenario],
  );
  const selectByCode = useCallback((code: string | null) => selectProvince(provinces.find((x) => x.pcode === code) ?? null), [provinces, selectProvince]);

  /**
   * One entry point for every result: slider run, forecast run and chat events.
   * replace=true (a run) swaps the whole result set; replace=false (a chat event) merges into what is showing.
   */
  const applyPayload = useCallback((r: ScenarioResponse, replace: boolean) => {
    const list = <T extends { id: string }>(prev: T[], items: T[]) => (replace ? items : items.reduce(upsert, prev));
    const sets = r.map_layers;
    if (r.map_layer) {
      const l = r.map_layer;
      setLayer(l);
      // A layer set from another scenario is stale; the matching map_layers set follows (or is in this payload).
      if (!sets) setLayers((prev) => (!replace && prev && prev.scenario_id === l.scenario_id ? prev : null));
    }
    if (sets) {
      setLayers(sets);
      // Keep the primary layer in sync (explain popover needs scenario_id) unless map_layer already sent it.
      setLayer((prev) => (r.map_layer ?? (prev && prev.scenario_id === sets.scenario_id ? prev : primaryOf(sets) ?? prev)));
    }
    if (replace && !r.map_layer && !sets) {
      setLayer(null);
      setLayers(null);
    }
    const tbs = r.tables ?? (r.table ? [r.table] : []);
    if (replace || tbs.length) setTables((x) => list(x, tbs));
    const mks = asList(r.map_markers);
    if (replace || mks.length) setMarkers((x) => list(x, mks));
    const chs = asList(r.chart);
    if (replace || chs.length) setCharts((x) => list(x, chs));
    if (r.kpis) {
      setKpis(r.kpis);
      // Results for a known province select it (without clearing the results that just arrived).
      const hit = provincesRef.current.find((x) => x.pcode === r.kpis?.area_code);
      if (hit) setSelected(hit);
    } else if (replace) setKpis(null);
  }, []);

  const patchAssistant = (fn: (m: Message) => Message) =>
    setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 && m.role === "assistant" ? fn(m) : m)));

  const onEvent = useCallback((e: SseEvent) => {
    switch (e.event) {
      case "status":
        setStatus((s) => (s.some((x) => x === e.data.label) ? s : [...s, e.data.label]));
        break;
      case "text_delta":
        patchAssistant((m) => ({ ...m, text: m.text + e.data.text }));
        break;
      case "map_layer":
        applyPayload({ map_layer: e.data }, false);
        break;
      case "map_layers":
        applyPayload({ map_layers: e.data }, false);
        break;
      case "map_markers":
        applyPayload({ map_markers: e.data }, false);
        break;
      case "table":
        applyPayload({ table: e.data }, false);
        break;
      case "chart":
        applyPayload({ chart: e.data }, false);
        break;
      case "kpis":
        applyPayload({ kpis: e.data }, false);
        break;
      case "final":
        sessionId.current = e.data.session_id || sessionId.current;
        break;
      case "error":
        patchAssistant((m) => ({ ...m, error: e.data.message }));
        break;
    }
  }, [applyPayload]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      lastPrompt.current = message;
      // A Thai question switches the UI to Thai (once, for this message; the EN/TH toggle can switch back) and asks for a Thai answer.
      const language: Lang = lang === "th" || hasThai(message) ? "th" : lang;
      if (language !== lang) setLang(language);
      abort.current = new AbortController();
      setBusy(true);
      setStatus([]);
      setCharts([]);
      setTables([]);
      setMarkers([]);
      setMessages((ms) => [...ms, { role: "user", text: message }, { role: "assistant", text: "" }]);
      try {
        await streamChat({ message, session_id: sessionId.current, language, area: selected?.pcode }, onEvent, abort.current.signal);
      } catch (err) {
        if ((err as Error).name !== "AbortError") patchAssistant((m) => ({ ...m, error: (err as Error).message }));
      } finally {
        setBusy(false);
        setStatus([]);
      }
    },
    [busy, lang, selected, onEvent],
  );

  const retry = () => {
    setMessages((ms) => ms.slice(0, -2));
    void send(lastPrompt.current);
  };

  const run = useCallback(
    async (kind: RunKind, call: (area: string) => Promise<ScenarioResponse>) => {
      if (!selected) return;
      const token = ++runToken.current;
      setRunBusy(kind);
      setRunError(null);
      try {
        const r = await call(selected.pcode);
        if (token === runToken.current) applyPayload(r, true);
      } catch (err) {
        if (token === runToken.current) setRunError({ kind, message: (err as Error).message });
      } finally {
        if (token === runToken.current) setRunBusy(null);
      }
    },
    [selected, applyPayload],
  );
  const scenario = useCallback((rainfall_mm: number, duration_h: number) => run("scenario", (area) => runScenario({ area, rainfall_mm, duration_h })), [run]);
  const forecast = useCallback((horizon_days: number) => run("forecast", (area) => apiForecast({ area, horizon_days })), [run]);

  const allMarkers = useMemo(() => markers.flatMap((m) => m.markers), [markers]);

  return (
    <div className="flex h-dvh flex-col">
      <Header lang={lang} setLang={setLang} />
      <div role="tablist" aria-label="View" className="flex border-b bg-background md:hidden">
        {(["chat", "map"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === k ? "border-b-2 border-primary text-foreground" : "text-muted-foreground",
            )}
          >
            {tr[k]}
          </button>
        ))}
      </div>
      <main
        ref={row}
        className="relative grid min-h-0 flex-1 md:grid-cols-[clamp(320px,var(--chat-w,32%),70%)_1fr]"
      >
        <div className={cn("min-h-0 flex-col border-r bg-background", tab === "chat" ? "flex" : "hidden md:flex")}>
          <ScenarioBar lang={lang} provinces={provinces} selected={selected} kpis={kpis} hasResults={hasResults} onSelect={selectByCode} onReset={clearScenario} />
          <div className="min-h-0 flex-1">
          <ChatPanel
            lang={lang}
            messages={messages}
            busy={busy}
            status={status}
            onSend={send}
            onStop={() => abort.current?.abort()}
            onRetry={retry}
            kpis={kpis}
            charts={charts}
            tables={tables}
            province={selected}
            runBusy={runBusy}
            runError={runError}
            onScenario={scenario}
            onForecast={forecast}
          />
          </div>
        </div>
        <div className={cn("min-h-0", tab === "map" ? "block" : "hidden md:block")}>
          <MapPanel lang={lang} layer={layer} layers={layers} staticLayers={staticLayers} markers={allMarkers} provinces={provinces} selected={selected} onSelect={selectProvince} />
        </div>
        <ResizeHandle row={row} label={tr.resizeChat} />
      </main>
    </div>
  );
}
