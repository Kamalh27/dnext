"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, MessageSquareText, Moon, Sun } from "lucide-react";
import { AboutModal } from "./about-modal";
import { FeedbackModal } from "./feedback-modal";
import { LogoMark, Wordmark } from "./logo";
import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Header({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const tr = t(lang);
  const { theme, toggle } = useTheme();
  const [modal, setModal] = useState<"about" | "feedback" | null>(null);
  const close = () => setModal(null);
  const dark = theme === "dark";
  const themeLabel = dark ? tr.themeToLight : tr.themeToDark;

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/85 px-3 backdrop-blur-md sm:px-5">
      <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="DNext · LandslideWatch TH">
        <LogoMark className="size-8" />
        <Wordmark />
      </Link>

      <nav className="flex items-center gap-1.5" aria-label="Site">
        <div role="group" aria-label={tr.language} className="mr-1 flex rounded-full bg-muted p-0.5 text-xs font-medium">
          {(["en", "th"] as const).map((l) => (
            <button
              key={l}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                "rounded-full px-2.5 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                lang === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l === "en" ? "EN" : "ไทย"}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setModal("about")} aria-label={tr.aboutOpen} title={tr.aboutOpen}><Info /></Button>
        <Button variant="ghost" size="icon" onClick={() => setModal("feedback")} aria-label={tr.feedbackOpen} title={tr.feedbackOpen}><MessageSquareText /></Button>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={themeLabel} title={themeLabel} aria-pressed={dark}>
          {dark ? <Sun /> : <Moon />}
        </Button>
      </nav>
      <AboutModal lang={lang} open={modal === "about"} onClose={close} />
      <FeedbackModal lang={lang} open={modal === "feedback"} onClose={close} />
    </header>
  );
}
