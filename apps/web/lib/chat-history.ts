"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { deleteRemoteChat, getRemoteChat, listRemoteChats, saveRemoteChat } from "./api";
import { useAuth } from "./auth";
import { contextOf, mergeLists, readLocal, removeLocal, snapshotLocal, subscribeLocal, summarize, summariesOf, titleOf, toStored, upsertLocal, type ChatMessage, type ChatSummary, type ChatThread } from "./chat-store";
import type { Lang } from "./types";
import { newId } from "./ids";

/** Keeps the conversation saved in the browser and, for a signed-in account, on the server; and opens, starts and deletes saved chats. */
export function useChatHistory<M extends ChatMessage>({ messages, setMessages, sessionRef, lang, areaCode, busy }: {
  messages: M[];
  setMessages: Dispatch<SetStateAction<M[]>>;
  sessionRef: MutableRefObject<string>;
  lang: Lang;
  areaCode?: string | null;
  busy: boolean;
}) {
  const auth = useAuth();
  const signedIn = auth.status === "signed_in";
  const rawLocal = useSyncExternalStore(subscribeLocal, snapshotLocal, () => null);
  const local = useMemo(() => summariesOf(rawLocal), [rawLocal]);
  const [remoteRows, setRemoteRows] = useState<ChatSummary[]>([]);
  const remote = useMemo(() => (signedIn ? remoteRows : []), [signedIn, remoteRows]);
  const [loading, setLoading] = useState(false);
  const created = useRef(new Map<string, string>());
  const lastSaved = useRef("");
  const context = useRef("");
  const remoteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Signing in: read the account's chats, then upload the ones that only exist in this browser.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      try {
        const rows = await listRemoteChats();
        if (!live) return;
        const have = new Set(rows.map((r) => r.id));
        for (const t of Object.values(readLocal())) {
          if (!have.has(t.id)) await saveRemoteChat(t).catch(() => undefined);
        }
        const fresh = await listRemoteChats();
        if (live) setRemoteRows(fresh.map((r) => ({ ...r, where: "account" as const })));
      } catch { /* history just stays on this device */ }
    })();
    return () => { live = false; };
  }, [signedIn]);

  // Save after every finished turn (not while a reply is streaming).
  useEffect(() => {
    if (busy) return;
    const stored = toStored(messages);
    if (!stored.some((m) => m.role === "user" || m.role === "activity")) return;
    const sig = `${sessionRef.current}|${JSON.stringify(stored)}`;
    if (sig === lastSaved.current) return;
    lastSaved.current = sig;
    const id = sessionRef.current;
    const now = new Date().toISOString().slice(0, 19);
    if (!created.current.has(id)) created.current.set(id, readLocal()[id]?.created ?? now);
    const thread: ChatThread = { id, title: titleOf(stored), created: created.current.get(id)!, updated: now, lang, area: areaCode ?? null, messages: stored };
    upsertLocal(thread);
    if (signedIn) {
      clearTimeout(remoteTimer.current);
      remoteTimer.current = setTimeout(() => {
        saveRemoteChat(thread).then(() => setRemoteRows((rs) => (rs.some((r) => r.id === id) ? rs.map((r) => (r.id === id ? { ...summarize(thread, "account") } : r)) : [summarize(thread, "account"), ...rs]))).catch(() => undefined);
      }, 1000);
    }
  }, [messages, busy, lang, areaCode, signedIn, sessionRef]);
  useEffect(() => () => clearTimeout(remoteTimer.current), []);

  const summaries = mergeLists(local, remote);

  const open = useCallback(async (id: string): Promise<ChatThread | null> => {
    setLoading(true);
    try {
      let t: ChatThread | null = readLocal()[id] ?? null;
      if (signedIn && (!t || remote.some((r) => r.id === id && r.updated > t!.updated))) t = await getRemoteChat(id).catch(() => t);
      if (!t) return null;
      sessionRef.current = id;
      created.current.set(id, t.created);
      lastSaved.current = `${id}|${JSON.stringify(toStored(t.messages))}`;
      context.current = contextOf(t.messages);      // the server forgot this conversation: send its last turns along once
      setMessages(t.messages as M[]);
      return t;
    } finally {
      setLoading(false);
    }
  }, [signedIn, remote, sessionRef, setMessages]);

  const newChat = useCallback(() => {
    sessionRef.current = newId();
    lastSaved.current = "";
    context.current = "";
    setMessages([]);
  }, [sessionRef, setMessages]);

  const remove = useCallback(async (id: string) => {
    removeLocal(id);
    if (signedIn) {
      await deleteRemoteChat(id).catch(() => undefined);
      setRemoteRows((rs) => rs.filter((r) => r.id !== id));
    }
    if (id === sessionRef.current) newChat();
  }, [signedIn, sessionRef, newChat]);

  /** The earlier turns of a reopened chat, once: they go with the next message and are then forgotten. */
  const takeContext = useCallback(() => {
    const c = context.current;
    context.current = "";
    return c || undefined;
  }, []);

  return { summaries, loading, signedIn, accountHistory: auth.config?.auth_required === true, open, newChat, remove, takeContext };
}
