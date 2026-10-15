"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUp, Camera, History, Plus, Square, ArrowUpRight, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "./markdown";
import { LegalModal } from "./legal-modal";
import { LogoMark } from "./logo";
import { OverviewCard } from "./overview-card";
import { ResultCards } from "./result-cards";
import { TrendCard } from "./trend-card";
import { ChatHistoryPanel } from "./chat-history";
import { Modal } from "./modal";
import type { ChatMessage, ChatSummary, RunRef } from "@/lib/chat-store";
import { ScenarioCard, type RunError, type RunKind } from "./scenario-card";
import type { ApiError } from "@/lib/api-error";
import { useAuth, useBurstLeft } from "@/lib/auth";
import { fmt, t } from "@/lib/i18n";
import { apiErrorText } from "@/lib/limit-text";
import type { LegalKind } from "@/lib/legal";
import type { ChartData, Kpis, Lang, OverviewSeries, Province, TableData } from "@/lib/types";
import { MQ, useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

/** `limit` = the API refused this turn with a 429 (daily or burst limit); it is rendered from the error so the language and the countdown stay live. */
export type Message = ChatMessage & { limit?: ApiError };

const TOOL = "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11";

interface Props {
  lang: Lang;
  messages: Message[];
  busy: boolean;
  status: string[];
  /** Returns false when the message was not sent (signed out, waiting out a limit, busy): the draft stays in the composer. */
  onSend: (text: string) => boolean;
  /** A chat message that sign-in had blocked was re-sent: drop the draft if it is still that message. */
  resent: { n: number; text: string } | null;
  onStop: () => void;
  onRetry: () => void;
  kpis: Kpis | null;
  charts: ChartData[];
  tables: TableData[];
  province: Province | null;
  runBusy: RunKind | null;
  runError: RunError | null;
  onScenario: (mm: number, h: number) => void;
  onForecast: (days: number) => void;
  /** National overview for the selected day (null = not in overview mode). */
  overview: { series: OverviewSeries; day: number } | null;
  onOverviewDay: (day: number) => void;
  onPickProvince: (pcode: string) => void;
  /** Saved chats: the list, and what to do with them. */
  history: { summaries: ChatSummary[]; loading: boolean; signedIn: boolean; accountHistory: boolean; onOpen: (id: string) => Promise<boolean>; onNew: () => void; onDelete: (id: string) => void };
  /** Show a past scenario run again (from a note in the conversation). */
  onRestore: (run: RunRef) => void;
  /** Open the photo check. */
  onPhoto: () => void;
}

export function ChatPanel(p: Props) {
  const tr = t(p.lang);
  const [input, setInput] = useState("");
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const auth = useAuth();
  const burstLeft = useBurstLeft();
  const chat = auth.status === "signed_in" ? auth.usage?.chat ?? null : null;
  const chatsLeft = chat ? Math.max(0, chat.limit - chat.used) : null;
  const noChats = chatsLeft === 0;
  const [seenResent, setSeenResent] = useState(0);
  if (p.resent && p.resent.n !== seenResent) {
    setSeenResent(p.resent.n);
    setInput((cur) => (cur.trim() === p.resent!.text ? "" : cur));
  }
  // The legal links stay pinned under the composer only on desktop; on phones/tablets and short screens they sit at the end of the scroll area (saves ~44px of pinned chrome).
  const desktop = useMedia(MQ.desktop);
  const short = useMedia(MQ.short);
  const legalInFlow = !desktop || short;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const promptsRef = useRef<HTMLUListElement>(null);
  const jumpToPrompts = () => promptsRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [p.messages, p.status, p.kpis, p.charts]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (noChats || burstLeft > 0) return;
    if (p.onSend(input)) setInput("");
  };

  const legalNav = (
      <nav data-testid="chat-legal" aria-label="Legal" className="flex shrink-0 flex-wrap items-center justify-center gap-x-1 gap-y-0 bg-background px-3 pt-1 pb-2 text-xs text-muted-foreground">
        {(["privacy", "cookies", "terms", "disclaimer"] as const).map((k) => (
          <button key={k} onClick={() => setLegal(k)} className="min-h-8 rounded px-1.5 py-1 underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-11 coarse:min-w-11 coarse:px-2">
            {{ privacy: tr.legalPrivacy, cookies: tr.legalCookies, terms: tr.legalTerms, disclaimer: tr.legalDisclaimer }[k]}
          </button>
        ))}
        <span aria-hidden className="px-1.5">© {new Date().getFullYear()} DNext</span>
      </nav>
  );

  return (
    <section aria-label={tr.chat} className="flex h-full flex-col short:h-auto">
      <div className="flex shrink-0 items-center justify-end gap-1.5 border-b bg-background px-3 py-1" data-testid="chat-toolbar">
        {p.messages.length > 0 && <button type="button" onClick={() => p.history.onNew()} data-testid="chat-new" className={TOOL}><Plus className="size-3.5" aria-hidden />{tr.newChat}</button>}
        <button type="button" onClick={() => { setOpenFailed(false); setHistoryOpen(true); }} data-testid="chat-history-open" className={TOOL}><History className="size-3.5" aria-hidden />{tr.historyOpen}</button>
      </div>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={tr.historyTitle} closeLabel={tr.close}>
        <div className="max-h-[70dvh] overflow-y-auto overscroll-contain">
          <ChatHistoryPanel lang={p.lang} summaries={p.history.summaries} loading={p.history.loading} signedIn={p.history.signedIn} accountHistory={p.history.accountHistory}
            onOpen={async (id) => { setOpenFailed(false); if (await p.history.onOpen(id)) setHistoryOpen(false); else setOpenFailed(true); }} onDelete={p.history.onDelete} />
          {openFailed && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{tr.historyOpenFailed}</p>}
        </div>
      </Modal>
      <div data-chat-scroll className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 short:flex-none short:overflow-visible" aria-live="polite">
        {p.messages.length === 0 && (
          <div className={cn("flex flex-col items-center gap-5 px-2 text-center", p.overview ? "pt-1" : "pt-6")}>
            {p.overview && <OverviewCard lang={p.lang} series={p.overview.series} day={p.overview.day} onDay={p.onOverviewDay} onSelect={p.onPickProvince} onAsk={jumpToPrompts} />}
            <div className="flex flex-col items-center">
            <span className="mb-4 grid size-16 place-items-center rounded-2xl bg-accent"><LogoMark className="size-11" /></span>
            <h2 className="text-lg font-semibold tracking-tight">{tr.emptyTitle}</h2>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{tr.empty}</p>
            </div>
            <ul id="chat-prompts" ref={promptsRef} className="w-full scroll-mt-3 space-y-2 text-left">
              {tr.prompts.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => p.onSend(s)}
                    disabled={burstLeft > 0}
                    className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-xs outline-none transition hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <span className="min-w-0 break-words">{s}</span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.messages.map((m, i) =>
          m.role === "activity" ? (
            <div key={i} className="flex items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="chat-activity">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1"><Activity className="size-3.5" aria-hidden />{m.text}</span>
              {m.run && m.run.scenario_id !== p.kpis?.scenario_id && (
                <button type="button" onClick={() => p.onRestore(m.run!)} className="rounded px-1.5 py-1 underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{tr.activityShow}</button>
              )}
            </div>
          ) : m.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <LogoMark className="mt-0.5 size-6" />
              <div className="min-w-0 flex-1 text-sm leading-relaxed">
                {p.busy && i === p.messages.length - 1 && !m.error && (
                  // progress chips sit on the same row as the icon (no extra rows while the model works)
                  <ul className="flex min-h-6 flex-wrap items-center gap-1.5" aria-label="Progress" aria-busy="true">
                    {(p.status.length ? p.status : [tr.thinking]).map((s, j, all) => {
                      const live = j === all.length - 1;
                      return (
                        <li key={s} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs", live ? "border-primary/30 bg-accent text-accent-foreground" : "text-muted-foreground")}>
                          {live && <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />}
                          {s}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {m.text && <div className={cn(p.busy && i === p.messages.length - 1 && "mt-1.5")}><Markdown text={m.text} /></div>}
                {m.limit && (
                  <div role={m.limit.isBurst && burstLeft > 0 ? "status" : "alert"} data-testid="chat-limit" className="mt-1 text-destructive">
                    {apiErrorText(m.limit, p.lang, burstLeft)}{" "}
                    {m.limit.isBurst && burstLeft === 0 && i === p.messages.length - 1 && <button className="underline" onClick={p.onRetry}>{tr.retry}</button>}
                  </div>
                )}
                {m.error && (
                  <div role="alert" className="mt-1 text-destructive">
                    {tr.error}: {m.error}{" "}
                    {i === p.messages.length - 1 && <button className="underline" onClick={p.onRetry}>{tr.retry}</button>}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {p.province && <TrendCard lang={p.lang} province={p.province} />}
        <ResultCards lang={p.lang} kpis={p.kpis} charts={p.charts} tables={p.tables} loading={p.busy} />
        {(p.province || p.kpis) && <ScenarioCard lang={p.lang} province={p.province} busy={p.runBusy} error={p.runError} onRun={p.onScenario} onForecast={p.onForecast} />}
        {legalInFlow && legalNav}
        <div ref={endRef} />
      </div>

      <div data-testid="chat-composer" className="border-t bg-background px-3 pt-3 pb-1 short:sticky short:bottom-0 short:z-10">
        <form onSubmit={submit} data-tour="chat" className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pr-1.5 pl-4 shadow-xs transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/30">
          <button type="button" onClick={p.onPhoto} aria-label={tr.photoOpen} title={tr.photoOpen} data-testid="photo-open"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring coarse:size-11">
            <Camera className="size-4" aria-hidden />
          </button>
          <input
            data-chat-input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr.placeholder}
            aria-label={tr.placeholder}
            enterKeyHint="send"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground coarse:h-11 coarse:text-base"
          />
          {p.busy ? (
            <Button type="button" variant="secondary" size="icon" className="rounded-full" onClick={p.onStop} aria-label={tr.stop} title={tr.stop}><Square className="fill-current" /></Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="rounded-full"
              disabled={!input.trim() || noChats || burstLeft > 0}
              aria-label={tr.send}
              title={noChats ? tr.chatLimitTitle : burstLeft > 0 ? fmt(tr.waitN, { n: burstLeft }) : tr.send}
            ><ArrowUp /></Button>
          )}
        </form>
        {burstLeft > 0 ? (
          <p role="status" data-testid="burst-wait" className="flex items-center gap-1.5 px-2 pt-1.5 text-xs text-amber-700 short:pt-0.5 dark:text-amber-400"><Timer className="size-3.5" aria-hidden />{fmt(tr.waitN, { n: burstLeft })}</p>
        ) : chatsLeft != null ? (
          <p data-testid="usage-line" className={cn("px-2 pt-1.5 text-xs short:pt-0.5", chatsLeft === 0 ? "text-destructive" : chatsLeft <= 5 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {chatsLeft === 0 ? tr.chatsLeftNone : chatsLeft === 1 ? tr.chatsLeftOne : fmt(tr.chatsLeftMany, { n: chatsLeft })}
            {chatsLeft <= 5 && <> · {tr.resetsMidnight}</>}
          </p>
        ) : null}
      </div>
      {!legalInFlow && legalNav}
      <LegalModal lang={p.lang} kind={legal} onClose={() => setLegal(null)} />
    </section>
  );
}
