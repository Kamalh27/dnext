"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./header";
import { Tour } from "./tour";
import { newId } from "@/lib/ids";
import { MapBoundary } from "./map-boundary";
import { ViewTabs } from "./view-tabs";
import { ResizeHandle } from "./resize-handle";
import { ChatPanel, type Message } from "./chat-panel";
import { MapPanel } from "./map-panel";
import { PhotoCheckModal } from "./photo-check";
import { ReportModal } from "./report-modal";
import { useWatchlist } from "@/lib/alerts-hooks";
import { useChatHistory } from "@/lib/chat-history";
import type { RunRef } from "@/lib/chat-store";
import { ScenarioBar } from "./scenario-bar";
import { SignInDialog } from "./sign-in-dialog";
import type { RunError, RunKind } from "./scenario-card";
import { parseShare, type ShareRun } from "@/lib/share";
import { ApiError, fetchOverviewSeries, fetchProvinces, fetchStaticLayers, runForecast as apiForecast, runScenario, streamChat } from "@/lib/api";
import { burstLeftS, gate, loadAuthConfig, requestSignIn } from "@/lib/auth";
import { fmt, t } from "@/lib/i18n";
import { hasThai } from "@/lib/lang";
import type { OverviewMetric } from "@/lib/overview";
import type { ChartData, Kpis, Lang, MapLayer, MapLayersEvent, MapMarkers, OverviewSeries, Province, ScenarioResponse, SseEvent, StaticLayerItem, TableData } from "@/lib/types";
import { cn } from "@/lib/utils";

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

/** The primary (risk) layer of a set, in the single-layer shape other code (explain, bbox) expects. */
function primaryOf(set: MapLayersEvent): MapLayer | null {
  const p = set.layers.find((l) => l.key === "risk") ?? set.layers[0];
  return p ? { id: p.id, name: p.name, name_th: p.name_th, tile_url: p.tile_url, opacity: p.opacity, bbox: set.bbox, legend: p.legend, scenario_id: set.scenario_id } : null;
}

const asList = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const OVERVIEW_RETRY_DELAYS_MS = [1500, 4000, 8000, 15000];

/** The result on screen, as a recipe the API can recompute (never the numbers themselves). */
function recipeOf(k: Kpis | null): RunRef | undefined {
  if (!k?.area_code) return undefined;
  if (k.kind === "forecast") return k.horizon_days ? { kind: "forecast", area: k.area_code, horizon_days: k.horizon_days, scenario_id: k.scenario_id } : undefined;
  return k.rainfall_mm && k.duration_h ? { kind: "what_if", area: k.area_code, rainfall_mm: k.rainfall_mm, duration_h: k.duration_h, scenario_id: k.scenario_id } : undefined;
}

function activityText(ref: RunRef, p: Province, lang: Lang): string {
  const tr = t(lang);
  const area = lang === "th" ? p.name_th || p.name : p.name;
  return ref.kind === "forecast" ? fmt(tr.activityForecast, { n: ref.horizon_days ?? "", area }) : fmt(tr.activityWhatIf, { mm: ref.rainfall_mm ?? "", h: ref.duration_h ?? "", area });
}

export function AppShell() {
  const [lang, setLang] = useState<Lang>("en");
  const [tab, setTab] = useState<"chat" | "map">("chat");
  const [tourOpen, setTourOpen] = useState(false);
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
  // National overview: daily precompute (observed day 0 + 5 forecast days). Fetched once; a failure keeps the plain empty map.
  const [series, setSeries] = useState<OverviewSeries | null>(null);
  const [overviewDay, setOverviewDay] = useState(0);
  const [overviewMetric, setOverviewMetric] = useState<OverviewMetric>("risk");
  const [playing, setPlaying] = useState(false);
  const provincesRef = useRef<Province[]>([]);
  // Bumped whenever results are cleared or replaced, so a slow scenario/forecast response for an old selection is dropped.
  const runToken = useRef(0);
  const sessionId = useRef<string>(newId());
  const abort = useRef<AbortController | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const watchlist = useWatchlist(lang);
  const history = useChatHistory({ messages, setMessages, sessionRef: sessionId, lang, areaCode: selected?.pcode, busy });
  const lastPrompt = useRef("");
  const tr = t(lang);
  const row = useRef<HTMLElement>(null);
  // Sign in with Google via Firebase (only when the API says auth is required; otherwise nothing below does anything).
  const sendRef = useRef<(text: string) => boolean>(() => false);
  // Bumped when a chat message that was blocked by sign-in has been re-sent, so the composer can drop the draft it kept.
  const [resent, setResent] = useState<{ n: number; text: string } | null>(null);

  useEffect(() => { void loadAuthConfig(); }, []);

  // On-screen keyboard: where the layout viewport does not shrink by itself (iOS Safari), size the app to the visual viewport.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const apply = () => {
      if (window.innerHeight - vv.height > 120) {
        root.setProperty("--app-h", `${Math.round(vv.height)}px`);
        if (vv.offsetTop > 0) window.scrollTo(0, 0);
      } else root.removeProperty("--app-h");
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
    return () => { vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); root.removeProperty("--app-h"); };
  }, []);

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

  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // After a quiet period the first call can be slow or fail while the services wake up, so try a few times before giving up.
    const attempt = (n: number) => {
      fetchOverviewSeries(ctl.signal)
        .then((r) => {
          if (Array.isArray(r?.days) && r.days.length > 0) setSeries(r);
        })
        .catch((err) => {
          if (ctl.signal.aborted) return;
          console.info("National overview unavailable:", (err as Error).message);
          if (n < OVERVIEW_RETRY_DELAYS_MS.length) timer = setTimeout(() => attempt(n + 1), OVERVIEW_RETRY_DELAYS_MS[n]);
        });
    };
    attempt(0);
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, []);

  const hasResults = !!(layer || layers || kpis || charts.length || tables.length || markers.length);

  // Overview mode: nothing selected and no results. A province or a result leaves it; clearing both brings it back.
  const overviewOn = !!series && !selected && !hasResults;
  // The map keeps the national risk layer for answers that are only a table or a chart (a ranking, say); a scenario layer, KPIs or markers replace it.
  const mapOverviewOn = !!series && !selected && !(layer || layers || kpis || markers.length);
  const [wasOverview, setWasOverview] = useState(overviewOn);
  if (wasOverview !== overviewOn) {
    setWasOverview(overviewOn);
    if (!overviewOn) setPlaying(false);
  }
  useEffect(() => {
    if (!playing || !series) return;
    const n = series.days.length;
    const id = setInterval(() => setOverviewDay((d) => (d + 1) % n), 1200);
    return () => clearInterval(id);
  }, [playing, series]);

  // A user day change (slider, trend chart) stops playback.
  const pickOverviewDay = useCallback((d: number) => { setPlaying(false); setOverviewDay(d); }, []);

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

  const doSend = useCallback(
    async (message: string) => {
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
        await streamChat({ message, session_id: sessionId.current, language, area: selected?.pcode, current: recipeOf(kpis), context: history.takeContext() }, onEvent, abort.current.signal);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (err instanceof ApiError && err.isAuthRequired) {
          // The API refused the sign-in (even after a token refresh): take the unanswered turn back and re-send it once after signing in again.
          setMessages((ms) => ms.slice(0, -2));
          requestSignIn(() => { if (sendRef.current(message)) setResent((r) => ({ n: (r?.n ?? 0) + 1, text: message })); });
        } else if (err instanceof ApiError && (err.isBurst || err.isDaily)) patchAssistant((m) => ({ ...m, limit: err }));
        else patchAssistant((m) => ({ ...m, error: (err as Error).message }));
      } finally {
        setBusy(false);
        setStatus([]);
      }
    },
    [lang, selected, onEvent, kpis, history],
  );

  /** Returns false when nothing was sent (empty, busy, waiting out a burst limit, or signed out), so the composer keeps the draft. */
  const send = useCallback(
    (text: string): boolean => {
      const message = text.trim();
      if (!message || busy || burstLeftS() > 0) return false;
      // Signed out: open the sign-in dialog instead of calling the API; the message is re-sent once after a successful sign-in.
      if (!gate(() => { if (sendRef.current(message)) setResent((r) => ({ n: (r?.n ?? 0) + 1, text: message })); })) return false;
      void doSend(message);
      return true;
    },
    [busy, doSend],
  );
  useEffect(() => { sendRef.current = send; }, [send]);

  const retry = () => {
    setMessages((ms) => ms.slice(0, -2));
    send(lastPrompt.current);
  };

  const run = useCallback(
    async (kind: RunKind, call: (area: string) => Promise<ScenarioResponse>) => {
      if (!selected || burstLeftS() > 0) return;
      if (!gate()) return;   // signed out: the dialog opens, nothing is called; after signing in the user runs it again
      const token = ++runToken.current;
      setRunBusy(kind);
      setRunError(null);
      try {
        const r = await call(selected.pcode);
        if (token === runToken.current) {
          applyPayload(r, true);
          const ref = recipeOf(r.kpis ?? null);          // note it in the conversation, so chat and slider runs form one history
          if (ref) setMessages((ms) => [...ms, { role: "activity", text: activityText(ref, selected, lang), run: { ...ref, area_name: selected.name } }]);
        }
      } catch (err) {
        if (token === runToken.current && !(err instanceof ApiError && err.isAuthRequired)) setRunError({ kind, message: (err as Error).message, apiError: err instanceof ApiError ? err : undefined });
      } finally {
        if (token === runToken.current) setRunBusy(null);
      }
    },
    [selected, applyPayload, lang],
  );
  const scenario = useCallback((rainfall_mm: number, duration_h: number) => run("scenario", (area) => runScenario({ area, rainfall_mm, duration_h })), [run]);
  const forecast = useCallback((horizon_days: number) => run("forecast", (area) => apiForecast({ area, horizon_days })), [run]);

  // A shared link (?area=TH55&mm=250&h=72 or ?area=TH55&forecast=5) selects the province and runs it once the province list is in.
  const shared = useRef<ShareRun | null>(null);
  const [sharedRun, setSharedRun] = useState<ShareRun | null>(null);
  useEffect(() => { shared.current = parseShare(window.location.search); }, []);
  useEffect(() => {
    const s = shared.current;
    if (!s || provinces.length === 0) return;
    shared.current = null;
    const p = provinces.find((x) => x.pcode === s.area);
    if (!p) return;
    setSelected(p);
    setSharedRun(s);
  }, [provinces]);
  useEffect(() => {
    if (!sharedRun || selected?.pcode !== sharedRun.area) return;
    const s = sharedRun;
    setSharedRun(null);
    const go = () => (s.forecast ? forecast(s.forecast) : scenario(s.mm!, s.h!));
    if (gate(go)) go();      // signed out: the sign-in dialog opens and the run follows
  }, [sharedRun, selected, scenario, forecast]);

  // Saved chats: open one (and its province), start a new one, or show a past run again.
  const openChat = useCallback(async (id: string) => {
    abort.current?.abort();
    const thread = await history.open(id);
    if (!thread) return false;
    setBusy(false);
    setStatus([]);
    const prov = thread.area ? provincesRef.current.find((x) => x.pcode === thread.area) : undefined;
    if (prov) setSelected(prov);
    return true;
  }, [history]);
  const newChat = useCallback(() => { abort.current?.abort(); setBusy(false); setStatus([]); history.newChat(); }, [history]);
  const restoreRun = useCallback((run: RunRef) => {
    if (!/^TH\d{2}$/i.test(run.area)) return;
    const p = provincesRef.current.find((x) => x.pcode === run.area.toUpperCase());
    if (!p) return;
    setSelected(p);
    setSharedRun(run.kind === "forecast" && run.horizon_days ? { area: p.pcode, forecast: run.horizon_days } : run.rainfall_mm && run.duration_h ? { area: p.pcode, mm: run.rainfall_mm, h: run.duration_h } : null);
  }, []);

  // The report button next to the province picker: this result's report when one is showing, otherwise the national overview's.
  const [reportOpen, setReportOpen] = useState(false);
  const reportTarget: "scenario" | "overview" | null = kpis?.scenario_id ? "scenario" : series?.days.some((d) => d.h === overviewDay) ? "overview" : null;
  const onReport = useCallback(() => {
    if (!reportTarget) return;
    if (reportTarget === "scenario" && (burstLeftS() > 0 || !gate(() => setReportOpen(true)))) return;      // limit pending, or signed out (sign-in opens first)
    setReportOpen(true);
  }, [reportTarget]);
  const closeReport = useCallback(() => setReportOpen(false), []);

  const allMarkers = useMemo(() => markers.flatMap((m) => m.markers), [markers]);

  return (
    <div className="flex h-[var(--app-h,100dvh)] flex-col">
      <SignInDialog lang={lang} />
      <PhotoCheckModal lang={lang} open={photoOpen} onClose={() => setPhotoOpen(false)} scenarioId={kpis?.scenario_id}
        onAddToChat={(md) => setMessages((ms) => [...ms, { role: "assistant", text: md }])} />
      {reportOpen && reportTarget === "scenario" && kpis && <ReportModal lang={lang} source={{ mode: "scenario", kpis }} provinces={provinces} onClose={closeReport} />}
      {reportOpen && reportTarget === "overview" && series && <ReportModal lang={lang} source={{ mode: "overview", series, day: overviewDay }} provinces={provinces} onClose={closeReport} />}
      <Header lang={lang} setLang={setLang} tab={tab} onTab={setTab} onTour={() => setTourOpen(true)} />
      <Tour lang={lang} open={tourOpen} onClose={() => setTourOpen(false)} tab={tab} onTab={setTab} />
      {/* Below 1024px the chat and the map are tabs (full-width panels); on short screens the tabs live inside the header instead. */}
      <div className="lg:hidden short:hidden">
        <ViewTabs lang={lang} tab={tab} onTab={setTab} bar />
      </div>
      <main
        ref={row}
        className="relative grid min-h-0 flex-1 grid-cols-1 pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] lg:grid-cols-[var(--chat-col)_1fr]"
      >
        <div
          id="panel-chat"
          data-chat-scroll
          className={cn(
            "min-h-0 flex-col bg-background max-lg:mx-auto max-lg:w-full max-lg:max-w-[720px] max-lg:border-x lg:border-r short:overflow-y-auto short:overscroll-contain",
            tab === "chat" ? "flex" : "hidden lg:flex",
          )}
        >
          <ScenarioBar lang={lang} provinces={provinces} selected={selected} kpis={kpis} hasResults={hasResults} onSelect={selectByCode} onReset={clearScenario}
            report={{ target: reportTarget, busy: false, error: null, onClick: onReport }}
            watch={{ enabled: watchlist.enabled, watching: !!selected && watchlist.watching(selected.pcode), full: watchlist.full, busy: watchlist.busy, onToggle: () => selected && void watchlist.toggle(selected.pcode) }} />
          <div className="min-h-0 flex-1 short:flex-none">
          <ChatPanel
            lang={lang}
            history={{ summaries: history.summaries, loading: history.loading, signedIn: history.signedIn, accountHistory: history.accountHistory, onOpen: openChat, onNew: newChat, onDelete: history.remove }}
            onRestore={restoreRun}
            onPhoto={() => setPhotoOpen(true)}
            messages={messages}
            busy={busy}
            status={status}
            onSend={send}
            resent={resent}
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
            overview={overviewOn && series ? { series, day: overviewDay } : null}
            onPickProvince={selectByCode}
            onOverviewDay={pickOverviewDay}
          />
          </div>
        </div>
        <div id="panel-map" className={cn("min-h-0", tab === "map" ? "block" : "hidden lg:block")}>
          <MapBoundary lang={lang}><MapPanel lang={lang} layer={layer} layers={layers} staticLayers={staticLayers} markers={allMarkers} provinces={provinces} selected={selected} onSelect={selectProvince}
            overview={mapOverviewOn && series ? { series, day: overviewDay, metric: overviewMetric, playing } : null}
            onOverviewDay={pickOverviewDay}
            onOverviewMetric={setOverviewMetric}
            onOverviewPlay={() => setPlaying((v) => !v)}
          /></MapBoundary>
        </div>
        <ResizeHandle row={row} label={tr.resizeChat} />
      </main>
    </div>
  );
}
