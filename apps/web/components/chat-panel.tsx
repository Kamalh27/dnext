"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResultCards } from "./result-cards";
import { ScenarioCard } from "./scenario-card";
import { t } from "@/lib/i18n";
import type { ChartData, Kpis, Lang, TableData } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Message { role: "user" | "assistant"; text: string; error?: string }

interface Props {
  lang: Lang;
  setLang: (l: Lang) => void;
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
  const endRef = useRef<HTMLDivElement>(null);
  const last = p.messages[p.messages.length - 1];

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
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-semibold">{tr.title}</h1>
        <div role="group" aria-label={tr.language} className="flex gap-1">
          {(["en", "th"] as const).map((l) => (
            <Button key={l} size="xs" variant={p.lang === l ? "default" : "outline"} aria-pressed={p.lang === l} onClick={() => p.setLang(l)}>
              {l.toUpperCase()}
            </Button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {p.messages.length === 0 && <p className="text-sm text-muted-foreground">{tr.empty}</p>}
        {p.messages.map((m, i) => (
          <div key={i} className={cn("max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
            {m.text || (m.role === "assistant" && p.busy && i === p.messages.length - 1 && !m.error ? (
              <div className="space-y-2" aria-busy="true"><Skeleton className="h-3 w-48" /><Skeleton className="h-3 w-32" /></div>
            ) : null)}
            {m.error && (
              <div role="alert" className="mt-1 text-destructive">
                {tr.error}: {m.error}{" "}
                {i === p.messages.length - 1 && <button className="underline" onClick={p.onRetry}>{tr.retry}</button>}
              </div>
            )}
          </div>
        ))}
        {p.busy && p.status.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Progress">
            {p.status.map((s, i) => (
              <li key={s} className={cn("rounded-full border px-2.5 py-0.5 text-xs", i === p.status.length - 1 ? "bg-secondary" : "text-muted-foreground")}>
                {s}
              </li>
            ))}
          </ul>
        )}
        <ResultCards lang={p.lang} kpis={p.kpis} charts={p.charts} tables={p.tables} loading={p.busy} />
        <ScenarioCard lang={p.lang} kpis={p.kpis} busy={p.scenarioBusy} error={p.scenarioError} onRun={p.onScenario} />
        <div ref={endRef} />
      </div>

      <div className="space-y-2 border-t p-3">
        {!last && (
          <div className="flex flex-wrap gap-1.5">
            {tr.prompts.map((s) => (
              <Button key={s} size="sm" variant="outline" onClick={() => p.onSend(s)}>{s}</Button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr.placeholder}
            aria-label={tr.placeholder}
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {p.busy ? (
            <Button type="button" variant="secondary" size="lg" onClick={p.onStop}>{tr.stop}</Button>
          ) : (
            <Button type="submit" size="lg" disabled={!input.trim()}>{tr.send}</Button>
          )}
        </form>
      </div>
    </section>
  );
}
