import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export function Banner({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const link = "font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div role="note" className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-3 py-1.5 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <span className="font-medium">{tr.banner}</span>
      <span aria-hidden>·</span>
      <a className={link} href="https://www.tmd.go.th" target="_blank" rel="noopener noreferrer">{tr.tmd}</a>
      <a className={link} href="https://www.disaster.go.th" target="_blank" rel="noopener noreferrer">{tr.ddpm}</a>
    </div>
  );
}
