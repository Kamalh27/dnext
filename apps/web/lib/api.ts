import { ApiError, readApiError } from "./api-error";
import { onAuthRequired, refreshUsage, sessionToken, startBurst } from "./auth";
import { API_BASE } from "./config";
import { parseSSE } from "./sse";
import type { Explain, ForecastResponse, Lang, OverviewSeries, Province, ScenarioResponse, SseEvent, StaticLayersResponse } from "./types";

export { API_BASE };
export { ApiError };

/**
 * fetch for the gated endpoints (POST /chat, /scenario, /forecast; GET /explain, /briefing/{id}): adds the Bearer session token,
 * and turns every failure into an ApiError. 401 forgets the session and opens the sign-in dialog; 429 starts the burst countdown
 * (or refreshes the usage numbers for a daily limit). Never retries by itself.
 */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.ok) return res;
  const err = await readApiError(res);
  if (err.isAuthRequired) onAuthRequired();
  else if (err.isBurst) startBurst(err.retryAfterS ?? 5);
  else if (err.isDaily) refreshUsage(0);
  throw err;
}

export async function streamChat(
  body: { message: string; session_id: string; language: Lang; area?: string },
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

export async function downloadBriefing(scenarioId: string) {
  const res = await authFetch(`/briefing/${encodeURIComponent(scenarioId)}`);
  const ext = (res.headers.get("content-type") || "").includes("pdf") ? "pdf" : "html";
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `briefing-${scenarioId}.${ext}` });
  a.click();
  URL.revokeObjectURL(url);
}
