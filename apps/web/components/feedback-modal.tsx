"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Modal } from "./modal";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const FORM_URL = process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "";

/** Google Forms only allows framing with ?embedded=true. */
const embedUrl = (u: string) => (/[?&]embedded=true/.test(u) ? u : `${u}${u.includes("?") ? "&" : "?"}embedded=true`);

export function FeedbackModal({ lang, open, onClose }: { lang: Lang; open: boolean; onClose: () => void }) {
  const tr = t(lang);
  return (
    <Modal open={open} onClose={onClose} title={tr.feedbackTitle} closeLabel={tr.close} className="w-[min(94vw,40rem)]">
      <FeedbackBody lang={lang} />
    </Modal>
  );
}

// Rendered only while the modal is open, so the loading state resets on every open.
function FeedbackBody({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {FORM_URL ? (
        <div className="relative h-[72dvh]">
          {!loaded && <Skeleton className="absolute inset-3 h-auto rounded-lg" />}
          <iframe
            src={embedUrl(FORM_URL)}
            title={tr.feedbackTitle}
            onLoad={() => setLoaded(true)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            className="relative size-full border-0 bg-white"
          >
            {tr.loading}
          </iframe>
          <a
            href={FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-md bg-card/95 px-2 py-1 text-xs shadow outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tr.openInTab} <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      ) : (
        <div className="space-y-2 px-5 py-8 text-sm">
          <p className="font-medium">{tr.feedbackMissing}</p>
          <p className="text-muted-foreground">{tr.feedbackMissingHint}</p>
        </div>
      )}
    </>
  );
}
