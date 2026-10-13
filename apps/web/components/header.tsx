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

export function Header({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const { theme, toggle } = useTheme();
  const [modal, setModal] = useState<"about" | "feedback" | null>(null);
  const close = () => setModal(null);
  const dark = theme === "dark";
  const themeLabel = dark ? tr.themeToLight : tr.themeToDark;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-background px-3 sm:px-4">
      <Link href="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="DNext · LandslideWatch TH">
        <LogoMark className="size-7" />
        <Wordmark />
      </Link>
      <nav className="flex items-center gap-1" aria-label="Site">
        <Button variant="ghost" size="icon" onClick={() => setModal("about")} aria-label={tr.aboutOpen} title={tr.aboutOpen}>
          <Info />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setModal("feedback")} aria-label={tr.feedbackOpen} title={tr.feedbackOpen}>
          <MessageSquareText />
        </Button>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label={themeLabel} title={themeLabel} aria-pressed={dark}>
          {dark ? <Sun /> : <Moon />}
        </Button>
      </nav>
      <AboutModal lang={lang} open={modal === "about"} onClose={close} />
      <FeedbackModal lang={lang} open={modal === "feedback"} onClose={close} />
    </header>
  );
}
