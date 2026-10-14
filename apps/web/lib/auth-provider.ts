/**
 * Thin sign-in provider layer. The app (lib/auth.ts) only talks to this interface; the real implementation is Firebase
 * Authentication with the Google provider (lib/auth-firebase.ts). The Firebase SDK is loaded lazily with a dynamic import(),
 * and only when GET /auth/config says sign-in is required and sends a Firebase web config, so disabled mode loads none of it.
 */

/** Firebase web config: public identifiers, fetched from GET /auth/config at runtime (no rebuild per environment). */
export interface FirebaseWebConfig { apiKey: string; authDomain: string; projectId: string; appId: string }

export interface ProviderUser { name: string; email: string; picture: string | null }

export interface AuthProvider {
  /** Prepare the SDK (idempotent, safe under HMR). `onRedirectError` gets the error code if a redirect sign-in came back failed. */
  init(config: FirebaseWebConfig, onRedirectError?: (code: string) => void): Promise<void>;
  /** Subscribe to sign-in state. The first call (with a user or null) is the end of the "loading" state. Returns an unsubscribe function. */
  onChange(cb: (user: ProviderUser | null) => void): () => void;
  /** Open the Google sign-in. Rejects with an error carrying a Firebase-style `code` ("auth/..."); user-cancelled attempts resolve silently. */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** The current ID token (the SDK refreshes the 1-hour token itself); `forceRefresh` bypasses its cache. null when signed out. */
  getToken(forceRefresh?: boolean): Promise<string | null>;
}

declare global {
  interface Window {
    /** DEV/TEST ONLY hook, see loadProvider(). */
    __dnextAuthStub?: AuthProvider;
  }
}

/** Firebase config in /auth/config is usable only with all four values. */
export function isFirebaseConfig(c: unknown): c is FirebaseWebConfig {
  const o = c as Partial<Record<keyof FirebaseWebConfig, unknown>> | null;
  return !!o && ["apiKey", "authDomain", "projectId", "appId"].every((k) => typeof o[k as keyof FirebaseWebConfig] === "string" && !!o[k as keyof FirebaseWebConfig]);
}

/** The error code ("auth/popup-blocked", ...) of whatever the SDK threw, if any. */
export const errorCode = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : undefined;
};

export async function loadProvider(): Promise<AuthProvider> {
  // DEV/TEST HOOK: Firebase popups cannot be driven by a headless browser, so in NON-production builds a page may install
  // `window.__dnextAuthStub` (an object with this same interface, e.g. via Playwright's addInitScript) before the app loads and it
  // replaces Firebase entirely. The condition is inline on process.env.NODE_ENV on purpose: in a production build the bundler
  // replaces it with `false` and drops the whole branch, so the hook does not exist there.
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && window.__dnextAuthStub) return window.__dnextAuthStub;
  const { createFirebaseProvider } = await import("./auth-firebase");
  return createFirebaseProvider();
}
