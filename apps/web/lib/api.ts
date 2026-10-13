import { parseSSE } from "./sse";
import type { Explain, Lang, ScenarioResponse, SseEvent, StaticLayersResponse } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

export async function streamChat(
  body: { message: string; session_id: string; language: Lang },
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  for await (const raw of parseSSE(res.body)) {
    try {
      onEvent({ event: raw.event, data: JSON.parse(raw.data) } as SseEvent);
    } catch {
      /* ignore malformed event */
    }
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const runScenario = (b: { area: string; rainfall_mm: number; duration_h: number }) =>
  fetch(`${API_BASE}/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  }).then((r) => json<ScenarioResponse>(r));

export const fetchStaticLayers = (signal?: AbortSignal) =>
  fetch(`${API_BASE}/layers/static`, { signal }).then((r) => json<StaticLayersResponse>(r));

export const explain = (lat: number, lng: number, scenarioId: string) =>
  fetch(`${API_BASE}/explain?${new URLSearchParams({ lat: String(lat), lng: String(lng), scenario_id: scenarioId })}`).then(
    (r) => json<Explain>(r),
  );

export async function downloadBriefing(scenarioId: string) {
  const res = await fetch(`${API_BASE}/briefing/${encodeURIComponent(scenarioId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ext = (res.headers.get("content-type") || "").includes("pdf") ? "pdf" : "html";
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `briefing-${scenarioId}.${ext}` });
  a.click();
  URL.revokeObjectURL(url);
}
