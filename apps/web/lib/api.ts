import { ApiError, readApiError } from "./api-error";
import { authStatus, getAuthToken, loadAuthConfig, onAuthRequired, refreshUsage, startBurst } from "./auth";
import { API_BASE } from "./config";
import { parseSSE } from "./sse";
import type { Infra } from "./infra";
import type { CommunityReport, ReportVerdict, RouteResponse, SafePlace } from "./types";
import type { AlertItem, PhotoResult, Trend, Watchlist } from "./types";
import type { ChatSummary, ChatThread, RunRef } from "./chat-store";
import type { Explain, ForecastResponse, Lang, OverviewSeries, Province, ReportData, ScenarioResponse, SseEvent, StaticLayersResponse, TambonShapes } from "./types";

export { API_BASE };
export { ApiError };

/**
 * fetch for the gated endpoints (POST /chat, /scenario, /forecast; GET /explain, /briefing/{id}): adds `Authorization: Bearer <Firebase ID
 * token>` (none in disabled mode), and turns every failure into an ApiError. A 401 gets ONE retry with a force-refreshed token; if that is
 * refused too, the session is dropped and the sign-in dialog opens. 429 starts the burst countdown (or refreshes the usage numbers for a
 * daily limit). Never retries anything else by itself.
 */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  void loadAuthConfig();   // no-op after the first call; makes sure "is sign-in on, and am I signed in?" gets answered
  const send = async (forceRefresh: boolean) => {
    const token = await getAuthToken(forceRefresh);
    if (!token && authStatus() === "signed_out") return { token, res: null };   // sign-in is required and nobody is signed in: no point asking the API
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return { token, res: await fetch(`${API_BASE}${path}`, { ...init, headers }) };
  };
  const first = await send(false);
  let res = first.res;
  let err: ApiError | null = res === null ? new ApiError(401, { code: "auth_required", message: "Sign in required" }) : null;
  if (res && res.status === 401) {
    err = await readApiError(res);
    if (first.token && err.isAuthRequired) {
      res = (await send(true)).res;   // the token may just have expired or been revoked: one retry with a fresh one
      err = res && !res.ok ? await readApiError(res) : null;
    }
  }
  if (res?.ok) return res;
  err ??= res ? await readApiError(res) : new ApiError(401, { code: "auth_required" });
  if (err.isAuthRequired) await onAuthRequired();
  else if (err.isBurst) startBurst(err.retryAfterS ?? 5);
  else if (err.isDaily) refreshUsage(0);
  throw err;
}

export async function streamChat(
  body: { message: string; session_id: string; language: Lang; area?: string; current?: RunRef; context?: string },
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
) {
  // 401/429 arrive as plain HTTP errors before any stream starts (authFetch throws them as ApiError).
  const res = await authFetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body || !(res.headers.get("content-type") || "").includes("text/event-stream")) throw new Error("Unexpected response from the server");
  for await (const raw of parseSSE(res.body)) {
    try {
      onEvent({ event: raw.event, data: JSON.parse(raw.data) } as SseEvent);
    } catch {
      /* ignore malformed event */
    }
  }
  refreshUsage();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A counted call succeeded: refresh the usage numbers (debounced, silent) and pass the result through. */
function counted<T>(v: T): T { refreshUsage(); return v; }

/** `area` is a province pcode (e.g. "TH55"). */
export const runScenario = (b: { area: string; rainfall_mm: number; duration_h: number }) =>
  authFetch("/scenario", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  }).then((r) => json<ScenarioResponse>(r)).then(counted);

export const runForecast = (b: { area: string; horizon_days: number }) =>
  authFetch("/forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  }).then((r) => json<ForecastResponse>(r)).then(counted);

export const fetchProvinces = (signal?: AbortSignal) => fetch("/provinces.json", { signal }).then((r) => json<Province[]>(r));

export const fetchStaticLayers = (signal?: AbortSignal) =>
  fetch(`${API_BASE}/layers/static`, { signal }).then((r) => json<StaticLayersResponse>(r));

/** National current conditions + 5 forecast days. 503 when the daily precompute is unavailable. */
export const fetchOverviewSeries = (signal?: AbortSignal) =>
  fetch(`${API_BASE}/overview/series?days=5`, { signal }).then((r) => json<OverviewSeries>(r));

export const explain = (lat: number, lng: number, scenarioId: string) =>
  authFetch(`/explain?${new URLSearchParams({ lat: String(lat), lng: String(lng), scenario_id: scenarioId })}`).then((r) => json<Explain>(r));

/** Opens the print-ready national overview report (a public page, no sign-in) for one slider day. */
/** Saved chats of the signed-in account. Call only when signed in: a refusal here would open the sign-in dialog. */
export const listRemoteChats = () => authFetch("/chats").then((r) => json<{ threads: Omit<ChatSummary, "where">[] }>(r)).then((x) => x.threads);
export const getRemoteChat = (id: string) => authFetch(`/chats/${encodeURIComponent(id)}`).then((r) => json<ChatThread>(r));
export const saveRemoteChat = (t: ChatThread) =>
  authFetch(`/chats/${encodeURIComponent(t.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t) }).then((r) => json<unknown>(r));
export const deleteRemoteChat = (id: string) => authFetch(`/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<unknown>(r));

export const fetchTrend = (pcode: string, days = 30) => fetch(`${API_BASE}/trend/${pcode}?days=${days}`).then((r) => json<Trend>(r));

/** Alerts and the watch list belong to a signed-in account. Call them only when signed in (a refusal would open the sign-in dialog). */
export const getWatchlist = () => authFetch("/watchlist").then((r) => json<Watchlist>(r));
export const putWatchlist = (w: { provinces: string[]; min_class: number; lang: Lang }) =>
  authFetch("/watchlist", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(w) }).then((r) => json<Pick<Watchlist, "provinces" | "min_class">>(r));
export const listAlerts = () => authFetch("/alerts").then((r) => json<{ unread: number; items: AlertItem[] }>(r));
export const markAlertsRead = () => authFetch("/alerts/read", { method: "POST" }).then((r) => json<unknown>(r));

export const photoCheck = (b: { image_b64: string; language: Lang; note?: string; scenario_id?: string }) =>
  authFetch("/photo-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => json<PhotoResult>(r));

export const fetchInfrastructure = (scenarioId: string) => authFetch(`/infrastructure/${encodeURIComponent(scenarioId)}`).then((r) => json<Infra>(r));

/** Candidate safe places near a point (open data, public). */
export const fetchShelters = (lat: number, lng: number, k = 8) =>
  fetch(`${API_BASE}/shelters/near?lat=${lat}&lng=${lng}&k=${k}`).then((r) => json<{ available: boolean; places: SafePlace[]; note: string }>(r));

/** Route preview (Google Routes API through the server), ranked against the risky roads of the result on screen. */
export const previewRoute = (b: { origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; mode: "DRIVE" | "WALK"; scenario_id?: string }) =>
  authFetch("/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => json<RouteResponse>(r));

export const fetchCommunityReports = () => fetch(`${API_BASE}/reports`).then((r) => json<{ reports: CommunityReport[]; note: string }>(r));
export const submitCommunityReport = (b: { image_b64: string; lat: number; lng: number; language: Lang; note?: string }) =>
  authFetch("/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => json<ReportVerdict>(r));
export const flagCommunityReport = (id: string) => authFetch(`/reports/${encodeURIComponent(id)}/flag`, { method: "POST" }).then((r) => json<unknown>(r));

export const fetchReportData = (scenarioId: string, lang: "en" | "th") =>
  authFetch(`/report-data/${encodeURIComponent(scenarioId)}?language=${lang}`).then((r) => json<ReportData>(r));

export const fetchOverviewReportData = (day: number, lang: "en" | "th") =>
  fetch(`${API_BASE}/overview/report-data?day=${day}&language=${lang}`).then((r) => json<ReportData>(r));

export const fetchTambonShapes = (pcode: string) => fetch(`${API_BASE}/geo/tambons/${pcode}`).then((r) => json<TambonShapes>(r));

export async function openOverviewReport(day: number, lang: "en" | "th") {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`${API_BASE}/overview/report?day=${day}&language=${lang}&print=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (tab) {
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      Object.assign(document.createElement("a"), { href: url, download: `national-overview-day${day}.html` }).click();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Opens the print-ready report in a new tab; the browser's print dialog then offers "Save as PDF". The tab is opened inside the click so pop-up blockers allow it. */
export async function openReport(scenarioId: string, lang: "en" | "th") {
  const tab = window.open("", "_blank");
  try {
    const res = await authFetch(`/briefing/${encodeURIComponent(scenarioId)}?language=${lang}&format=html&print=1`);
    const html = await res.text();
    if (tab) {
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
    } else {   // pop-up blocked: save the report as a file instead
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      Object.assign(document.createElement("a"), { href: url, download: `report-${scenarioId}.html` }).click();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}
