"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, MessageSquareText, Moon, Sun } from "lucide-react";
import { AboutModal } from "./about-modal";
import { FeedbackModal } from "./feedback-modal";
import { LogoMark, Wordmark } from "./logo";
import { ViewTabs } from "./view-tabs";
import { useTheme } from "./theme-provider";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Header({ lang, setLang, tab, onTab }: { lang: Lang; setLang: (l: Lang) => void; tab: "chat" | "map"; onTab: (t: "chat" | "map") => void }) {
  const tr = t(lang);
  const { theme, toggle } = useTheme();
  const [modal, setModal] = useState<"about" | "feedback" | null>(null);
  const close = () => setModal(null);
  const dark = theme === "dark";
  const themeLabel = dark ? tr.themeToLight : tr.themeToDark;

  return (
    <header className="relative z-20 flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center justify-between gap-2 border-b border-black/10 bg-primary pt-[env(safe-area-inset-top,0px)] pr-[max(0.75rem,env(safe-area-inset-right,0px))] pl-[max(0.75rem,env(safe-area-inset-left,0px))] text-primary-foreground shadow-sm sm:pr-[max(1.25rem,env(safe-area-inset-right,0px))] sm:pl-[max(1.25rem,env(safe-area-inset-left,0px))] short:h-[calc(3rem+env(safe-area-inset-top,0px))] dark:border-border dark:bg-card dark:text-foreground dark:shadow-none">
      <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none coarse:min-h-11 coarse:min-w-11 focus-visible:ring-2 focus-visible:ring-primary-foreground/70 dark:focus-visible:ring-ring" aria-label="DNext · LandslideWatch TH">
        <LogoMark className="size-8" inverted />
        <Wordmark inverted className="max-[379px]:hidden" />
      </Link>

      {/* short screens (phone landscape): the Chat | Map switch moves into the header to save a row */}
      <div className="hidden min-w-0 flex-1 justify-center lg:hidden short:flex">
        <ViewTabs lang={lang} tab={tab} onTab={onTab} />
      </div>

      <nav className="flex shrink-0 items-center gap-1.5 coarse:gap-1" aria-label="Site">
        <div role="group" aria-label={tr.language} className="mr-1 flex rounded-full bg-primary-foreground/15 p-0.5 text-xs font-medium coarse:text-sm dark:bg-muted">
          {(["en", "th"] as const).map((l) => (
            <button
              key={l}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                "min-h-8 rounded-full px-2.5 py-1 outline-none transition-colors coarse:flex coarse:min-h-11 coarse:min-w-11 coarse:items-center coarse:justify-center coarse:px-3 coarse:py-0 focus-visible:ring-2 focus-visible:ring-primary-foreground/70 dark:focus-visible:ring-ring",
                lang === l ? "bg-primary-foreground text-primary shadow-sm dark:bg-card dark:text-foreground" : "text-primary-foreground/80 hover:text-primary-foreground dark:text-muted-foreground dark:hover:text-foreground",
              )}
            >
              {l === "en" ? "EN" : "ไทย"}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground" onClick={() => setModal("about")} aria-label={tr.aboutOpen} title={tr.aboutOpen}><Info /></Button>
        <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground" onClick={() => setModal("feedback")} aria-label={tr.feedbackOpen} title={tr.feedbackOpen}><MessageSquareText /></Button>
        <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground" onClick={toggle} aria-label={themeLabel} title={themeLabel} aria-pressed={dark}>
          {dark ? <Sun /> : <Moon />}
        </Button>
      </nav>
      <AboutModal lang={lang} open={modal === "about"} onClose={close} />
      <FeedbackModal lang={lang} open={modal === "feedback"} onClose={close} />
    </header>
  );
}
