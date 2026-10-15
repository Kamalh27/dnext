"use client";

import { Cloud, HardDrive, Trash2 } from "lucide-react";
import { requestSignIn } from "@/lib/auth";
import type { ChatSummary } from "@/lib/chat-store";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const when = (iso: string, lang: Lang) => {
  const d = new Date(iso.length === 19 ? `${iso}Z` : iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

/** List of saved chats: open one, delete one, and a line saying where they are kept. */
export function ChatHistoryPanel({ lang, summaries, loading, signedIn, accountHistory, onOpen, onDelete }: {
  lang: Lang; summaries: ChatSummary[]; loading: boolean; signedIn: boolean; accountHistory: boolean; onOpen: (id: string) => void; onDelete: (id: string) => void;
}) {
  const tr = t(lang);
  const where = { device: tr.historyDevice, account: tr.historyAccount, both: tr.historyBoth } as const;
  return (
    <div className="space-y-3 px-4 py-4" data-testid="chat-history">
      {summaries.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{tr.historyEmpty}</p>
      ) : (
        <ul className="space-y-2" aria-busy={loading}>
          {summaries.map((s) => (
            <li key={s.id} className="flex items-stretch gap-1 rounded-xl border bg-card shadow-xs">
              <button type="button" onClick={() => onOpen(s.id)} disabled={loading} data-testid="chat-history-item"
                className="min-w-0 flex-1 rounded-l-xl px-3.5 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 coarse:min-h-11">
                <span className="block truncate text-sm font-medium">{s.title || tr.newChat}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {s.where === "device" ? <HardDrive className="size-3" aria-hidden /> : <Cloud className="size-3" aria-hidden />}
                  {where[s.where]} · {when(s.updated, lang)}
                </span>
              </button>
              <button type="button" onClick={() => onDelete(s.id)} aria-label={tr.historyDelete} title={tr.historyDelete}
                className="grid w-10 shrink-0 place-items-center rounded-r-xl text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring coarse:w-11">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {signedIn ? tr.historyNoteAccount : tr.historyNoteLocal}
        {accountHistory && !signedIn && (
          <> <button type="button" onClick={() => requestSignIn()} className="underline underline-offset-2">{tr.historySignInHint}</button></>
        )}
      </p>
    </div>
  );
}
