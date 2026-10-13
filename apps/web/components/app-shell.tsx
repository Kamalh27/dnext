"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./header";
import { ResizeHandle } from "./resize-handle";
import { ChatPanel, type Message } from "./chat-panel";
import { MapPanel } from "./map-panel";
import { fetchStaticLayers, runScenario, streamChat } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { ChartData, Kpis, Lang, MapLayer, MapLayersEvent, MapMarkers, SseEvent, StaticLayerItem, TableData } from "@/lib/types";
import { cn } from "@/lib/utils";

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/** The primary (risk) layer of a set, in the single-layer shape other code (explain, bbox) expects. */
function primaryOf(set: MapLayersEvent): MapLayer | null {
  const p = set.layers.find((l) => l.key === "risk") ?? set.layers[0];
  return p ? { id: p.id, name: p.name, tile_url: p.tile_url, opacity: p.opacity, bbox: set.bbox, legend: p.legend, scenario_id: set.scenario_id } : null;
}

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
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
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
        setLayer(e.data);
        // A layer set from another scenario is stale; the matching map_layers event follows.
        setLayers((prev) => (prev && prev.scenario_id === e.data.scenario_id ? prev : null));
        break;
      case "map_layers":
        setLayers(e.data);
        // Keep the primary layer in sync (explain popover needs scenario_id) unless map_layer already sent it.
        setLayer((prev) => (prev && prev.scenario_id === e.data.scenario_id ? prev : primaryOf(e.data) ?? prev));
        break;
      case "map_markers":
        setMarkers((m) => upsert(m, e.data));
        break;
      case "table":
        setTables((x) => upsert(x, e.data));
        break;
      case "chart":
        setCharts((x) => upsert(x, e.data));
        break;
      case "kpis":
        setKpis(e.data);
        break;
      case "final":
        sessionId.current = e.data.session_id || sessionId.current;
        break;
      case "error":
        patchAssistant((m) => ({ ...m, error: e.data.message }));
        break;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      lastPrompt.current = message;
      abort.current = new AbortController();
      setBusy(true);
      setStatus([]);
      setCharts([]);
      setTables([]);
      setMarkers([]);
      setMessages((ms) => [...ms, { role: "user", text: message }, { role: "assistant", text: "" }]);
      try {
        await streamChat({ message, session_id: sessionId.current, language: lang }, onEvent, abort.current.signal);
      } catch (err) {
        if ((err as Error).name !== "AbortError") patchAssistant((m) => ({ ...m, error: (err as Error).message }));
      } finally {
        setBusy(false);
        setStatus([]);
      }
    },
    [busy, lang, onEvent],
  );

  const retry = () => {
    setMessages((ms) => ms.slice(0, -2));
    void send(lastPrompt.current);
  };

  const scenario = useCallback(
    async (rainfall_mm: number, duration_h: number) => {
      if (!kpis) return;
      setScenarioBusy(true);
      setScenarioError(null);
      try {
        const r = await runScenario({ area: kpis.area_name, rainfall_mm, duration_h });
        setLayer(r.map_layer);
        setLayers(r.map_layers ?? null);
        setKpis(r.kpis);
        setCharts((c) => upsert(c, r.chart));
      } catch (err) {
        setScenarioError((err as Error).message);
      } finally {
        setScenarioBusy(false);
      }
    },
    [kpis],
  );

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
        <div className={cn("min-h-0 border-r bg-background", tab === "chat" ? "block" : "hidden md:block")}>
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
            scenarioBusy={scenarioBusy}
            scenarioError={scenarioError}
            onScenario={scenario}
          />
        </div>
        <div className={cn("min-h-0", tab === "map" ? "block" : "hidden md:block")}>
          <MapPanel lang={lang} layer={layer} layers={layers} staticLayers={staticLayers} markers={allMarkers} />
        </div>
        <ResizeHandle row={row} label={tr.resizeChat} />
      </main>
    </div>
  );
}
