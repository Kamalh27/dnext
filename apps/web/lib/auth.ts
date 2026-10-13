import { useSyncExternalStore } from "react";
import { ApiError, readApiError } from "./api-error";
import { API_BASE } from "./config";

/**
 * Sign in with Google + per-account limits, as a small external store (same pattern as lib/panel-state.ts):
 * hydration-safe (the server and the first client render see "disabled"), no provider needed, usable outside React.
 * Tokens are only ever sent to the API in an Authorization header; nothing here logs them.
 */

export const SESSION_KEY = "lw-session";
const GIS_SRC = "https://accounts.google.com/gsi/client";

export interface AuthUser { name: string; email: string; picture?: string | null }
export interface Limits { chat: number; run: number; burst_per_min: number }
export interface Usage { day: string; resets_in_s: number; chat: { used: number; limit: number }; run: { used: number; limit: number } }
export interface AuthConfig { auth_required: boolean; google_client_id: string | null; limits?: Limits }
interface Session { token: string; expires_at: number; user: AuthUser }

export type AuthStatus = "disabled" | "signed_out" | "signed_in";
export type SignInError = "invalid" | "unavailable" | "network" | "script";

interface State {
  config: AuthConfig | null;     // null until /auth/config answered (or when it failed): treated as disabled
  session: Session | null;
  usage: Usage | null;
  limits: Limits | null;
  dialog: boolean;
  signingIn: boolean;
  error: SignInError | null;
  burstUntil: number;            // epoch ms; sends/runs wait until then
}

const SERVER: State = { config: null, session: null, usage: null, limits: null, dialog: false, signingIn: false, error: null, burstUntil: 0 };
let state: State = SERVER;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<State>) { state = { ...state, ...patch }; emit(); }

// ---- session storage (try/catch everywhere: blocked storage must never break the app)
function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && typeof s.token === "string" && typeof s.expires_at === "number" && s.expires_at > Date.now() && s.user && typeof s.user === "object") return s as Session;
    localStorage.removeItem(SESSION_KEY);
  } catch { /* unreadable: treat as signed out */ }
  return null;
}
function writeStored(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked: the session lives for this visit only */ }
}

let expiryTimer: ReturnType<typeof setTimeout> | undefined;
function armExpiry(s: Session | null) {
  clearTimeout(expiryTimer);
  if (!s) return;
  expiryTimer = setTimeout(() => { if (state.session === s) clearSession(); }, Math.min(Math.max(s.expires_at - Date.now(), 0), 2 ** 31 - 1));
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const session = readStored();
  state = { ...state, session };
  armExpiry(session);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SESSION_KEY) return;
    const session = readStored();
    armExpiry(session);
    set({ session, usage: session ? state.usage : null });
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}
const getSnapshot = () => { ensureLoaded(); return state; };
const getServerSnapshot = () => SERVER;

export const statusOf = (s: State): AuthStatus => (!s.config?.auth_required ? "disabled" : s.session ? "signed_in" : "signed_out");
/** Non-reactive reads for event handlers and the API layer. */
export const authStatus = (): AuthStatus => statusOf(getSnapshot());
export const sessionToken = (): string | null => {
  const s = getSnapshot().session;
  if (!s) return null;
  if (s.expires_at <= Date.now()) { clearSession(); return null; }
  return s.token;
};

export function useAuth() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...s, status: statusOf(s) };
}

// ---- config
let configStarted = false;
/** Fetch /auth/config once. Any failure means "auth not in use": the app behaves exactly as without sign-in. */
export async function loadAuthConfig() {
  if (configStarted) return;
  configStarted = true;
  try {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (!res.ok) return;
    const c = (await res.json()) as AuthConfig;
    if (typeof c?.auth_required !== "boolean") return;
    set({ config: c, limits: c.limits ?? state.limits });
    if (c.auth_required && state.session) void refreshUsageNow();
  } catch { /* disabled */ }
}

// ---- usage
async function refreshUsageNow() {
  const token = sessionToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { if (sessionToken() === token) clearSession(); return; }
    if (!res.ok) return;
    const j = await res.json();
    if (sessionToken() !== token || !j?.usage) return;
    set({ usage: j.usage as Usage, limits: (j.limits as Limits) ?? state.limits });
  } catch { /* silent */ }
}
let usageTimer: ReturnType<typeof setTimeout> | undefined;
/** Debounced, silent GET /me. Call after every successful (or limit-refused) gated call. */
export function refreshUsage(delay = 400) {
  if (authStatus() !== "signed_in") return;
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => void refreshUsageNow(), delay);
}

// ---- burst countdown
let burstTicker: ReturnType<typeof setInterval> | undefined;
export const burstLeftS = () => Math.max(0, Math.ceil((state.burstUntil - Date.now()) / 1000));
export function startBurst(seconds: number) {
  const s = Math.max(1, Math.ceil(seconds));
  set({ burstUntil: Date.now() + s * 1000 });
  clearInterval(burstTicker);
  burstTicker = setInterval(() => { emit(); if (burstLeftS() === 0) clearInterval(burstTicker); }, 250);
}
/** Whole seconds left in the burst wait (0 = free to go). Ticks while counting down. */
export function useBurstLeft(): number {
  return useSyncExternalStore(subscribe, burstLeftS, () => 0);
}

// ---- dialog + gate
let pending: (() => void) | null = null;

/** Open the sign-in dialog. `then` runs once after a successful sign-in (e.g. re-send the blocked chat message). */
export function requestSignIn(then?: () => void) {
  pending = then ?? null;
  set({ dialog: true, error: null });
}
export function closeSignIn() {
  pending = null;
  set({ dialog: false, error: null });
}
/** True when the action may go ahead. Signed out (auth required): opens the dialog and returns false; the API is not called. */
export function gate(then?: () => void): boolean {
  if (authStatus() !== "signed_out") return true;
  requestSignIn(then);
  return false;
}

export function clearSession() {
  clearTimeout(expiryTimer);
  writeStored(null);
  set({ session: null, usage: null });
}

export function signOut() {
  clearSession();
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* ignore */ }
}

/** The API refused our session (expired/invalid): forget it and ask the user to sign in again. */
export function onAuthRequired() {
  if (state.config?.auth_required) { clearSession(); set({ dialog: true, error: null }); }
}

// ---- Google Identity Services
interface GsiId {
  initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
  disableAutoSelect?(): void;
  cancel?(): void;
}
declare global { interface Window { google?: { accounts?: { id?: GsiId } } } }

let gisPromise: Promise<void> | null = null;
/** Load the GIS script once (lazily). Rejects on network failure, and a later call tries again. */
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve() : (s.remove(), (gisPromise = null), reject(new Error("gis"))));
    s.onerror = () => { s.remove(); gisPromise = null; reject(new Error("gis")); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

let initedFor: string | null = null;
/** Initialise GIS with the client id; the callback exchanges the Google credential for our own session. */
export function initGis(clientId: string): GsiId | null {
  const id = window.google?.accounts?.id;
  if (!id) return null;
  if (initedFor !== clientId) {
    id.initialize({ client_id: clientId, callback: (r) => { if (r?.credential) void signInWithCredential(r.credential); }, auto_select: false, cancel_on_tap_outside: true });
    initedFor = clientId;
  }
  return id;
}

export function setSignInError(error: SignInError | null) { set({ error }); }

async function signInWithCredential(credential: string) {
  set({ signingIn: true, error: null });
  try {
    const res = await fetch(`${API_BASE}/auth/google`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }) });
    if (!res.ok) throw await readApiError(res);
    const j = await res.json();
    if (typeof j?.token !== "string" || !j.user) throw new Error("bad response");
    const session: Session = { token: j.token, expires_at: Date.now() + (Number(j.expires_in_s) || 3600) * 1000, user: j.user };
    writeStored(session);
    armExpiry(session);
    set({ session, usage: j.usage ?? null, limits: j.limits ?? state.limits, signingIn: false, dialog: false, error: null });
    const then = pending;
    pending = null;
    if (then) setTimeout(then, 0);
    else refreshUsage(0);
  } catch (e) {
    const err = e instanceof ApiError ? (e.status === 503 ? "unavailable" : e.status === 401 || e.status === 400 || e.status === 422 ? "invalid" : "network") : "network";
    set({ signingIn: false, error: err });
  }
}
