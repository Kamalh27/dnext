import { useSyncExternalStore } from "react";
import { errorCode, isFirebaseConfig, loadProvider, type AuthProvider, type FirebaseWebConfig, type ProviderUser } from "./auth-provider";
import { API_BASE } from "./config";

/**
 * Sign in with Google (Firebase Authentication) + per-account limits, as a small external store (same pattern as lib/panel-state.ts):
 * hydration-safe (the server and the first client render see "disabled"), no provider needed, usable outside React.
 * The identity itself lives in the provider (lib/auth-provider.ts); this store only mirrors it, plus usage and the dialog.
 * Every gated request carries the provider's current ID token as `Authorization: Bearer ...`; nothing here ever logs a token.
 */

export type AuthUser = ProviderUser;
export interface Limits { chat: number; run: number; burst_per_min: number }
export interface Usage { day: string; resets_in_s: number; chat: { used: number; limit: number }; run: { used: number; limit: number } }
export interface AuthConfig { auth_required: boolean; firebase: FirebaseWebConfig | null; limits?: Limits }

/** disabled = the API does not require sign-in (no UI at all); loading = restoring the previous session (no "Sign in" flash). */
export type AuthStatus = "disabled" | "loading" | "signed_out" | "signed_in";
/** What went wrong while signing in, as the dialog words it (see mapSignInError). */
export type SignInError = "popup" | "network" | "domain" | "not_enabled" | "too_many" | "generic";

interface State {
  config: AuthConfig | null;     // null until /auth/config answered (or when it failed): treated as disabled
  ready: boolean;                // the provider reported its first sign-in state
  unavailable: boolean;          // sign-in is required but the API sent no usable Firebase config
  user: AuthUser | null;
  usage: Usage | null;
  limits: Limits | null;
  dialog: boolean;
  signingIn: boolean;
  error: SignInError | null;
  burstUntil: number;            // epoch ms; sends/runs wait until then
}

const SERVER: State = { config: null, ready: false, unavailable: false, user: null, usage: null, limits: null, dialog: false, signingIn: false, error: null, burstUntil: 0 };
let state: State = SERVER;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<State>) { state = { ...state, ...patch }; emit(); }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const getSnapshot = () => state;
const getServerSnapshot = () => SERVER;

export const statusOf = (s: State): AuthStatus => (!s.config?.auth_required ? "disabled" : !s.ready ? "loading" : s.user ? "signed_in" : "signed_out");
/** Non-reactive reads for event handlers and the API layer. */
export const authStatus = (): AuthStatus => statusOf(state);

export function useAuth() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...s, status: statusOf(s) };
}

// ---- settling: "do we know yet whether (and as whom) the user is signed in?"
let settle!: () => void;
const settled = new Promise<void>((r) => { settle = r; });
/** Resolves once /auth/config has answered and, when sign-in is required, the provider has reported its first state (10 s cap). */
const authSettled = () => Promise.race([settled, new Promise<void>((r) => setTimeout(r, 10_000))]);

// ---- provider + config
let provider: AuthProvider | null = null;
let providerStarting: Promise<AuthProvider> | null = null;
let unsubscribe: (() => void) | null = null;

/** Load + initialise the provider (once; a failed start is retried by the next call, e.g. the next sign-in click). */
function ensureProvider(): Promise<AuthProvider> {
  if (provider) return Promise.resolve(provider);
  providerStarting ??= (async () => {
    const fb = state.config?.firebase;
    if (!isFirebaseConfig(fb)) throw new Error("no firebase config");
    const p = await loadProvider();
    await p.init(fb, (code) => set({ dialog: true, error: mapSignInError(code), signingIn: false }));
    provider = p;
    unsubscribe?.();
    unsubscribe = p.onChange(handleUser);
    return p;
  })().catch((e) => { providerStarting = null; throw e; });
  return providerStarting;
}

/** The provider reported a (possibly restored) user, or none. */
function handleUser(user: AuthUser | null) {
  const wasIn = !!state.user;
  set({ ready: true, user, usage: user ? state.usage : null });
  settle();
  if (!user) return;
  if (state.dialog) {
    // A sign-in that the user asked for finished: close the dialog and run what was waiting for it (e.g. re-send the blocked chat message).
    const then = pending;
    pending = null;
    set({ dialog: false, error: null, signingIn: false });
    if (then) setTimeout(then, 0);
  }
  if (!wasIn) refreshUsage(0);
}

let configStarted = false;
/** Fetch /auth/config once. Any failure means "auth not in use": the app behaves exactly as without sign-in. */
export async function loadAuthConfig() {
  if (configStarted) return;
  configStarted = true;
  try {
    const res = await fetch(`${API_BASE}/auth/config`);
    if (!res.ok) { settle(); return; }
    const c = (await res.json()) as AuthConfig;
    if (typeof c?.auth_required !== "boolean") { settle(); return; }
    const config: AuthConfig = { auth_required: c.auth_required, firebase: isFirebaseConfig(c.firebase) ? c.firebase : null, limits: c.limits };
    set({ config, limits: c.limits ?? state.limits });
    if (!config.auth_required) { settle(); return; }
    if (!config.firebase) {
      console.warn("[auth] The API requires sign-in but sent no Firebase web config; sign-in is unavailable.");
      set({ unavailable: true, ready: true });
      settle();
      return;
    }
    try { await ensureProvider(); }
    catch (e) {
      console.warn("[auth] Could not start sign-in:", errorCode(e) ?? (e as Error)?.name ?? "error");
      set({ ready: true });   // looks signed out; the sign-in click starts the SDK again (and says so if it still cannot)
      settle();
    }
  } catch { settle(); /* disabled */ }
}

// ---- tokens
/** The current ID token, or null when signed out / disabled. Waits while the previous session is being restored. Throws only if refreshing fails. */
export async function getAuthToken(forceRefresh = false): Promise<string | null> {
  await authSettled();
  if (!provider || !state.user) return null;
  try { return await provider.getToken(forceRefresh); }
  catch (e) { console.warn("[auth] Could not get a sign-in token:", errorCode(e) ?? "error"); throw new Error("Could not refresh your sign-in. Check your connection and try again."); }
}

// ---- usage
async function refreshUsageNow() {
  const who = state.user?.email;
  if (!who) return;
  try {
    let res: Response | null = null;
    for (const force of [false, true]) {
      const token = await getAuthToken(force);
      if (!token) return;
      res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status !== 401) break;
    }
    if (!res) return;
    if (res.status === 401) { if (state.user?.email === who) await signOut(); return; }   // the API refuses this account: do not look signed in
    if (!res.ok) return;
    const j = await res.json();
    if (state.user?.email !== who || !j?.usage) return;
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
  if (authStatus() !== "signed_out") return true;   // while "loading" the API layer waits for the restored session
  requestSignIn(then);
  return false;
}

// ---- sign in / out
/** Firebase error code -> what the dialog says. null = the user just closed the window: say nothing. */
export function mapSignInError(code: string | undefined): SignInError | null {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return null;
    case "auth/popup-blocked": return "popup";
    case "auth/network-request-failed": return "network";
    case "auth/unauthorized-domain": return "domain";
    case "auth/operation-not-allowed": return "not_enabled";
    case "auth/too-many-requests": return "too_many";
    default: return "generic";
  }
}

/** Start the Google sign-in (called from the dialog's button). The result arrives through the provider's onChange. */
export async function signIn() {
  if (state.signingIn) return;
  set({ signingIn: true, error: null });
  try {
    // With the provider already running there is no await before provider.signIn(), so the popup opens inside the user's click.
    const p = provider ?? (await ensureProvider());
    await p.signIn();
  } catch (e) {
    const code = errorCode(e);
    const err = provider ? mapSignInError(code) : "network";   // no provider: its script could not be loaded or started
    if (err === "generic" || !provider) console.warn("[auth] Sign-in failed:", code ?? "error");
    set({ error: err });
  } finally {
    set({ signingIn: false });
  }
}

export async function signOut() {
  clearTimeout(usageTimer);
  set({ user: null, usage: null });
  try { await provider?.signOut(); } catch { /* the local state is already signed out */ }
}

/** The API refused our token even after a refresh: forget the session and ask the user to sign in again. */
export async function onAuthRequired() {
  if (!state.config?.auth_required) return;
  if (state.user) await signOut();
  set({ dialog: true, error: null });
}
