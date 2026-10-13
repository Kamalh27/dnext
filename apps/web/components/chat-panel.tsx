"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LegalModal } from "./legal-modal";
import { LogoMark } from "./logo";
import { Skeleton } from "@/components/ui/skeleton";
import { ResultCards } from "./result-cards";
import { ScenarioCard } from "./scenario-card";
import { t } from "@/lib/i18n";
import type { LegalKind } from "@/lib/legal";
import type { ChartData, Kpis, Lang, TableData } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Message { role: "user" | "assistant"; text: string; error?: string }

interface Props {
  lang: Lang;
  messages: Message[];
  busy: boolean;
  status: string[];
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  kpis: Kpis | null;
  charts: ChartData[];
  tables: TableData[];
  scenarioBusy: boolean;
  scenarioError: string | null;
  onScenario: (mm: number, h: number) => void;
}

export function ChatPanel(p: Props) {
  const tr = t(p.lang);
  const [input, setInput] = useState("");
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [p.messages, p.status, p.kpis, p.charts]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    p.onSend(input);
    setInput("");
  };

  return (
    <section aria-label={tr.chat} className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
        {p.messages.length === 0 && (
          <div className="flex flex-col items-center px-2 pt-6 text-center">
            <span className="mb-4 grid size-16 place-items-center rounded-2xl bg-accent"><LogoMark className="size-11" /></span>
            <h2 className="text-lg font-semibold tracking-tight">{tr.emptyTitle}</h2>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{tr.empty}</p>
            <ul className="mt-6 w-full space-y-2 text-left">
              {tr.prompts.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => p.onSend(s)}
                    className="group flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-xs outline-none transition hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{s}</span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <LogoMark className="mt-0.5 size-6" />
              <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed">
                {m.text || (p.busy && i === p.messages.length - 1 && !m.error ? (
                  <div className="space-y-2 pt-1" aria-busy="true"><Skeleton className="h-3 w-48" /><Skeleton className="h-3 w-32" /></div>
                ) : null)}
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
        {p.busy && p.status.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pl-8" aria-label="Progress">
            {p.status.map((s, i) => {
              const live = i === p.status.length - 1;
              return (
                <li key={s} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs", live ? "border-primary/30 bg-accent text-accent-foreground" : "text-muted-foreground")}>
                  {live && <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />}
                  {s}
                </li>
              );
            })}
          </ul>
        )}
        <ResultCards lang={p.lang} kpis={p.kpis} charts={p.charts} tables={p.tables} loading={p.busy} />
        {p.kpis && <ScenarioCard lang={p.lang} kpis={p.kpis} busy={p.scenarioBusy} error={p.scenarioError} onRun={p.onScenario} />}
        <div ref={endRef} />
      </div>

      <div className="border-t bg-background px-3 pt-3 pb-2">
        <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pr-1.5 pl-4 shadow-xs transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/30">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr.placeholder}
            aria-label={tr.placeholder}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {p.busy ? (
            <Button type="button" variant="secondary" size="icon" className="rounded-full" onClick={p.onStop} aria-label={tr.stop} title={tr.stop}><Square className="fill-current" /></Button>
          ) : (
            <Button type="submit" size="icon" className="rounded-full" disabled={!input.trim()} aria-label={tr.send} title={tr.send}><ArrowUp /></Button>
          )}
        </form>
        <nav aria-label="Legal" className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {(["privacy", "cookies", "terms", "disclaimer"] as const).map((k) => (
            <button key={k} onClick={() => setLegal(k)} className="rounded underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {{ privacy: tr.legalPrivacy, cookies: tr.legalCookies, terms: tr.legalTerms, disclaimer: tr.legalDisclaimer }[k]}
            </button>
          ))}
          <span aria-hidden>© {new Date().getFullYear()} DNext</span>
        </nav>
        <LegalModal lang={p.lang} kind={legal} onClose={() => setLegal(null)} />
      </div>
    </section>
  );
}
