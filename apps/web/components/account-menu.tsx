"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { requestSignIn, signOut, useAuth, type Usage } from "@/lib/auth";
import { fmt, t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const headerBtn = "text-primary-foreground hover:bg-primary-foreground/15 dark:text-foreground dark:hover:bg-accent";

/** Header slot for sign-in: nothing when auth is off, a placeholder while restoring, "Sign in" when signed out, an avatar with the usage menu when signed in. */
export function AuthControls({ lang }: { lang: Lang }) {
  const a = useAuth();
  if (a.status === "disabled") return null;
  if (a.status === "loading") return <LoadingSlot />;
  if (a.status === "signed_out" || !a.user) return <SignInButton lang={lang} />;
  return <AccountMenu lang={lang} user={a.user} usage={a.usage} limits={a.limits} />;
}

/** While a previous session is being restored: a quiet placeholder the size of the avatar (and of the icon-only sign-in button), so nothing flashes or jumps. */
function LoadingSlot() {
  return <span data-auth-loading aria-hidden className="size-8 shrink-0 animate-pulse rounded-full bg-primary-foreground/15 motion-reduce:animate-none coarse:size-11 dark:bg-accent" />;
}

function SignInButton({ lang }: { lang: Lang }) {
  const tr = t(lang);
  return (
    <button
      type="button"
      data-signin-btn
      onClick={() => requestSignIn()}
      aria-label={tr.signIn}
      title={tr.signIn}
      className={cn(headerBtn, "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-foreground/70 max-sm:px-0 short:px-0 coarse:h-11 coarse:min-w-11 dark:focus-visible:ring-ring")}
    >
      <LogIn className="size-4" aria-hidden />
      <span className="max-sm:hidden short:hidden">{tr.signIn}</span>
    </button>
  );
}

const initials = (name: string, email: string) => {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

function Avatar({ name, email, picture, className }: { name: string; email: string; picture?: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);   // the picture URL that failed to load
  const show = !!picture && failed !== picture;
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-foreground/20 text-xs font-semibold text-primary-foreground dark:bg-accent dark:text-accent-foreground", className)}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- Google profile photo from an arbitrary host
        <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(picture)} className="size-full object-cover" />
      ) : initials(name, email)}
    </span>
  );
}

type Tone = "ok" | "low" | "none";
const toneOf = (left: number, limit: number): Tone => (left <= 0 ? "none" : left <= (limit <= 30 ? 5 : Math.ceil(limit * 0.1)) ? "low" : "ok");
export const toneCls = { ok: "bg-primary", low: "bg-amber-500", none: "bg-destructive" } as const;

function UsageBar({ label, used, limit, testId }: { label: string; used: number; limit: number; testId: string }) {
  const left = Math.max(0, limit - used);
  const tone = toneOf(left, limit);
  return (
    <div data-testid={testId} className="space-y-1">
      <p className="text-xs">{label}</p>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={left} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width]", toneCls[tone])} style={{ width: `${limit > 0 ? Math.min(100, (left / limit) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

function AccountMenu({ lang, user, usage, limits }: { lang: Lang; user: { name: string; email: string; picture?: string | null }; usage: Usage | null; limits: { chat: number; run: number } | null }) {
  const tr = t(lang);
  const id = useId();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    pop.current?.focus();
    const away = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!pop.current?.contains(n) && !btn.current?.contains(n)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const chat = usage?.chat ?? (limits ? { used: 0, limit: limits.chat } : null);
  const run = usage?.run ?? (limits ? { used: 0, limit: limits.run } : null);
  const label = user.name || user.email;

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-account-btn
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-label={`${tr.account}: ${label}`}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(headerBtn, "grid size-8 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-foreground/70 coarse:size-11 dark:focus-visible:ring-ring", open && "bg-primary-foreground/15 dark:bg-accent")}
      >
        <Avatar name={user.name} email={user.email} picture={user.picture} />
      </button>
      {open && (
        <div
          ref={pop}
          id={id}
          role="dialog"
          aria-label={tr.account}
          tabIndex={-1}
          onBlur={(e) => { const n = e.relatedTarget as Node | null; if (n && !pop.current?.contains(n) && !btn.current?.contains(n)) setOpen(false); }}
          data-testid="account-menu"
          className="fixed top-[calc(3.5rem+env(safe-area-inset-top,0px)+0.25rem)] right-[max(0.75rem,env(safe-area-inset-right,0px))] z-50 max-h-[calc(100dvh-4.5rem)] w-72 max-w-[calc(100vw-1.5rem)] space-y-3 overflow-y-auto rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none short:top-[calc(3rem+env(safe-area-inset-top,0px)+0.25rem)] short:max-h-[calc(100dvh-3.5rem)]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={user.name} email={user.email} picture={user.picture} className="size-10 text-sm bg-accent text-accent-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium" title={user.name}>{user.name}</p>
              <p className="truncate text-xs text-muted-foreground" title={user.email}>{user.email}</p>
            </div>
          </div>
          {(chat || run) && (
            <div className="space-y-2.5 border-t pt-3">
              {chat && <UsageBar testId="usage-chat" label={fmt(tr.usageChatsLeft, { left: Math.max(0, chat.limit - chat.used), limit: chat.limit })} used={chat.used} limit={chat.limit} />}
              {run && <UsageBar testId="usage-run" label={fmt(tr.usageRunsLeft, { left: Math.max(0, run.limit - run.used), limit: run.limit })} used={run.used} limit={run.limit} />}
              <p className="text-xs text-muted-foreground">{tr.usageResets}</p>
            </div>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setOpen(false);
              signOut();
              requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-signin-btn]")?.focus());
            }}
          >
            <LogOut aria-hidden /> {tr.signOut}
          </Button>
        </div>
      )}
    </>
  );
}
