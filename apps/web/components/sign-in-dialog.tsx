"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./modal";
import { LegalModal } from "./legal-modal";
import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { closeSignIn, initGis, loadGis, useAuth, type SignInError } from "@/lib/auth";
import { fmt, t } from "@/lib/i18n";
import type { LegalKind } from "@/lib/legal";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

const ERR_KEY = { invalid: "signInErrInvalid", unavailable: "signInErrUnavailable", network: "signInErrNetwork", script: "signInErrScript" } as const satisfies Record<SignInError, string>;

/** "Sign in to continue": explains the limits and renders Google's own button. Shown when a gated action is tried while signed out. */
export function SignInDialog({ lang }: { lang: Lang }) {
  const a = useAuth();
  const tr = t(lang);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const open = a.dialog && a.status === "signed_out";
  const clientId = a.config?.google_client_id ?? null;
  const limits = a.limits ?? a.config?.limits;

  return (
    <>
      <Modal open={open} onClose={closeSignIn} title={tr.signInTitle} closeLabel={tr.close} className="w-[min(94vw,28rem)]">
        <div data-testid="signin-dialog" className="space-y-4 px-5 py-4 text-sm leading-relaxed">
          <p className="text-foreground/90">{fmt(tr.signInBody, { chat: limits?.chat ?? "", run: limits?.run ?? "" })}</p>
          {clientId ? (
            <GoogleButton lang={lang} clientId={clientId} busy={a.signingIn} />
          ) : (
            <p role="alert" className="text-destructive">{tr.signInErrUnavailable}</p>
          )}
          {a.signingIn && <p role="status" className="text-center text-muted-foreground">{tr.signInBusy}</p>}
          {a.error && a.error !== "script" && <p role="alert" data-testid="signin-error" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{tr[ERR_KEY[a.error]]}</p>}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-1.5">
              {tr.signInPrivacyLead}
              <button type="button" onClick={() => setLegal("privacy")} className="inline-flex min-h-8 items-center rounded px-0.5 font-medium text-foreground underline underline-offset-2 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11">
                {tr.legalPrivacy}
              </button>
            </p>
            <p>{tr.signInNote}</p>
          </div>
        </div>
      </Modal>
      <LegalModal lang={lang} kind={legal} onClose={() => setLegal(null)} />
    </>
  );
}

/** Loads the Google script on demand and lets it draw its button (theme and language follow the UI). */
function GoogleButton({ lang, clientId, busy }: { lang: Lang; clientId: string; busy: boolean }) {
  const tr = t(lang);
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadGis()
      .then(() => {
        if (!live || !host.current) return;
        const gsi = initGis(clientId);
        if (!gsi) throw new Error("gis");
        host.current.replaceChildren();
        gsi.renderButton(host.current, { type: "standard", theme: theme === "dark" ? "filled_black" : "outline", size: "large", text: "signin_with", shape: "pill", logo_alignment: "left", locale: lang, width: 280 });
        setState("ready");
      })
      .catch(() => { if (live) setState("failed"); });
    return () => { live = false; };
  }, [clientId, lang, theme, attempt]);

  return (
    <div className="space-y-2">
      <div className={cn("flex min-h-11 items-center justify-center", busy && "pointer-events-none opacity-50")} aria-busy={state === "loading"}>
        <div ref={host} data-testid="google-button" className={state === "ready" ? "" : "hidden"} />
        {state === "loading" && <span className="text-muted-foreground">{tr.signInLoading}</span>}
      </div>
      {state === "failed" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
          <span>{tr.signInErrScript}</span>
          <Button variant="outline" size="sm" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }}>{tr.retry}</Button>
        </div>
      )}
    </div>
  );
}
