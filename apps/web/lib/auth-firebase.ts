import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type Auth } from "firebase/auth";
import { errorCode, type AuthProvider } from "./auth-provider";

/** Real provider: Firebase Authentication, Google provider, default (IndexedDB) persistence. Only ever imported dynamically. */
export function createFirebaseProvider(): AuthProvider {
  let auth: Auth | null = null;
  const need = () => { if (!auth) throw Object.assign(new Error("auth not initialised"), { code: "auth/internal-error" }); return auth; };

  return {
    async init(config, onRedirectError) {
      if (auth) return;
      const app = getApps().length ? getApp() : initializeApp(config);   // no double init under dev HMR / a second call
      auth = getAuth(app);
      // Coming back from signInWithRedirect (the popup-blocked fallback): the user arrives via onAuthStateChanged, a failure is reported here.
      getRedirectResult(auth).catch((e) => { const c = errorCode(e); if (c) onRedirectError?.(c); });
    },

    onChange(cb) {
      return onAuthStateChanged(need(), (u) => cb(u ? { name: u.displayName ?? "", email: u.email ?? "", picture: u.photoURL } : null));
    },

    async signIn() {
      // No await before signInWithPopup: it must run inside the click that started it, or browsers block the popup.
      const a = need();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(a, provider);
      } catch (e) {
        const code = errorCode(e);
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;   // the user changed their mind: not an error
        if (code === "auth/popup-blocked") { await signInWithRedirect(a, provider); return; }          // the page navigates away; the result is picked up on return
        throw e;
      }
    },

    signOut: () => signOut(need()),

    async getToken(forceRefresh = false) {
      const u = need().currentUser;
      return u ? u.getIdToken(forceRefresh) : null;
    },
  };
}
