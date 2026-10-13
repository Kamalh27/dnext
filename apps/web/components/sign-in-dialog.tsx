"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { LegalModal } from "./legal-modal";
import { closeSignIn, signIn, useAuth, type SignInError } from "@/lib/auth";
import { fmt, t } from "@/lib/i18n";
import type { LegalKind } from "@/lib/legal";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

const ERR_KEY = {
  popup: "signInErrPopup",
  network: "signInErrNetwork",
  domain: "signInErrDomain",
  not_enabled: "signInErrNotEnabled",
  too_many: "signInErrTooMany",
  generic: "signInErrGeneric",
} as const satisfies Record<SignInError, string>;

/** "Sign in to continue": explains the limits and offers "Continue with Google". Shown when a gated action is tried while signed out. */
export function SignInDialog({ lang }: { lang: Lang }) {
  const a = useAuth();
  const tr = t(lang);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const open = a.dialog && a.status === "signed_out";
  const limits = a.limits ?? a.config?.limits;

  return (
    <>
      <Modal open={open} onClose={closeSignIn} title={tr.signInTitle} closeLabel={tr.close} className="w-[min(94vw,28rem)]">
        <div data-testid="signin-dialog" className="space-y-4 px-5 py-4 text-sm leading-relaxed">
          <p className="text-foreground/90">{fmt(tr.signInBody, { chat: limits?.chat ?? "", run: limits?.run ?? "" })}</p>
          {a.unavailable ? (
            <p role="alert" data-testid="signin-unavailable" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{tr.signInErrUnavailable}</p>
          ) : (
            <GoogleButton label={tr.signInGoogle} busy={a.signingIn} />
          )}
          {a.signingIn && <p role="status" className="text-center text-muted-foreground">{tr.signInBusy}</p>}
          {a.error && <p role="alert" data-testid="signin-error" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{tr[ERR_KEY[a.error]]}</p>}
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

/** The multicolour Google "G" (fixed brand colours, the same in light and dark). */
function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Our own button, following Google's sign-in branding guidance: a neutral button with the multicolour "G" and
 * "Continue with Google" (white with a grey outline in light mode, near-black in dark mode), at a 44px touch height.
 */
function GoogleButton({ label, busy }: { label: string; busy: boolean }) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        data-testid="google-button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void signIn()}
        className={cn(
          "inline-flex h-11 w-full max-w-72 items-center justify-center gap-3 rounded-full border px-4 text-sm font-medium whitespace-nowrap outline-none transition-colors",
          "border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f2f2f2] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
          "dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#2a2a2c]",
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        <GoogleG className="size-[18px] shrink-0" />
        {label}
      </button>
    </div>
  );
}
